"""Preview or atomically synchronize the four latest arrangement workbooks."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.database import SessionLocal, engine
from backend.app.latest_import import apply_latest, latest_preview


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roster", type=Path, default=Path("最新安排/研究生办公室用房信息汇总表(202609).xlsx"))
    parser.add_argument("--floorplan", type=Path, default=Path("最新安排/研究生办公室布局图（可查阅房间座位号）(1).xlsx"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--directory", type=Path, default=Path("最新安排/学生信息_20260916 (1).xlsx"))
    parser.add_argument("--teachers", type=Path, default=Path("最新安排/教研中心人员名单-20260911.xlsx"))
    parser.add_argument("--output", type=Path, default=Path("uploads/latest-import"))
    parser.add_argument("--seat-override", action="append", default=[], metavar="学号=房间/座位号")
    args = parser.parse_args()
    overrides = {}
    for value in args.seat_override:
        if "=" not in value:
            parser.error("--seat-override 格式为 学号=房间/座位号")
        number, target = value.split("=", 1)
        overrides[number.strip()] = target.strip()
    preview = latest_preview(args.roster.read_bytes(), args.floorplan.read_bytes(), args.directory.read_bytes(), args.teachers.read_bytes(), seat_overrides=overrides)
    args.output.mkdir(parents=True, exist_ok=True)
    report = args.output / "preview.json"
    report.write_text(json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8")
    report.chmod(0o600)
    print(json.dumps(preview["summary"], ensure_ascii=False))
    print(json.dumps({name: {k: room[k] for k in ("range", "missing", "duplicates", "extra")}
                      for name, room in preview["rooms"].items()
                      if room["missing"] or room["duplicates"] or room["extra"]}, ensure_ascii=False))
    print(json.dumps({"assignment_conflicts": preview["assignment_conflicts"]}, ensure_ascii=False))
    if not args.apply:
        print("预览完成；使用 --apply 以最新安排为准同步，原分配保留历史。")
        return
    if engine.dialect.name != "postgresql":
        raise SystemExit("实测导入脚本要求PostgreSQL数据库，以便在写入前创建完整备份。")
    backup = args.output / f"before-{datetime.now():%Y%m%d-%H%M%S-%f}.dump"
    url = engine.url
    env = {**os.environ, "PGPASSWORD": url.password or ""}
    subprocess.run(["pg_dump", "--host", url.host or "localhost", "--port", str(url.port or 5432),
                    "--username", url.username or "", "--dbname", url.database or "",
                    "--format=custom", "--file", str(backup)], env=env, check=True)
    backup.chmod(0o600)
    with SessionLocal.begin() as db:
        result = apply_latest(db, preview)
    result["backup"] = str(backup)
    output = args.output / f"result-{datetime.now():%Y%m%d-%H%M%S-%f}.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    output.chmod(0o600)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
