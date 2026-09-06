"""Preview or apply the two locally surveyed workbooks (no network upload)."""
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
from backend.app.office_import import apply_survey, surveyed_preview


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--roster", type=Path, default=Path("研究生办公室用房信息汇总表.xlsx"))
    parser.add_argument("--floorplan", type=Path, default=Path("工位分布.xlsx"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--replace-conflicts", action="store_true", help="以Excel为准结束冲突分配，保留历史")
    parser.add_argument("--output", type=Path, default=Path("uploads/office-import"))
    args = parser.parse_args()
    preview = surveyed_preview(args.roster.read_bytes(), args.floorplan.read_bytes())
    args.output.mkdir(parents=True, exist_ok=True)
    report = args.output / "preview.json"
    report.write_text(json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8")
    report.chmod(0o600)
    print(json.dumps(preview["summary"], ensure_ascii=False))
    print(json.dumps({name: {k: room[k] for k in ("range", "missing", "duplicates", "extra")}
                      for name, room in preview["rooms"].items()
                      if room["missing"] or room["duplicates"] or room["extra"]}, ensure_ascii=False))
    if not args.apply:
        print("预览完成；使用 --apply 导入，默认保留已有占用冲突。")
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
        result = apply_survey(db, preview, replace_conflicts=args.replace_conflicts)
    result["backup"] = str(backup)
    output = args.output / f"result-{datetime.now():%Y%m%d-%H%M%S-%f}.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    output.chmod(0o600)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
