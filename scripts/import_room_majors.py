"""Fill room affiliations from the surveyed 教研中心 column, including empty seats."""
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
    changed = []
    with SessionLocal.begin() as db:
        for room in db.scalars(select(Room).with_for_update()):
            info = preview["rooms"].get(room.name)
            if not info or room.major_names:
                continue
            room.major_names = info["major_names"]
            changed.append({"room": room.name, "major_names": room.major_names})
        if changed:
            db.add(AuditLog(action="survey.room_majors_imported", target_type="room",
                            target_id=preview["fingerprint"], before_data={"major_names_were_empty": True},
                            after_data={"source_column": "教研中心", "rooms": changed}))
    print(f"已补全 {len(changed)} 个房间的专业归属")


if __name__ == "__main__":
    main()
