"""Portable backups: copy whole databases between engines and pack them with config and uploads.

A backup package is a zip with:
    manifest.json   format, app version, schema revision, creation time
    deskatlas.db    SQLite snapshot of every table
    config.env      admin credentials and the settings encryption key
    uploads/...     files uploaded through the admin UI
The same package restores into SQLite (packaged installs) or PostgreSQL (server deployments).
"""

from __future__ import annotations

import io
import json
import logging
import shutil
import sqlite3
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

from dotenv import dotenv_values
from sqlalchemy import Integer, func, select, text
from sqlalchemy.engine import Engine

from . import models  # noqa: F401  (registers every table on Base.metadata)
from .config import Settings
from .database import Base, build_engine
from .migrations import current_revision, head_revision, stamp, upgrade_database
from .version import VERSION


log = logging.getLogger(__name__)

BACKUP_FORMAT = 1
DB_NAME = "deskatlas.db"
MANIFEST_NAME = "manifest.json"
CONFIG_NAME = "config.env"
UPLOADS_PREFIX = "uploads/"
BACKUP_CONFIG_KEYS = ("ADMIN_USERNAME", "ADMIN_PASSWORD_HASH", "SETTINGS_ENCRYPTION_KEY")
transfer_lock = threading.Lock()


class BackupError(ValueError):
    """Raised for unusable backup packages."""


def copy_all_tables(source: Engine, target: Engine, *, chunk: int = 500) -> dict[str, int]:
    """Replace every table in target with the rows from source, preserving ids."""
    tables = list(Base.metadata.sorted_tables)
    counts: dict[str, int] = {}
    with source.connect() as reader, target.begin() as writer:
        for table in reversed(tables):
            writer.execute(table.delete())
        for table in tables:
            rows = [dict(row._mapping) for row in reader.execute(select(table))]
            for start in range(0, len(rows), chunk):
                writer.execute(table.insert(), rows[start:start + chunk])
            counts[table.name] = len(rows)
        if writer.dialect.name == "postgresql":
            for table in tables:
                column = table.c.get("id")
                if column is not None and isinstance(column.type, Integer):
                    writer.execute(text(
                        f"SELECT setval(pg_get_serial_sequence('{table.name}', 'id'), "
                        f"COALESCE((SELECT MAX(id) FROM {table.name}), 0) + 1, false)"
                    ))
    return counts


def sqlite_snapshot(source_path: Path, target_path: Path) -> None:
    """Consistent copy of a live SQLite database using the online backup API."""
    source = sqlite3.connect(str(source_path))
    target = sqlite3.connect(str(target_path))
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()


def snapshot_database(engine: Engine, settings: Settings, target_path: Path) -> str:
    """Write a SQLite copy of the live database and return its schema revision."""
    if settings.is_sqlite and settings.sqlite_path and settings.sqlite_path.exists():
        with engine.connect() as connection:
            connection.execute(text("PRAGMA wal_checkpoint(PASSIVE)"))
        sqlite_snapshot(settings.sqlite_path, target_path)
        return current_revision(engine) or head_revision()
    url = f"sqlite:///{target_path.as_posix()}"
    target = build_engine(url)
    try:
        Base.metadata.create_all(target)
        copy_all_tables(engine, target)
        revision = current_revision(engine) or head_revision()
        stamp(target, url, revision)
    finally:
        target.dispose()
    return revision


def config_snapshot(settings: Settings) -> str:
    values = {
        "ADMIN_USERNAME": settings.admin_username,
        "ADMIN_PASSWORD_HASH": settings.admin_password_hash,
        "SETTINGS_ENCRYPTION_KEY": settings.settings_encryption_key,
    }
    return "".join(f"{key}='{value}'\n" for key, value in values.items() if value)


def export_backup(engine: Engine, settings: Settings, target: Path, *, kind: str = "manual") -> Path:
    """Create a backup package at target and return its path."""
    target.parent.mkdir(parents=True, exist_ok=True)
    with transfer_lock, tempfile.TemporaryDirectory(prefix="deskatlas-export-") as workdir:
        snapshot = Path(workdir) / DB_NAME
        revision = snapshot_database(engine, settings, snapshot)
        manifest = {
            "format": BACKUP_FORMAT,
            "app_version": VERSION,
            "schema_revision": revision,
            "kind": kind,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        partial = target.with_suffix(target.suffix + ".part")
        with ZipFile(partial, "w", ZIP_DEFLATED) as package:
            package.writestr(MANIFEST_NAME, json.dumps(manifest, ensure_ascii=False, indent=2))
            package.write(snapshot, DB_NAME)
            package.writestr(CONFIG_NAME, config_snapshot(settings))
            upload_dir = settings.upload_dir
            if upload_dir.is_dir():
                for file in sorted(upload_dir.rglob("*")):
                    if file.is_file():
                        package.write(file, UPLOADS_PREFIX + file.relative_to(upload_dir).as_posix())
        partial.replace(target)
    return target


def inspect_backup(package: ZipFile) -> dict:
    names = set(package.namelist())
    if DB_NAME not in names:
        raise BackupError("备份包缺少数据库文件，不是有效的 DeskAtlas 备份")
    manifest = {}
    if MANIFEST_NAME in names:
        try:
            manifest = json.loads(package.read(MANIFEST_NAME).decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise BackupError("备份包清单损坏") from exc
    if manifest.get("format", BACKUP_FORMAT) > BACKUP_FORMAT:
        raise BackupError("备份包来自更新的 DeskAtlas 版本，请先升级软件")
    return manifest


def _verify_sqlite(path: Path) -> None:
    try:
        connection = sqlite3.connect(str(path))
        try:
            status = connection.execute("PRAGMA integrity_check").fetchone()[0]
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            connection.close()
    except sqlite3.DatabaseError as exc:
        raise BackupError("备份包中的数据库无法打开") from exc
    if status != "ok" or "rooms" not in tables:
        raise BackupError("备份包中的数据库已损坏或不完整")


def _safe_child(base: Path, relative: str) -> Path | None:
    candidate = (base / relative).resolve()
    try:
        candidate.relative_to(base.resolve())
    except ValueError:
        return None
    return candidate


def restore_backup(package_path: Path, engine: Engine, settings: Settings) -> dict:
    """Replace the live database, uploads, and credentials with the package contents."""
    with transfer_lock:
        try:
            package = ZipFile(package_path)
        except BadZipFile as exc:
            raise BackupError("文件不是有效的 zip 备份包") from exc
        with package, tempfile.TemporaryDirectory(prefix="deskatlas-restore-") as workdir:
            manifest = inspect_backup(package)
            staging = Path(workdir) / DB_NAME
            with package.open(DB_NAME) as source, staging.open("wb") as target:
                shutil.copyfileobj(source, target)
            _verify_sqlite(staging)

            # Migrate the staged copy first so older packages become current before they go live.
            staging_url = f"sqlite:///{staging.as_posix()}"
            staging_engine = build_engine(staging_url)
            try:
                revision = upgrade_database(staging_engine, staging_url)
            finally:
                staging_engine.dispose()

            if settings.is_sqlite and settings.sqlite_path:
                counts = _swap_sqlite_database(staging, engine, settings)
            else:
                staging_engine = build_engine(staging_url)
                try:
                    counts = copy_all_tables(staging_engine, engine)
                finally:
                    staging_engine.dispose()

            _restore_uploads(package, settings.upload_dir)
            config_values = {}
            if CONFIG_NAME in package.namelist():
                parsed = dotenv_values(stream=io.StringIO(package.read(CONFIG_NAME).decode("utf-8")))
                config_values = {key: value for key, value in parsed.items() if key in BACKUP_CONFIG_KEYS and value}
            if config_values:
                settings.write_config(config_values)
        return {"manifest": manifest, "schema_revision": revision, "tables": counts, "config_restored": sorted(config_values)}


def _swap_sqlite_database(staging: Path, engine: Engine, settings: Settings) -> dict[str, int]:
    live = settings.sqlite_path
    assert live is not None
    engine.dispose()
    if live.exists():
        settings.backup_dir.mkdir(parents=True, exist_ok=True)
        keep = settings.backup_dir / f"pre-restore-{datetime.now():%Y%m%d-%H%M%S}.db"
        sqlite_snapshot(live, keep)
    for suffix in ("", "-wal", "-shm"):
        stale = live.with_name(live.name + suffix)
        if stale.exists():
            stale.unlink()
    live.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(staging, live)
    counts: dict[str, int] = {}
    with engine.connect() as connection:
        for table in Base.metadata.sorted_tables:
            counts[table.name] = connection.execute(select(func.count()).select_from(table)).scalar() or 0
    return counts


def _restore_uploads(package: ZipFile, upload_dir: Path) -> None:
    entries = [name for name in package.namelist() if name.startswith(UPLOADS_PREFIX) and not name.endswith("/")]
    if upload_dir.exists():
        shutil.rmtree(upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    for name in entries:
        destination = _safe_child(upload_dir, name[len(UPLOADS_PREFIX):])
        if destination is None:
            log.warning("Skipping unsafe upload path in backup: %s", name)
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        with package.open(name) as source, destination.open("wb") as target:
            shutil.copyfileobj(source, target)


def list_backups(directory: Path) -> list[dict]:
    if not directory.is_dir():
        return []
    entries = []
    for file in directory.glob("*.zip"):
        stat = file.stat()
        entries.append({
            "name": file.name,
            "size": stat.st_size,
            "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        })
    entries.sort(key=lambda entry: entry["created_at"], reverse=True)
    return entries


def prune_backups(directory: Path, prefix: str, keep: int) -> list[Path]:
    """Delete the oldest backups with the given prefix beyond keep, returning removed paths."""
    files = sorted(directory.glob(f"{prefix}*.zip"), key=lambda file: file.stat().st_mtime, reverse=True)
    removed = []
    for file in files[max(keep, 1):]:
        file.unlink(missing_ok=True)
        removed.append(file)
    return removed


def backup_filename(kind: str = "manual") -> str:
    return f"{kind}-{datetime.now():%Y%m%d-%H%M%S}.zip"
