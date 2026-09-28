"""Restore perimeter walls omitted by the September map ranges."""
import copy
import json
import os
from datetime import datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from backend.app.database import SessionLocal
from backend.app.latest_import import LATEST_MAP_RANGES
from backend.app.models import AuditLog, Room
from backend.app.office_import import surveyed_preview


OLD_RANGES = {**LATEST_MAP_RANGES, "311": "N2:Q10", "406": "AL13:AO21", "680": "M74:R79"}
TARGETS = ("311", "406", "680")


def repair(db, old_preview, new_preview):
    updated = []
    rooms = list(db.scalars(select(Room).where(Room.name.in_(TARGETS)).with_for_update()))
    for room in rooms:
        before = {field: copy.deepcopy(getattr(room, field)) for field in
                  ("draft_layout", "published_layout", "canvas_width", "canvas_height")}
        offset = 94 if room.name in {"311", "406"} else 0
        old_positions = {row["seat_code"]: row["location"]["x"] for row in old_preview["rooms"][room.name]["rows"]
                         if row["location"]}
        new_walls = [dict(id=f"survey-wall-{room.id}-{index}", type="wall", label="墙",
                          rotation=0, **wall)
                     for index, wall in enumerate(new_preview["rooms"][room.name]["walls"])]
        for field in ("draft_layout", "published_layout"):
            items = copy.deepcopy(getattr(room, field) or [])
            seats = {item["label"]: item for item in items if item["type"] == "seat"}
            old_matches = all(seats[code]["x"] == x for code, x in old_positions.items() if code in seats)
            new_matches = all(seats[code]["x"] == x + offset for code, x in old_positions.items() if code in seats)
            if offset and not (old_matches or new_matches):
                raise ValueError(f"{room.name} {field} 已手动调整，不能自动平移")
            if offset and old_matches:
                for item in items:
                    item["x"] += offset
            items = [item for item in items if not (item["type"] == "wall" and
                     item["id"].startswith((f"survey-wall-{room.id}-", f"survey-wall-repair-{room.id}-")))]
            items.extend(copy.deepcopy(new_walls))
            setattr(room, field, items)
            room.canvas_width = max(room.canvas_width, max(item["x"] + item["width"] for item in items) + 40)
            room.canvas_height = max(room.canvas_height, max(item["y"] + item["height"] for item in items) + 40)
        after = {field: getattr(room, field) for field in before}
        if before != after:
            db.add(AuditLog(action="survey.perimeter_repaired", target_type="room", target_id=str(room.id),
                            before_data=before, after_data=after))
            updated.append({"room": room.name, "walls": len(new_walls)})
    return updated


def main():
    root = Path(__file__).resolve().parents[1]
    source = root / "最新安排"
    roster = next(source.glob("研究生办公室用房*"), None)
    plan = next(source.glob("研究生办公室布局图*"), None)
    if not roster or not plan:
        raise FileNotFoundError("请把最新安排的用房汇总表和布局图放在 最新安排 目录")
    roster_data, plan_data = roster.read_bytes(), plan.read_bytes()
    old = surveyed_preview(roster_data, plan_data, map_ranges=OLD_RANGES)
    new = surveyed_preview(roster_data, plan_data, map_ranges=LATEST_MAP_RANGES)
    with SessionLocal.begin() as db:
        rooms = list(db.scalars(select(Room).where(Room.name.in_(TARGETS)).with_for_update()))
        snapshot = [{"id": room.id, "name": room.name, "draft_layout": room.draft_layout,
                     "published_layout": room.published_layout, "canvas_width": room.canvas_width,
                     "canvas_height": room.canvas_height} for room in rooms]
        path = root / "uploads/latest-import" / f"before-perimeter-repair-{datetime.now():%Y%m%d-%H%M%S-%f}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "x", encoding="utf-8", opener=lambda name, flags: os.open(name, flags, 0o600)) as stream:
            json.dump(snapshot, stream, ensure_ascii=False, indent=2)
        print(json.dumps({"updated": repair(db, old, new), "snapshot": str(path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
