"""Repair the five reported survey layouts without changing occupant assignments."""
import copy
import json
import os
from datetime import datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select
from backend.app.database import SessionLocal
from backend.app.models import AuditLog, Room, Seat
from backend.app.office_import import surveyed_preview, unresolved_layout


def repair(db, preview):
    result = []
    for room in db.scalars(select(Room).where(Room.name.in_(["302", "402", "408", "431", "680"])).with_for_update()):
        info = preview["rooms"][room.name]
        before = {field: copy.deepcopy(getattr(room, field)) for field in
                  ("draft_layout", "published_layout", "canvas_width", "canvas_height", "description")}
        additions = []
        created = []
        if room.name == "408":
            seats = {s.code: s for s in room.seats}
            for row in info["rows"]:
                if not row.get("map_only"):
                    continue
                seat = seats.get(row["seat_code"])
                if seat is None:
                    seat = Seat(room_id=room.id, code=row["seat_code"], admin_status="reserved", note=row["note"])
                    db.add(seat)
                    db.flush()
                    created.append(seat.id)
                if not seat.is_archived:
                    additions.append(dict(id=seat.id, type="seat", label=seat.code,
                                          x=row["location"]["x"], y=row["location"]["y"],
                                          width=76, height=48, rotation=0))
            if room.description:
                room.description = room.description.replace("（未新增）", "（已补入，使用情况待核对）")
        if room.name in {"431", "680"}:
            additions.extend(unresolved_layout(room.id, info))
        for field in ("draft_layout", "published_layout"):
            items = copy.deepcopy(getattr(room, field) or [])
            if room.name in {"302", "402"}:
                # Add only missing geometry; preserve existing/manual walls and IDs.
                existing = {(i["x"], i["y"], i["width"], i["height"]) for i in items if i["type"] == "wall"}
                for wall in info["walls"]:
                    geometry = tuple(wall[k] for k in ("x", "y", "width", "height"))
                    if geometry not in existing:
                        items.append(dict(id=f"survey-wall-repair-{room.id}-" + "-".join(map(str, geometry)),
                                          type="wall", label="墙", rotation=0, **wall))
                        existing.add(geometry)
            ids = {i["id"] for i in items}
            items.extend(copy.deepcopy(i) for i in additions if i["id"] not in ids)
            setattr(room, field, items)
            room.canvas_width = max(room.canvas_width, int(max(i["x"] + i["width"] for i in items)) + 40)
            room.canvas_height = max(room.canvas_height, int(max(i["y"] + i["height"] for i in items)) + 40)
        after = {field: getattr(room, field) for field in before}
        if before != after or created:
            db.add(AuditLog(action="survey.layout_repaired", target_type="room", target_id=str(room.id),
                            before_data=before, after_data={**after, "created_seats": created}))
        result.append({"room": room.name, "created_seats": len(created),
                       "walls": sum(i["type"] == "wall" for i in room.published_layout),
                       "unresolved_positions": len(info["unresolved_positions"])})
    return result


def main():
    preview = surveyed_preview(Path("研究生办公室用房信息汇总表.xlsx").read_bytes(), Path("工位分布.xlsx").read_bytes())
    with SessionLocal.begin() as db:
        rooms = list(db.scalars(select(Room).where(Room.name.in_(["302", "402", "408", "431", "680"])).with_for_update()))
        snapshot = [{"id": r.id, "draft_layout": r.draft_layout, "published_layout": r.published_layout,
                     "canvas_width": r.canvas_width, "canvas_height": r.canvas_height, "description": r.description} for r in rooms]
        path = Path("uploads/office-import") / f"before-layout-repair-{datetime.now():%Y%m%d-%H%M%S-%f}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "x", encoding="utf-8", opener=lambda p, flags: os.open(p, flags, 0o600)) as stream:
            json.dump(snapshot, stream, ensure_ascii=False, indent=2)
        print(json.dumps({"rooms": repair(db, preview), "snapshot": str(path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
