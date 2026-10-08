"""First-run initialisation, data import before creating a local admin, and password changes."""

from __future__ import annotations

import secrets
import shutil
import tempfile
from pathlib import Path
from typing import Annotated, Any

from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .auditing import audit
from .config import get_settings
from .database import engine, get_db
from .datatransfer import BackupError, restore_backup
from .security import hash_password, require_admin, verify_password
from .seed import seed_reference_data
from .version import VERSION


router = APIRouter()
settings = get_settings()
Db = Annotated[Session, Depends(get_db)]
Admin = Annotated[str, Depends(require_admin)]
MAX_PACKAGE_BYTES = 2 * 1024 * 1024 * 1024


class SetupInitialize(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[A-Za-z0-9_.@-]+$")
    password: str = Field(min_length=12, max_length=200)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=12, max_length=200)


def status_payload() -> dict[str, Any]:
    return {
        "configured": settings.configured,
        "packaged": settings.data_dir is not None,
        "database": "sqlite" if settings.is_sqlite else "postgresql",
        "data_dir": str(settings.data_dir) if settings.data_dir else None,
        "static_site": settings.static_dir is not None,
        "version": VERSION,
    }


def ensure_secrets() -> dict[str, str]:
    generated: dict[str, str] = {}
    if not settings.session_secret:
        generated["SESSION_SECRET"] = secrets.token_urlsafe(48)
    if not settings.settings_encryption_key:
        generated["SETTINGS_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
    return generated


async def save_upload(upload: UploadFile, directory: Path) -> Path:
    if not upload.filename or not upload.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=422, detail="请选择 .zip 备份包")
    target = directory / "package.zip"
    size = 0
    with target.open("wb") as handle:
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_PACKAGE_BYTES:
                raise HTTPException(status_code=413, detail="备份包过大")
            handle.write(chunk)
    return target


def run_restore(package: Path) -> dict[str, Any]:
    try:
        result = restore_backup(package, engine, settings)
    except BackupError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    with Session(engine) as db:
        seed_reference_data(db)
    return result


@router.get("/api/setup/status")
def setup_status() -> dict[str, Any]:
    return status_payload()


@router.post("/api/setup/initialize")
def setup_initialize(payload: SetupInitialize) -> dict[str, Any]:
    if settings.configured:
        raise HTTPException(status_code=409, detail="管理员账号已经配置，请直接登录")
    values = ensure_secrets()
    values["ADMIN_USERNAME"] = payload.username
    values["ADMIN_PASSWORD_HASH"] = hash_password(payload.password)
    settings.write_config(values)
    return status_payload()


@router.post("/api/setup/restore")
async def setup_restore(file: UploadFile = File(...)) -> dict[str, Any]:
    if settings.configured:
        raise HTTPException(status_code=409, detail="系统已经初始化，请登录后在设置中恢复备份")
    workdir = Path(tempfile.mkdtemp(prefix="deskatlas-setup-"))
    try:
        package = await save_upload(file, workdir)
        result = run_restore(package)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    settings.write_config(ensure_secrets())
    return {**status_payload(), "restore": result}


@router.post("/api/admin/password")
def change_password(payload: PasswordChange, db: Db, admin: Admin) -> dict[str, Any]:
    if not verify_password(payload.current_password, settings.admin_password_hash):
        raise HTTPException(status_code=403, detail="当前密码不正确")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=422, detail="新密码不能与当前密码相同")
    settings.write_config({"ADMIN_PASSWORD_HASH": hash_password(payload.new_password)})
    audit(db, "admin.password_changed", "admin", admin)
    db.commit()
    return {"changed": True}
