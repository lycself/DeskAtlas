"""Restore stages lost by older imports, matching the current room, seat, name and adviser."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from backend.app.auditing import audit  # noqa: E402
from backend.app.config import get_settings  # noqa: E402
from backend.app.database import build_engine  # noqa: E402
from backend.app.datatransfer import backup_filename, export_backup  # noqa: E402
from backend.app.importer import preview_workbook  # noqa: E402
from backend.app.models import Assignment, Room, Seat, Student  # noqa: E402


def repair_plan(db: Session, rows: list[dict]) -> dict:
    changes, conflicts = {}, []
    for row in rows:
        level = row.get("program_level")
        if row.get("kind") != "student" or level not in {"本科", "博士后", "硕转博"}:
            continue
        candidates = list(db.scalars(
            select(Student).join(Assignment).join(Seat).join(Room).where(
                Student.is_archived.is_(False), Student.name == row["person_name"],
                Assignment.ended_at.is_(None), Room.name == row["room_name"], Seat.code == row["seat_code"],
            ).with_for_update(of=Student)
        ))
        if len(candidates) != 1 or (row.get("adviser") and candidates[0].adviser != row["adviser"]):
            conflicts.append({"source_row": row["source_row"], "reason": "当前工位或导师不匹配"})
            continue
        student = candidates[0]
        if student.program_level == level:
            continue
        if student.program_level and not (level == "硕转博" and student.program_level == "博士"):
            conflicts.append({"source_row": row["source_row"], "reason": "已有不同培养层次，需人工确认"})
            continue
        previous = changes.get(student.id)
        if previous and previous["after"] != level:
            raise ValueError("同一人员在源表中有冲突的培养层次")
        changes[student.id] = {"id": student.id, "name": student.name, "before": student.program_level,
                               "after": level, "source_row": row["source_row"]}
    return {"changes": list(changes.values()), "conflicts": conflicts}


def apply_plan(db: Session, plan: dict) -> None:
    for change in plan["changes"]:
        student = db.get(Student, change["id"])
        if student.program_level != change["before"]:
            raise ValueError("人员资料已改变，请重新预览")
        student.program_level = change["after"]
        audit(db, "student.program_level_repaired", "student", student.id,
              before={"program_level": change["before"]}, after={"program_level": change["after"]})


def main() -> int:
    parser = argparse.ArgumentParser(description="按原始用房表补回本科、博士后和硕转博信息")
    parser.add_argument("--roster", type=Path, default=ROOT / "最新安排/研究生办公室用房信息汇总表(202609).xlsx")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    rows = preview_workbook(args.roster.read_bytes())["rows"]
    settings = get_settings()
    engine = build_engine(settings.database_url)
    try:
        with Session(engine) as db:
            plan = repair_plan(db, rows)
            print(json.dumps(plan, ensure_ascii=False, indent=2))
            if args.apply and plan["changes"]:
                backup = export_backup(engine, settings, settings.backup_dir / backup_filename("pre-program-level-repair"))
                apply_plan(db, plan)
                db.commit()
                print(f"已更新 {len(plan['changes'])} 人；恢复前备份：{backup}")
            else:
                db.rollback()
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
