"""Copy the live database into a SQLite data directory and produce a portable backup package.

Usage:
    .venv/bin/python scripts/migrate_to_sqlite.py                 # data dir at the platform default
    .venv/bin/python scripts/migrate_to_sqlite.py --data-dir DIR  # explicit target directory
    .venv/bin/python scripts/migrate_to_sqlite.py --package outputs/deskatlas.zip

Reads DATABASE_URL and the admin credentials from the project .env, writes DIR/deskatlas.db,
DIR/config.env, copies uploads/, and exports a backup zip that any DeskAtlas install can restore.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import CONFIG_KEYS, Settings, default_data_dir, get_settings  # noqa: E402
from backend.app.database import Base, build_engine  # noqa: E402
from backend.app.datatransfer import backup_filename, copy_all_tables, export_backup  # noqa: E402
from backend.app.migrations import current_revision, head_revision, stamp  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="将当前数据库迁移为 SQLite 数据目录并导出备份包")
    parser.add_argument("--data-dir", type=Path, default=None, help="目标数据目录（默认取本机 DeskAtlas 默认目录）")
    parser.add_argument("--package", type=Path, default=None, help="备份包输出路径（默认 outputs/backups/…zip）")
    parser.add_argument("--force", action="store_true", help="目标数据库已存在时覆盖")
    args = parser.parse_args()

    source_settings = get_settings()
    if source_settings.is_sqlite:
        print("当前 DATABASE_URL 已是 SQLite，无需迁移。")
        return 1
    data_dir = (args.data_dir or default_data_dir()).expanduser().resolve()
    db_path = data_dir / "deskatlas.db"
    if db_path.exists() and not args.force:
        print(f"目标数据库已存在：{db_path}。加 --force 覆盖。")
        return 1
    data_dir.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        stale = db_path.with_name(db_path.name + suffix)
        if stale.exists():
            stale.unlink()

    source = build_engine(source_settings.database_url)
    target_url = f"sqlite:///{db_path.as_posix()}"
    target = build_engine(target_url)
    try:
        Base.metadata.create_all(target)
        counts = copy_all_tables(source, target)
        stamp(target, target_url, current_revision(source) or head_revision())
    finally:
        target.dispose()
        source.dispose()
    for table, count in counts.items():
        print(f"  {table:<18} {count:>6}")

    config_path = data_dir / "config.env"
    config_path.touch(mode=0o600, exist_ok=True)
    values = {key: getattr(source_settings, key.lower()) for key in CONFIG_KEYS}
    config_path.write_text("".join(f"{key}='{value}'\n" for key, value in values.items() if value), encoding="utf-8")

    uploads_target = data_dir / "uploads"
    if source_settings.upload_dir.is_dir():
        if uploads_target.exists():
            shutil.rmtree(uploads_target)
        shutil.copytree(source_settings.upload_dir, uploads_target)

    package_settings = Settings(
        _env_file=config_path,
        database_url=target_url,
        upload_dir=uploads_target,
    )
    package = args.package or ROOT / "outputs" / "backups" / backup_filename("deskatlas-migrated")
    packaged_engine = build_engine(target_url)
    try:
        export_backup(packaged_engine, package_settings, package.resolve(), kind="migration")
    finally:
        packaged_engine.dispose()
    print(f"SQLite 数据目录：{data_dir}")
    print(f"备份包：{package.resolve()}")
    print("在新电脑安装 DeskAtlas 后，首次打开管理端选择“从备份包恢复”并上传该 zip 即可。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
