"""Interactive, backed-up import of the four arrangement workbooks."""
from __future__ import annotations

import io
import json
import shutil
import threading
import time
import uuid
from typing import Annotated
from zipfile import BadZipFile

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import engine, get_db
from .datatransfer import backup_filename, export_backup
from .latest_import import apply_latest, latest_preview
from .models import AuditLog, Room, Student, Application
from .security import require_admin

router = APIRouter(prefix="/api/admin/import")
Db = Annotated[Session, Depends(get_db)]
Admin = Annotated[str, Depends(require_admin)]
settings = get_settings()
_commit_lock = threading.Lock()
ROLES = ("roster", "floorplan", "directory", "teachers")
MAX_FILE = 20 * 1024 * 1024
TTL = 60 * 60


@router.get("/template")
def template(_: Admin):
    book = Workbook()
    book.active.title = "工位表"
    book.active.append(["房间", "座位号", "姓名或设备名", "导师", "年级", "培养层次", "教研中心", "学生备注", "工位备注"])
    book.active.append(["301", "1", "示例学生", "示例导师", 2026, "硕士", "光学", "", ""])
    book.active.append(["301", "2", "", "", "", "", "光学", "", ""])
    stream = io.BytesIO()
    book.save(stream)
    return StreamingResponse(iter([stream.getvalue()]), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers={"Content-Disposition": 'attachment; filename="DeskAtlas-template.xlsx"'})


def revision(db: Session) -> int:
    return db.scalar(select(func.max(AuditLog.id))) or 0


def parse(files: dict[str, bytes], choices: dict[str, str] | None = None) -> dict:
    try:
        return latest_preview(**files, seat_overrides=choices)
    except (ValueError, KeyError, IndexError, BadZipFile, TypeError) as exc:
        detail = str(exc) if isinstance(exc, ValueError) else "文件结构不符合要求，请核对四份文件的对应位置和首行表头"
        raise HTTPException(422, detail=detail) from exc


@router.post("/arrangement/preview")
async def preview(db: Db, admin: Admin, roster: UploadFile = File(...), floorplan: UploadFile = File(...), directory: UploadFile = File(...), teachers: UploadFile = File(...)) -> dict:
    files = {}
    for role, upload in zip(ROLES, (roster, floorplan, directory, teachers)):
        if not upload.filename or not upload.filename.lower().endswith(".xlsx"):
            raise HTTPException(422, "四份文件都需要使用 .xlsx 格式")
        content = await upload.read(MAX_FILE + 1)
        if len(content) > MAX_FILE:
            raise HTTPException(413, "每份文件不能超过 20MB")
        files[role] = content
    result = parse(files)
    if not result["students"] or not result["teachers"] or not result["rooms"]:
        raise HTTPException(422, "学生名册、教师名单和房间数据均不能为空")
    root = settings.upload_dir / "arrangement-previews"
    root.mkdir(parents=True, exist_ok=True)
    for old in root.iterdir():
        if old.is_dir() and old.stat().st_mtime < time.time() - TTL:
            shutil.rmtree(old, ignore_errors=True)
    token = uuid.uuid4().hex
    folder = root / token
    folder.mkdir(mode=0o700)
    for role, content in files.items():
        (folder / f"{role}.xlsx").write_bytes(content)
    (folder / "meta.json").write_text(json.dumps({"created": time.time(), "admin": admin, "revision": revision(db)}))
    existing_rooms = set(db.scalars(select(Room.name).where(Room.is_virtual.is_(False), Room.is_archived.is_(False))))
    changes = {"current_students": db.scalar(select(func.count()).select_from(Student).where(Student.is_archived.is_(False))) or 0,
               "new_rooms": sorted(set(result["rooms"]) - existing_rooms),
               "archived_rooms": sorted(existing_rooms - set(result["rooms"])),
               "pending_applications": db.scalar(select(func.count()).select_from(Application).where(Application.status == "pending")) or 0}
    return {"changes": changes, "preview_id": token, "summary": result["summary"], "identity_warnings": result["identity_warnings"], "assignment_conflicts": result["assignment_conflicts"], "rooms": [{"name": name, "seats": len(room["rows"]), "missing": room.get("missing", []), "duplicates": list(room.get("duplicates", {})), "extra": room.get("extra", [])} for name, room in result["rooms"].items()]}


class Commit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    preview_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    choices: dict[str, str] = Field(default_factory=dict)
    acknowledged: bool = False


@router.post("/arrangement/commit")
def commit(payload: Commit, db: Db, admin: Admin) -> dict:
    if not payload.acknowledged:
        raise HTTPException(422, "请确认已检查变更和待核对记录")
    folder = settings.upload_dir / "arrangement-previews" / payload.preview_id
    with _commit_lock:
        try:
            meta = json.loads((folder / "meta.json").read_text())
            files = {role: (folder / f"{role}.xlsx").read_bytes() for role in ROLES}
        except (FileNotFoundError, ValueError):
            raise HTTPException(410, "预览已失效，请重新上传") from None
        if time.time() - meta["created"] > TTL or meta["admin"] != admin:
            raise HTTPException(410, "预览已失效，请重新上传")
        if revision(db) != meta["revision"]:
            raise HTTPException(409, "预览后数据已发生变化，请重新生成预览")
        initial = parse(files)
        conflicts = {item["student_no"]: item for item in initial["assignment_conflicts"]}
        if set(payload.choices) != set(conflicts):
            raise HTTPException(422, "请逐项处理重复安排，选择一个工位或暂不分配")
        for number, choice in payload.choices.items():
            if choice != "unassigned" and choice not in conflicts[number]["seats"]:
                raise HTTPException(422, "重复安排的确认工位无效")
        resolved = parse(files, {key: value for key, value in payload.choices.items() if value != "unassigned"})
        if db.scalar(select(Application.id).where(Application.status == "pending").limit(1)):
            raise HTTPException(409, "有待审批申请，请先处理后再同步最新安排")
        # Finish the read transaction before taking a portable database snapshot.
        db.rollback()
        name = backup_filename("before-arrangement")
        try:
            export_backup(engine, settings, settings.backup_dir / name, kind="before-import")
        except Exception as exc:
            raise HTTPException(500, "导入前自动备份失败，未写入任何数据。请检查备份目录后重试。") from exc
        try:
            db.connection(execution_options={"isolation_level": "SERIALIZABLE"})
            if revision(db) != meta["revision"]:
                raise ValueError("备份期间数据已发生变化，请重新生成预览")
            result = apply_latest(db, resolved)
            db.commit()
        except Exception as exc:
            db.rollback()
            if isinstance(exc, ValueError):
                raise HTTPException(409, str(exc)) from exc
            raise HTTPException(500, "导入失败，所有数据库变更已回滚，备份已保留。") from exc
        shutil.rmtree(folder, ignore_errors=True)
        return {"result": result, "backup": name}
