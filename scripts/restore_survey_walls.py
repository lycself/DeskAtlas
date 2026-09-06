"""Restore source Excel room outlines without changing seats or assignments."""
import copy
import json
from datetime import datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from backend.app.database import SessionLocal
from backend.app.models import AuditLog, Room
from backend.app.office_import import surveyed_preview


def main():
    preview = surveyed_preview(Path("研究生办公室用房信息汇总表.xlsx").read_bytes(),
                               Path("工位分布.xlsx").read_bytes())
    with SessionLocal.begin() as db:
        rooms = list(db.scalars(select(Room).with_for_update()))
        snapshot = [{"id": r.id, "draft_layout": r.draft_layout, "published_layout": r.published_layout,
                     "canvas_width": r.canvas_width, "canvas_height": r.canvas_height} for r in rooms]
        path = Path("uploads/office-import") / f"before-walls-{datetime.now():%Y%m%d-%H%M%S}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2))
        path.chmod(0o600)
        updated = []
        for room in rooms:
            info = preview["rooms"].get(room.name)
            if not info or not info["walls"]:
                continue
            walls = [dict(id=f"survey-wall-{room.id}-{i}", type="wall", label="墙", rotation=0, **wall)
                     for i, wall in enumerate(info["walls"])]
            for field in ("draft_layout", "published_layout"):
                items = [item for item in getattr(room, field) or []
                         if not item.get("id", "").startswith(f"survey-wall-{room.id}-")]
                setattr(room, field, items + copy.deepcopy(walls))
            room.canvas_width = max(room.canvas_width, int(max(w["x"] + w["width"] for w in walls)) + 40)
            room.canvas_height = max(room.canvas_height, int(max(w["y"] + w["height"] for w in walls)) + 40)
            updated.append({"room": room.name, "wall_segments": len(walls)})
        db.add(AuditLog(action="survey.walls_restored", target_type="layout",
                        after_data={"rooms": updated, "snapshot": str(path)}))
        print(json.dumps({"rooms": len(updated), "segments": sum(r["wall_segments"] for r in updated),
                          "snapshot": str(path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
