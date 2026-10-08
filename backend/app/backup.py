"""Admin backup packages: export, keep, download, and restore."""

from __future__ import annotations

import re
import shutil
import tempfile
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .auditing import audit
from .config import get_settings
from .database import engine, get_db
from .datatransfer import backup_filename, export_backup, list_backups
from .security import require_admin
from .setup import run_restore, save_upload


router = APIRouter(prefix="/api/admin/backup")
settings = get_settings()
Db = Annotated[Session, Depends(get_db)]
Admin = Annotated[str, Depends(require_admin)]
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+\.zip$")


def backup_path(name: str) -> Path:
    if not SAFE_NAME.match(name):
        raise HTTPException(status_code=404, detail="备份不存在")
    path = settings.backup_dir / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="备份不存在")
    return path


@router.get("/export")
def export_package(db: Db, admin: Admin, background: BackgroundTasks) -> FileResponse:
    workdir = Path(tempfile.mkdtemp(prefix="deskatlas-download-"))
    name = backup_filename("deskatlas-backup")
    package = export_backup(engine, settings, workdir / name, kind="download")
    audit(db, "backup.exported", "backup", name)
    db.commit()
    background.add_task(shutil.rmtree, workdir, True)
    return FileResponse(package, media_type="application/zip", filename=name)


@router.get("")
def list_packages(_: Admin) -> dict[str, Any]:
    return {"items": list_backups(settings.backup_dir), "directory": str(settings.backup_dir)}


@router.post("", status_code=201)
def create_package(db: Db, _: Admin) -> dict[str, Any]:
    name = backup_filename("manual")
    package = export_backup(engine, settings, settings.backup_dir / name, kind="manual")
    audit(db, "backup.created", "backup", name)
    db.commit()
    stat = package.stat()
    return {"name": name, "size": stat.st_size}


@router.get("/file/{name}")
def download_package(name: str, _: Admin) -> FileResponse:
    return FileResponse(backup_path(name), media_type="application/zip", filename=name)


@router.delete("/file/{name}", status_code=204)
def delete_package(name: str, db: Db, _: Admin) -> None:
    backup_path(name).unlink()
    audit(db, "backup.deleted", "backup", name)
    db.commit()


@router.post("/restore")
async def restore_package(_: Admin, file: UploadFile = File(...)) -> dict[str, Any]:
    workdir = Path(tempfile.mkdtemp(prefix="deskatlas-restore-upload-"))
    try:
        package = await save_upload(file, workdir)
        result = run_restore(package)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    with Session(engine) as db:
        audit(db, "backup.restored", "backup", file.filename, after={"tables": result["tables"]})
        db.commit()
    # Return to login after replacing the workspace, using this device's existing account.
    return {**result, "relogin": True}
