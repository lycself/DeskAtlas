from __future__ import annotations

import copy
import re
import uuid
from collections import Counter, defaultdict
from contextlib import asynccontextmanager
from typing import Any, Annotated

from fastapi import Depends, FastAPI, File, HTTPException, Request, Response, UploadFile, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, defer

from .config import get_settings
from .database import Base, SessionLocal, engine, get_db
from .importer import preview_workbook
from .layout_utils import repair_imported_equipment
from .mailer import create_delivery, deliver, encrypt_secret
from .models import (
    Application,
    Assignment,
    AuditLog,
    EmailDelivery,
    Major,
    Room,
    Seat,
    SmtpSetting,
    Student,
    Teacher,
    utcnow,
)
from .schemas import (
    AdminLogin,
    ApplicationCreate,
    ApplicationReview,
    DirectStudentCreate,
    ImportCommit,
    LayoutSave,
    MajorCreate,
    MajorUpdate,
    MoveStudent,
    RoomCreate,
    RoomUpdate,
    SeatStatusUpdate,
    SmtpConfig,
    StudentUpdate,
    TestEmail,
    TeacherData,
    allowed_years,
)
from .student_rules import ensure_virtual_rooms, place_unassigned, student_email, virtual_seat, VIRTUAL_ROOMS
from .security import (
    check_login_rate_limit,
    clear_login_attempts,
    create_session,
    require_admin,
    verify_password,
)


settings = get_settings()
Db = Annotated[Session, Depends(get_db)]
Admin = Annotated[str, Depends(require_admin)]
INITIAL_MAJORS = [
    "理论物理",
    "凝聚态物理",
    "光学",
    "软物质物理",
    "半导体物理",
    "多信使天体物理",
]


def infer_floor(room_name: str) -> str | None:
    match = re.match(r"^(\d{3,4})", room_name.strip())
    if not match:
        return None
    floor = int(match.group(1)[:-2])
    return f"{floor}层" if floor > 0 else None


def seed_reference_data(db: Session) -> None:
    for order, name in enumerate(INITIAL_MAJORS, start=1):
        existing = db.scalar(select(Major).where(Major.name == name))
        if not existing:
            db.add(Major(name=name, sort_order=order, is_active=True))
    ensure_virtual_rooms(db)
    for student in db.scalars(select(Student).where(Student.is_archived.is_(False), ~Student.assignments.any(Assignment.ended_at.is_(None)))):
        place_unassigned(db, student)
    for student in db.scalars(select(Student)):
        student.email = student_email(student.student_no)
    db.commit()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        seed_reference_data(db)
    yield


app = FastAPI(title="DeskAtlas API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.public_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def audit(
    db: Session,
    action: str,
    target_type: str,
    target_id: str | int | None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    db.add(
        AuditLog(
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            before_data=before,
            after_data=after,
        )
    )


def active_assignment_for_seat(db: Session, seat_id: str) -> Assignment | None:
    return db.scalar(
        select(Assignment)
        .options(joinedload(Assignment.student).joinedload(Student.major))
        .where(Assignment.seat_id == seat_id, Assignment.ended_at.is_(None))
    )


def pending_application_for_seat(db: Session, seat_id: str, exclude_id: int | None = None) -> Application | None:
    query = select(Application).where(Application.seat_id == seat_id, Application.status == "pending")
    if exclude_id is not None:
        query = query.where(Application.id != exclude_id)
    return db.scalar(query)


def seat_eligibility(db: Session, seat: Seat, exclude_application_id: int | None = None) -> str | None:
    if seat.room.is_virtual:
        return "虚拟工位请通过学生管理分组调整"
    if seat.is_archived or seat.room.is_archived:
        return "该工位已归档"
    if seat.admin_status != "active":
        return "该工位当前不可申请"
    if active_assignment_for_seat(db, seat.id):
        return "该工位已被占用"
    if pending_application_for_seat(db, seat.id, exclude_application_id):
        return "该工位已有待审批申请"
    return None


def seat_public_data(db: Session, seat: Seat, *, state: tuple | None = None) -> dict[str, Any]:
    assignment, pending = state if state is not None else (
        active_assignment_for_seat(db, seat.id), pending_application_for_seat(db, seat.id)
    )
    if seat.is_archived or seat.admin_status != "active":
        display_state = "unavailable"
    elif assignment:
        display_state = "occupied"
    elif pending:
        display_state = "pending"
    else:
        display_state = "available"

    occupant = None
    if assignment:
        student = assignment.student
        occupant = {
            "name": student.name,
            "adviser": student.adviser,
            "enrollment_year": student.enrollment_year,
            "program_level": student.program_level,
            "major": student.major.name if student.major else None,
        }
    return {
        "id": seat.id,
        "code": seat.code,
        "admin_status": seat.admin_status,
        "display_state": display_state,
        "note": seat.note,
        "occupant": occupant,
    }


def room_seat_data(db: Session, rooms: list[Room]) -> dict[str, dict[str, Any]]:
    seats = [seat for room in rooms for seat in room.seats if not seat.is_archived]
    if not seats:
        return {}
    ids = [seat.id for seat in seats]
    assignments = {row.seat_id: row for row in db.scalars(
        select(Assignment).options(joinedload(Assignment.student).joinedload(Student.major))
        .where(Assignment.seat_id.in_(ids), Assignment.ended_at.is_(None))
    ).all()}
    pending = set(db.scalars(select(Application.seat_id).where(
        Application.seat_id.in_(ids), Application.status == "pending"
    )).all())
    return {seat.id: seat_public_data(db, seat, state=(assignments.get(seat.id), seat.id in pending)) for seat in seats}


def serialize_rooms(db: Session, rooms: list[Room], *, draft: bool = False, summary_only: bool = False) -> list[dict[str, Any]]:
    seats = room_seat_data(db, rooms)
    return [serialize_room(db, room, draft=draft, seat_data=seats, summary_only=summary_only) for room in rooms]


def serialize_room(db: Session, room: Room, *, draft: bool = False, seat_data: dict | None = None, summary_only: bool = False) -> dict[str, Any]:
    layout = [] if summary_only else (room.draft_layout if draft else room.published_layout)
    all_seats = seat_data if seat_data is not None else room_seat_data(db, [room])
    seats = {seat.id: all_seats[seat.id] for seat in room.seats if seat.id in all_seats}
    items: list[dict[str, Any]] = []
    if room.is_virtual and not summary_only:
        layout = [dict(id=seat_id, type="seat", label=room.name, x=0, y=0,
                       width=76, height=48, rotation=0)
                  for seat_id, seat in seats.items() if seat["occupant"]]
    if room.is_virtual:
        seats = {key: value for key, value in seats.items() if value["occupant"]}
    for raw_item in layout or []:
        item = dict(raw_item)
        if item.get("type") == "seat":
            seat = seats.get(str(item.get("id")))
            if not seat:
                continue
            item["seat"] = seat
        items.append(item)
    return {
        "id": room.id,
        "name": room.name,
        "is_virtual": room.is_virtual,
        "building": room.building,
        "floor": room.floor,
        "description": room.description,
        "major_names": room.major_names or [],
        "canvas_width": room.canvas_width,
        "canvas_height": room.canvas_height,
        "is_published": room.is_published,
        "is_archived": room.is_archived,
        "published_at": room.published_at,
        "items": items,
        "seat_counts": dict(Counter(seat["display_state"] for seat in seats.values())),
    }


def student_is_complete(student: Student) -> bool:
    return all(
        [
            student.student_no,
            student.name,
            student.adviser,
            student.email,
            student.enrollment_year,
            student.program_level,
            student.major_id,
        ]
    )


def student_assignments(db: Session, ids: list[int], *, current_only: bool = False) -> dict[int, list[Assignment]]:
    if not ids:
        return {}
    query = select(Assignment).options(joinedload(Assignment.seat).joinedload(Seat.room)).where(Assignment.student_id.in_(ids))
    if current_only:
        query = query.where(Assignment.ended_at.is_(None))
    grouped: dict[int, list[Assignment]] = defaultdict(list)
    for record in db.scalars(query.order_by(Assignment.started_at.desc(), Assignment.id.desc())).all():
        grouped[record.student_id].append(record)
    return grouped


def serialize_student(db: Session, student: Student, *, records: list[Assignment] | None = None, include_history: bool = True) -> dict[str, Any]:
    records = records if records is not None else student_assignments(db, [student.id]).get(student.id, [])
    current = next((row for row in records if row.ended_at is None), None)
    history = records if include_history else []
    return {
        "id": student.id,
        "student_no": student.student_no,
        "name": student.name,
        "adviser": student.adviser,
        "email": student.email,
        "enrollment_year": student.enrollment_year,
        "program_level": student.program_level,
        "major_id": student.major_id,
        "major": student.major.name if student.major else None,
        "is_complete": student.is_complete,
        "current_assignment": {
            "assignment_id": current.id,
            "seat_id": current.seat_id,
            "seat_code": "虚拟工位" if current.seat.room.is_virtual else current.seat.code,
            "room_id": current.seat.room.id,
            "room_name": current.seat.room.name,
        }
        if current
        else None,
        "history": [
            {
                "id": record.id,
                "room": record.seat.room.name,
                "seat": record.seat.code,
                "started_at": record.started_at,
                "ended_at": record.ended_at,
                "source": record.source,
                "note": record.note,
            }
            for record in history
        ],
    }


@app.get("/health")
def health(db: Db) -> dict[str, str]:
    db.execute(select(1))
    return {"status": "ok"}


@app.post("/api/admin/login")
def admin_login(payload: AdminLogin, request: Request, response: Response) -> dict[str, Any]:
    check_login_rate_limit(request)
    if not settings.admin_username or not settings.admin_password_hash:
        raise HTTPException(status_code=503, detail="管理员账号尚未配置")
    if payload.username != settings.admin_username or not verify_password(payload.password, settings.admin_password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    clear_login_attempts(request)
    response.set_cookie(
        "admin_session",
        create_session(payload.username),
        httponly=True,
        secure=settings.production,
        samesite="strict",
        max_age=settings.session_max_age_seconds,
        path="/",
    )
    return {"authenticated": True, "username": payload.username}


@app.get("/api/admin/session")
def admin_session(admin: Admin) -> dict[str, Any]:
    return {"authenticated": True, "username": admin}


@app.post("/api/admin/logout")
def admin_logout(response: Response, _: Admin) -> dict[str, bool]:
    response.delete_cookie("admin_session", path="/")
    return {"authenticated": False}


@app.get("/api/public/bootstrap")
def public_bootstrap(db: Db) -> dict[str, Any]:
    majors = db.scalars(select(Major).where(Major.is_active.is_(True)).order_by(Major.sort_order, Major.name)).all()
    rooms = db.scalars(
        select(Room)
        .options(joinedload(Room.seats))
        .where(Room.is_published.is_(True), Room.is_archived.is_(False))
        .order_by(Room.name)
    ).unique().all()
    return {
        "years": allowed_years(),
        "program_levels": ["硕士", "博士"],
        "majors": [{"id": major.id, "name": major.name} for major in majors],
        "rooms": serialize_rooms(db, rooms),
    }


@app.get("/api/public/rooms/{room_id}")
def public_room(room_id: int, db: Db) -> dict[str, Any]:
    room = db.scalar(
        select(Room)
        .options(joinedload(Room.seats))
        .where(Room.id == room_id, Room.is_published.is_(True), Room.is_archived.is_(False))
    )
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在或尚未发布")
    return serialize_room(db, room)


@app.post("/api/public/applications", status_code=status.HTTP_201_CREATED)
def create_application(payload: ApplicationCreate, db: Db) -> dict[str, Any]:
    seat = db.scalar(select(Seat).options(joinedload(Seat.room)).where(Seat.id == payload.seat_id))
    if not seat or not seat.room.is_published:
        raise HTTPException(status_code=404, detail="工位不存在")
    major = db.scalar(select(Major).where(Major.id == payload.major_id, Major.is_active.is_(True)))
    if not major:
        raise HTTPException(status_code=422, detail="所选教研中心已停用，请重新选择")
    if message := seat_eligibility(db, seat):
        raise HTTPException(status_code=409, detail=message)
    pending = db.scalar(
        select(Application).where(Application.student_no == payload.student_no, Application.status == "pending")
    )
    if pending:
        raise HTTPException(status_code=409, detail="该学号已有待审批申请，请等待管理员处理")
    assigned = db.scalar(
        select(Assignment)
        .join(Student, Student.id == Assignment.student_id)
        .where(Student.student_no == payload.student_no, Assignment.ended_at.is_(None))
    )
    if assigned and not assigned.seat.room.is_virtual:
        raise HTTPException(status_code=409, detail="该学号已经分配工位，如需调整请联系管理员")

    data = payload.model_dump(mode="json", exclude={"seat_id"})
    application = Application(
        seat_id=payload.seat_id,
        student_no=payload.student_no,
        original_data=data,
        status="pending",
    )
    db.add(application)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该学号或工位刚刚产生了其他申请") from exc
    db.refresh(application)
    return {"status": "pending", "message": "申请已提交，请留意邮箱通知"}


@app.get("/api/admin/overview")
def admin_overview(db: Db, _: Admin) -> dict[str, Any]:
    rooms = db.scalars(select(Room).options(joinedload(Room.seats)).where(Room.is_archived.is_(False), Room.is_virtual.is_(False))).unique().all()
    totals = Counter()
    for room in rooms:
        totals.update(serialize_room(db, room, draft=not room.is_published)["seat_counts"])
    pending = db.scalar(select(func.count()).select_from(Application).where(Application.status == "pending")) or 0
    incomplete = db.scalar(select(func.count()).select_from(Student).where(Student.is_complete.is_(False), Student.is_archived.is_(False))) or 0
    active_students = db.scalar(select(func.count()).select_from(Assignment).where(Assignment.ended_at.is_(None))) or 0

    major_rows = db.execute(
        select(Major.name, func.count(Assignment.id))
        .select_from(Major)
        .join(Student, Student.major_id == Major.id, isouter=True)
        .join(Assignment, (Assignment.student_id == Student.id) & Assignment.ended_at.is_(None), isouter=True)
        .group_by(Major.name, Major.sort_order)
        .order_by(Major.sort_order)
    ).all()
    adviser_rows = db.execute(
        select(Student.adviser, func.count(Assignment.id))
        .join(Assignment, (Assignment.student_id == Student.id) & Assignment.ended_at.is_(None))
        .group_by(Student.adviser)
        .order_by(func.count(Assignment.id).desc())
        .limit(12)
    ).all()
    return {
        "totals": {
            "rooms": len(rooms),
            "seats": sum(totals.values()),
            "available": totals["available"],
            "occupied": totals["occupied"],
            "pending_seats": totals["pending"],
            "unavailable": totals["unavailable"],
            "pending_applications": pending,
            "incomplete_students": incomplete,
            "active_students": active_students,
        },
        "majors": [{"name": name, "count": count} for name, count in major_rows],
        "advisers": [{"name": name or "未填写", "count": count} for name, count in adviser_rows],
    }


@app.get("/api/admin/applications")
def list_applications(db: Db, _: Admin, application_status: str = "pending") -> list[dict[str, Any]]:
    query = (
        select(Application)
        .options(joinedload(Application.seat).joinedload(Seat.room))
        .order_by(Application.submitted_at.desc())
    )
    if application_status != "all":
        query = query.where(Application.status == application_status)
    applications = db.scalars(query).unique().all()
    return [
        {
            "id": item.id,
            "status": item.status,
            "student_no": item.student_no,
            "original_data": item.original_data,
            "reviewed_data": item.reviewed_data,
            "rejection_reason": item.rejection_reason,
            "submitted_at": item.submitted_at,
            "reviewed_at": item.reviewed_at,
            "seat": {
                "id": item.seat.id,
                "code": item.seat.code,
                "room_id": item.seat.room.id,
                "room_name": item.seat.room.name,
            },
        }
        for item in applications
    ]


@app.post("/api/admin/applications/{application_id}/review")
def review_application(application_id: int, payload: ApplicationReview, db: Db, _: Admin) -> dict[str, Any]:
    application = db.scalar(
        select(Application)
        .options(joinedload(Application.seat).joinedload(Seat.room))
        .where(Application.id == application_id)
        .with_for_update()
    )
    if not application:
        raise HTTPException(status_code=404, detail="申请不存在")
    if application.status != "pending":
        raise HTTPException(status_code=409, detail="该申请已经处理")

    reviewed = payload.data.model_dump(mode="json")
    before = {"status": application.status, "original_data": application.original_data}
    application.reviewed_data = reviewed
    application.reviewed_at = utcnow()
    application.rejection_reason = payload.rejection_reason

    if payload.action == "approve":
        major = db.scalar(select(Major).where(Major.id == payload.data.major_id, Major.is_active.is_(True)))
        if not major:
            raise HTTPException(status_code=422, detail="所选教研中心已停用")
        if message := seat_eligibility(db, application.seat, exclude_application_id=application.id):
            raise HTTPException(status_code=409, detail=message)
        existing_assignment = db.scalar(
            select(Assignment)
            .join(Student, Student.id == Assignment.student_id)
            .where(Student.student_no == payload.data.student_no, Assignment.ended_at.is_(None))
        )
        if existing_assignment and not existing_assignment.seat.room.is_virtual:
            raise HTTPException(status_code=409, detail="该学号已经拥有正式工位")
        if existing_assignment:
            existing_assignment.ended_at = utcnow()
            db.flush()
        student = db.scalar(select(Student).where(Student.student_no == payload.data.student_no))
        if not student:
            student = Student(student_no=payload.data.student_no, name=payload.data.name)
            db.add(student)
            db.flush()
        student.name = payload.data.name
        student.is_archived = False
        student.adviser = payload.data.adviser
        student.email = str(payload.data.email)
        student.enrollment_year = payload.data.enrollment_year
        student.program_level = payload.data.program_level
        student.major_id = payload.data.major_id
        student.is_complete = True
        db.add(Assignment(student_id=student.id, seat_id=application.seat_id, source="application"))
        application.status = "approved"
    else:
        application.status = "rejected"

    audit(
        db,
        f"application.{application.status}",
        "application",
        application.id,
        before,
        {"status": application.status, "reviewed_data": reviewed, "reason": application.rejection_reason},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="审批时检测到工位或学生冲突，请刷新后重试") from exc

    if application.status == "approved":
        subject = "DeskAtlas 工位申请已通过"
        body = (
            f"{reviewed['name']}同学：\n\n你的工位申请已通过。\n"
            f"房间：{application.seat.room.name}\n工位：{application.seat.code}\n\nDeskAtlas"
        )
    else:
        subject = "DeskAtlas 工位申请结果"
        reason = f"\n原因：{application.rejection_reason}" if application.rejection_reason else ""
        body = f"{reviewed['name']}同学：\n\n你的工位申请未通过。{reason}\n\nDeskAtlas"
    delivery = create_delivery(
        db,
        recipient=str(payload.data.email),
        subject=subject,
        body=body,
        application_id=application.id,
    )
    return {"application_id": application.id, "status": application.status, "email_status": delivery.status}


@app.get("/api/admin/rooms")
def list_rooms(db: Db, _: Admin, include_archived: bool = False, summary_only: bool = False) -> list[dict[str, Any]]:
    query = select(Room).options(joinedload(Room.seats)).order_by(Room.name)
    if not include_archived:
        query = query.where(Room.is_archived.is_(False))
    if summary_only:
        query = query.options(defer(Room.draft_layout), defer(Room.published_layout))
    return serialize_rooms(db, db.scalars(query).unique().all(), draft=True, summary_only=summary_only)


@app.post("/api/admin/rooms", status_code=201)
def create_room(payload: RoomCreate, db: Db, _: Admin) -> dict[str, Any]:
    room = Room(**payload.model_dump())
    db.add(room)
    try:
        db.flush()
        audit(db, "room.created", "room", room.id, after=payload.model_dump())
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="房间名称已存在") from exc
    db.refresh(room)
    return serialize_room(db, room, draft=True)


@app.patch("/api/admin/rooms/{room_id}")
def update_room(room_id: int, payload: RoomUpdate, db: Db, _: Admin) -> dict[str, Any]:
    room = db.scalar(select(Room).options(joinedload(Room.seats)).where(Room.id == room_id))
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")
    if room.is_virtual:
        raise HTTPException(status_code=422, detail="系统虚拟工位不能改名或归档，请在学生管理中调整人员")
    values = payload.model_dump(exclude_unset=True)
    if values.get("is_archived"):
        seat_ids = [seat.id for seat in room.seats]
        active = db.scalar(
            select(func.count()).select_from(Assignment).where(
                Assignment.seat_id.in_(seat_ids), Assignment.ended_at.is_(None)
            )
        ) if seat_ids else 0
        pending = db.scalar(
            select(func.count()).select_from(Application).where(
                Application.seat_id.in_(seat_ids), Application.status == "pending"
            )
        ) if seat_ids else 0
        if active or pending:
            raise HTTPException(status_code=409, detail="房间仍有在用工位或待审批申请，不能归档")
    before = {key: getattr(room, key) for key in values}
    for key, value in values.items():
        setattr(room, key, value)
    audit(db, "room.updated", "room", room.id, before, values)
    db.commit()
    db.refresh(room)
    return serialize_room(db, room, draft=True)


@app.get("/api/admin/rooms/{room_id}/layout")
def get_room_layout(room_id: int, db: Db, _: Admin) -> dict[str, Any]:
    room = db.scalar(select(Room).options(joinedload(Room.seats)).where(Room.id == room_id))
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")
    return serialize_room(db, room, draft=True)


@app.put("/api/admin/rooms/{room_id}/layout")
def save_room_layout(room_id: int, payload: LayoutSave, db: Db, _: Admin) -> dict[str, Any]:
    room = db.scalar(select(Room).options(joinedload(Room.seats)).where(Room.id == room_id))
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")
    if room.is_virtual:
        raise HTTPException(status_code=422, detail="虚拟工位不使用平面图")
    existing_by_id = {seat.id: seat for seat in room.seats}
    existing_by_code = {seat.code: seat for seat in room.seats}
    normalized: list[dict[str, Any]] = []
    for item_model in payload.items:
        item = item_model.model_dump()
        if item["type"] == "seat":
            seat = existing_by_id.get(str(item.get("id"))) if item.get("id") else None
            if not seat:
                seat = existing_by_code.get(item["label"])
            if not seat:
                seat = Seat(id=str(uuid.uuid4()), room_id=room.id, code=item["label"])
                db.add(seat)
                db.flush()
            elif seat.room_id != room.id:
                raise HTTPException(status_code=409, detail="座位标识属于其他房间")
            seat.code = item["label"]
            item["id"] = seat.id
        else:
            item["id"] = item.get("id") or str(uuid.uuid4())
        normalized.append(item)
    before = {"items": room.draft_layout}
    room.draft_layout = normalized
    audit(db, "layout.draft_saved", "room", room.id, before, {"items": normalized})
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="座位编号重复") from exc
    db.refresh(room)
    return serialize_room(db, room, draft=True)


@app.post("/api/admin/rooms/{room_id}/publish")
def publish_room_layout(room_id: int, db: Db, _: Admin) -> dict[str, Any]:
    room = db.scalar(select(Room).options(joinedload(Room.seats)).where(Room.id == room_id))
    if not room:
        raise HTTPException(status_code=404, detail="房间不存在")
    if room.is_virtual:
        raise HTTPException(status_code=422, detail="虚拟工位不使用平面图")
    draft_seat_ids = {str(item["id"]) for item in room.draft_layout or [] if item.get("type") == "seat"}
    for seat in room.seats:
        if seat.id in draft_seat_ids:
            seat.is_archived = False
            continue
        active = active_assignment_for_seat(db, seat.id)
        pending = pending_application_for_seat(db, seat.id)
        if active or pending:
            raise HTTPException(status_code=409, detail=f"座位 {seat.code} 仍有占用或申请，不能从布局移除")
        seat.is_archived = True
    room.published_layout = copy.deepcopy(room.draft_layout or [])
    room.is_published = True
    room.published_at = utcnow()
    audit(db, "layout.published", "room", room.id, after={"seat_count": len(draft_seat_ids)})
    db.commit()
    db.refresh(room)
    return serialize_room(db, room)


@app.patch("/api/admin/seats/{seat_id}/status")
def update_seat_status(seat_id: str, payload: SeatStatusUpdate, db: Db, _: Admin) -> dict[str, Any]:
    seat = db.scalar(select(Seat).options(joinedload(Seat.room)).where(Seat.id == seat_id))
    if not seat:
        raise HTTPException(status_code=404, detail="工位不存在")
    if payload.status != "active" and (active_assignment_for_seat(db, seat.id) or pending_application_for_seat(db, seat.id)):
        raise HTTPException(status_code=409, detail="有占用或申请的工位不能直接停用")
    before = {"status": seat.admin_status, "note": seat.note}
    seat.admin_status = payload.status
    seat.note = payload.note
    audit(db, "seat.status_updated", "seat", seat.id, before, payload.model_dump())
    db.commit()
    return seat_public_data(db, seat)


@app.get("/api/admin/seats/{seat_id}/context")
def seat_admin_context(seat_id: str, db: Db, _: Admin) -> dict[str, Any]:
    seat = db.get(Seat, seat_id)
    if not seat or seat.is_archived or seat.room.is_archived:
        raise HTTPException(status_code=404, detail="工位不存在")
    assignment = active_assignment_for_seat(db, seat_id)
    pending = pending_application_for_seat(db, seat_id)
    return {"student": serialize_student(db, assignment.student) if assignment else None,
            "pending_application_id": pending.id if pending else None}


@app.get("/api/admin/students")
def list_students(db: Db, _: Admin, incomplete_only: bool = False) -> list[dict[str, Any]]:
    query = select(Student).options(joinedload(Student.major)).where(Student.is_archived.is_(False)).order_by(Student.name)
    if incomplete_only:
        query = query.where(Student.is_complete.is_(False))
    students = db.scalars(query).unique().all()
    assignments = student_assignments(db, [student.id for student in students])
    return [serialize_student(db, student, records=assignments.get(student.id, [])) for student in students]


@app.get("/api/admin/student-directory")
def student_directory(db: Db, _: Admin, q: str = "", incomplete_only: bool = False,
                      placement: str = "",
                      offset: int = Query(default=0, ge=0), limit: int = Query(default=30, ge=1, le=100)) -> dict[str, Any]:
    filters = [Student.is_archived.is_(False)]
    if placement:
        room_filter = Room.is_virtual.is_(False) if placement == "physical" else Room.name == placement
        filters.append(Student.assignments.any((Assignment.ended_at.is_(None)) & Assignment.seat.has(Seat.room.has(room_filter))))
    if incomplete_only:
        filters.append(Student.is_complete.is_(False))
    if q.strip():
        filters.append(or_(*(column.icontains(q.strip(), autoescape=True) for column in (Student.name, Student.student_no, Student.adviser))))
    total = db.scalar(select(func.count()).select_from(Student).where(*filters))
    students = db.scalars(select(Student).options(joinedload(Student.major)).where(*filters)
                          .order_by(Student.name, Student.id).offset(offset).limit(limit)).all()
    assignments = student_assignments(db, [student.id for student in students], current_only=True)
    return {"total": total, "items": [serialize_student(db, student, records=assignments.get(student.id, []), include_history=False) for student in students]}


@app.get("/api/admin/students/{student_id}")
def get_student(student_id: int, db: Db, _: Admin) -> dict[str, Any]:
    student = db.scalar(select(Student).options(joinedload(Student.major)).where(Student.id == student_id))
    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")
    return serialize_student(db, student)


@app.get("/api/admin/options")
def admin_options(db: Db, _: Admin) -> dict[str, Any]:
    majors = db.scalars(select(Major).order_by(Major.sort_order, Major.name)).all()
    return {"years": allowed_years(), "program_levels": ["硕士", "博士"],
            "majors": [{"id": major.id, "name": major.name, "is_active": major.is_active} for major in majors]}


@app.get("/api/admin/available-seats")
def available_seats(db: Db, _: Admin) -> list[dict[str, Any]]:
    seats = db.scalars(select(Seat).options(joinedload(Seat.room)).join(Room).where(
        Seat.is_archived.is_(False), Room.is_archived.is_(False), Room.is_virtual.is_(False), Seat.admin_status == "active",
        ~Seat.assignments.any(Assignment.ended_at.is_(None)),
        ~Seat.applications.any(Application.status == "pending"),
    ).order_by(Room.name, Seat.code)).all()
    return [{"id": f"virtual:{name}", "label": f"虚拟工位 · {name}"} for name in VIRTUAL_ROOMS] + [{"id": seat.id, "label": f"{seat.room.floor or infer_floor(seat.room.name) or '未设置楼层'} · {seat.room.name} · {seat.code}"}
            for seat in seats if any(item.get("id") == seat.id for item in seat.room.draft_layout or [])]


def resolve_destination(db: Session, student: Student, destination: str) -> Seat | None:
    if destination.startswith("virtual:"):
        name = destination.removeprefix("virtual:")
        if name not in VIRTUAL_ROOMS:
            raise HTTPException(status_code=422, detail="虚拟工位不存在")
        return virtual_seat(db, student, name)
    seat = db.scalar(select(Seat).options(joinedload(Seat.room)).where(Seat.id == destination).with_for_update())
    if seat and seat.room.is_virtual:
        raise HTTPException(status_code=422, detail="请选择虚拟分组，不要使用个人虚拟编号")
    return seat


@app.post("/api/admin/students", status_code=201)
def create_student(payload: DirectStudentCreate, db: Db, _: Admin) -> dict[str, Any]:
    if payload.student_no and db.scalar(select(Student).where(Student.student_no == payload.student_no)):
        raise HTTPException(status_code=409, detail="该学号已存在")
    data = payload.model_dump(exclude={"seat_id"})
    if data.get("email") is not None:
        data["email"] = str(data["email"])
    student = Student(**data)
    student.is_complete = student_is_complete(student)
    db.add(student)
    db.flush()
    if payload.seat_id:
        seat = resolve_destination(db, student, payload.seat_id)
        if not seat:
            db.rollback()
            raise HTTPException(status_code=404, detail="目标工位不存在")
        if message := (None if seat.room.is_virtual else seat_eligibility(db, seat)):
            db.rollback()
            raise HTTPException(status_code=409, detail=message)
        db.add(Assignment(student_id=student.id, seat_id=seat.id, source="admin"))
    else:
        place_unassigned(db, student)
    audit(db, "student.created", "student", student.id, after={"name": student.name, "seat_id": payload.seat_id})
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="学生或工位数据冲突") from exc
    db.refresh(student)
    return serialize_student(db, student)


@app.patch("/api/admin/students/{student_id}")
def update_student(student_id: int, payload: StudentUpdate, db: Db, _: Admin) -> dict[str, Any]:
    student = db.scalar(select(Student).options(joinedload(Student.major)).where(Student.id == student_id))
    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")
    values = payload.model_dump(exclude_unset=True)
    values["email"] = student_email(values.get("student_no", student.student_no))
    before = {key: getattr(student, key) for key in values}
    for key, value in values.items():
        setattr(student, key, value)
    student.is_complete = student_is_complete(student)
    audit(db, "student.updated", "student", student.id, before, values)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="学号已被其他学生使用") from exc
    db.refresh(student)
    return serialize_student(db, student)


@app.post("/api/admin/students/{student_id}/move")
def move_student(student_id: int, payload: MoveStudent, db: Db, _: Admin) -> dict[str, Any]:
    student = db.scalar(select(Student).options(joinedload(Student.major)).where(Student.id == student_id))
    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")
    current = db.scalar(
        select(Assignment)
        .options(joinedload(Assignment.seat).joinedload(Seat.room))
        .where(Assignment.student_id == student.id, Assignment.ended_at.is_(None))
        .with_for_update()
    )
    target = resolve_destination(db, student, payload.seat_id)
    if not target:
        raise HTTPException(status_code=404, detail="目标工位不存在")
    if current and current.seat_id == target.id:
        raise HTTPException(status_code=409, detail="学生已经在该工位")
    if message := (None if target.room.is_virtual else seat_eligibility(db, target)):
        raise HTTPException(status_code=409, detail=message)
    before = {"seat_id": current.seat_id if current else None}
    if current:
        current.ended_at = utcnow()
        db.flush()
    db.add(Assignment(student_id=student.id, seat_id=target.id, source="move", note=payload.note))
    audit(db, "assignment.moved", "student", student.id, before, {"seat_id": target.id, "note": payload.note})
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="目标工位刚刚发生变化，请刷新后重试") from exc
    return serialize_student(db, student)


@app.post("/api/admin/students/{student_id}/release")
def release_student(student_id: int, db: Db, _: Admin) -> dict[str, Any]:
    student = db.scalar(select(Student).options(joinedload(Student.major)).where(Student.id == student_id))
    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")
    current = db.scalar(
        select(Assignment).where(Assignment.student_id == student.id, Assignment.ended_at.is_(None)).with_for_update()
    )
    if not current:
        raise HTTPException(status_code=409, detail="该学生当前没有工位")
    current.ended_at = utcnow()
    db.flush()
    place_unassigned(db, student)
    audit(db, "assignment.released", "student", student.id, {"seat_id": current.seat_id}, {"seat_id": None})
    db.commit()
    return serialize_student(db, student)


@app.get("/api/admin/majors")
def list_majors(db: Db, _: Admin) -> list[dict[str, Any]]:
    majors = db.scalars(select(Major).order_by(Major.sort_order, Major.name)).all()
    return [
        {"id": major.id, "name": major.name, "sort_order": major.sort_order, "is_active": major.is_active}
        for major in majors
    ]


@app.post("/api/admin/majors", status_code=201)
def create_major(payload: MajorCreate, db: Db, _: Admin) -> dict[str, Any]:
    major = Major(**payload.model_dump(), is_active=True)
    db.add(major)
    try:
        db.flush()
        audit(db, "major.created", "major", major.id, after=payload.model_dump())
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="教研中心名称已存在") from exc
    db.refresh(major)
    return {"id": major.id, "name": major.name, "sort_order": major.sort_order, "is_active": major.is_active}


@app.patch("/api/admin/majors/{major_id}")
def update_major(major_id: int, payload: MajorUpdate, db: Db, _: Admin) -> dict[str, Any]:
    major = db.get(Major, major_id)
    if not major:
        raise HTTPException(status_code=404, detail="教研中心不存在")
    values = payload.model_dump(exclude_unset=True)
    before = {key: getattr(major, key) for key in values}
    for key, value in values.items():
        setattr(major, key, value)
    audit(db, "major.updated", "major", major.id, before, values)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="教研中心名称已存在") from exc
    db.refresh(major)
    return {"id": major.id, "name": major.name, "sort_order": major.sort_order, "is_active": major.is_active}


def teacher_data(teacher: Teacher) -> dict[str, Any]:
    return {"id": teacher.id, "name": teacher.name, "title": teacher.title, "role": teacher.role,
            "major_id": teacher.major_id, "is_active": teacher.is_active}


@app.get("/api/admin/teachers")
def list_teachers(db: Db, _: Admin) -> list[dict[str, Any]]:
    return [teacher_data(t) for t in db.scalars(select(Teacher).order_by(Teacher.major_id, Teacher.name))]


@app.post("/api/admin/teachers", status_code=201)
def create_teacher(payload: TeacherData, db: Db, _: Admin) -> dict[str, Any]:
    return save_teacher(db, Teacher(), payload, create=True)


@app.put("/api/admin/teachers/{teacher_id}")
def update_teacher(teacher_id: int, payload: TeacherData, db: Db, _: Admin) -> dict[str, Any]:
    teacher = db.get(Teacher, teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="教师不存在")
    return save_teacher(db, teacher, payload)


def save_teacher(db: Session, teacher: Teacher, payload: TeacherData, *, create: bool = False) -> dict[str, Any]:
    if not db.get(Major, payload.major_id):
        raise HTTPException(status_code=422, detail="教研中心不存在")
    before = None if create else teacher_data(teacher)
    for key, value in payload.model_dump().items():
        setattr(teacher, key, value)
    db.add(teacher)
    try:
        db.flush()
        audit(db, "teacher.created" if create else "teacher.updated", "teacher", teacher.id, before, teacher_data(teacher))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="该教研中心已有同名教师") from exc
    return teacher_data(teacher)


@app.get("/api/admin/smtp")
def get_smtp(db: Db, _: Admin) -> dict[str, Any]:
    config = db.get(SmtpSetting, 1)
    if not config:
        return {"is_configured": False}
    return {
        "host": config.host,
        "port": config.port,
        "security": config.security,
        "username": config.username,
        "sender_name": config.sender_name,
        "sender_email": config.sender_email,
        "has_password": bool(config.encrypted_password),
        "is_configured": config.is_configured,
    }


@app.put("/api/admin/smtp")
def save_smtp(payload: SmtpConfig, db: Db, _: Admin) -> dict[str, Any]:
    config = db.get(SmtpSetting, 1) or SmtpSetting(id=1)
    before = {"host": config.host, "port": config.port, "security": config.security, "username": config.username}
    config.host = payload.host
    config.port = payload.port
    config.security = payload.security
    config.username = payload.username
    config.sender_name = payload.sender_name
    config.sender_email = str(payload.sender_email)
    if payload.password:
        try:
            config.encrypted_password = encrypt_secret(payload.password)
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=503, detail="邮件配置加密密钥不可用，请检查服务器 SETTINGS_ENCRYPTION_KEY") from exc
    config.is_configured = bool(config.host and config.sender_email)
    db.add(config)
    audit(db, "smtp.updated", "smtp", 1, before, {"host": config.host, "port": config.port, "security": config.security, "username": config.username})
    db.commit()
    return get_smtp(db, _)


@app.post("/api/admin/smtp/test")
def test_smtp(payload: TestEmail, db: Db, _: Admin) -> dict[str, Any]:
    delivery = create_delivery(
        db,
        recipient=str(payload.recipient),
        subject="DeskAtlas SMTP 测试",
        body="如果你收到这封邮件，说明 DeskAtlas 的 SMTP 配置可以正常发送邮件。",
    )
    return {"status": delivery.status, "error": delivery.error}


@app.get("/api/admin/email-deliveries")
def list_deliveries(db: Db, _: Admin) -> list[dict[str, Any]]:
    rows = db.scalars(select(EmailDelivery).order_by(EmailDelivery.created_at.desc()).limit(100)).all()
    return [
        {
            "id": row.id,
            "application_id": row.application_id,
            "recipient": row.recipient,
            "subject": row.subject,
            "status": row.status,
            "error": row.error,
            "attempt_count": row.attempt_count,
            "last_attempt_at": row.last_attempt_at,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@app.post("/api/admin/email-deliveries/{delivery_id}/retry")
def retry_delivery(delivery_id: int, db: Db, _: Admin) -> dict[str, Any]:
    row = db.get(EmailDelivery, delivery_id)
    if not row:
        raise HTTPException(status_code=404, detail="邮件记录不存在")
    row.status = "pending"
    row.error = None
    db.commit()
    row = deliver(db, row)
    return {"id": row.id, "status": row.status, "error": row.error}


@app.get("/api/admin/audit")
def list_audit(db: Db, _: Admin, action: str | None = None, target_type: str | None = None) -> list[dict[str, Any]]:
    query = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(300)
    if action:
        query = query.where(AuditLog.action.contains(action))
    if target_type:
        query = query.where(AuditLog.target_type == target_type)
    rows = db.scalars(query).all()
    return [
        {
            "id": row.id,
            "action": row.action,
            "target_type": row.target_type,
            "target_id": row.target_id,
            "before_data": row.before_data,
            "after_data": row.after_data,
            "created_at": row.created_at,
        }
        for row in rows
    ]


@app.post("/api/admin/import/preview")
async def import_preview(db: Db, _: Admin, file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=422, detail="请选择 .xlsx 文件")
    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="文件不能超过 20MB")
    try:
        result = preview_workbook(content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return result


@app.post("/api/admin/import/commit")
def import_commit(payload: ImportCommit, db: Db, _: Admin) -> dict[str, Any]:
    counts = Counter(created_rooms=0, created_seats=0, created_students=0, created_assignments=0, updated=0, equipment=0, skipped=0, unresolved=0)
    room_layouts: dict[int, list[dict[str, Any]]] = {}
    try:
        for row in payload.rows:
            if row.get("warnings") and not row.get("confirmed"):
                counts["unresolved"] += 1
            room_name = str(row.get("room_name") or "").strip()
            if not room_name:
                counts["skipped"] += 1
                continue
            room = db.scalar(select(Room).where(Room.name == room_name))
            if not room:
                room = Room(name=room_name, floor=infer_floor(room_name))
                db.add(room)
                db.flush()
                counts["created_rooms"] += 1
            layout = room_layouts.setdefault(room.id, list(room.draft_layout or room.published_layout or []))
            room_major = str(row.get("major_name") or "").strip()
            if room_major and room_major not in (room.major_names or []):
                room.major_names = [*(room.major_names or []), room_major]

            if row.get("kind") == "equipment":
                equipment_id = f"import-equipment-{room.id}-{row.get('source_row')}"
                if not any(item.get("id") == equipment_id for item in layout):
                    index = len(layout)
                    layout.append(
                        {
                            "id": equipment_id,
                            "type": "equipment",
                            "label": str(row.get("person_name") or "设备"),
                            "x": 40 + (index % 8) * 105,
                            "y": 40 + (index // 8) * 82,
                            "width": 82,
                            "height": 52,
                            "rotation": 0,
                        }
                    )
                    counts["equipment"] += 1
                continue

            seat_code = str(row.get("seat_code") or "").strip()
            if not seat_code:
                counts["skipped"] += 1
                continue
            seat = db.scalar(select(Seat).where(Seat.room_id == room.id, Seat.code == seat_code))
            if not seat:
                seat = Seat(room_id=room.id, code=seat_code)
                db.add(seat)
                db.flush()
                counts["created_seats"] += 1
            if not any(item.get("type") == "seat" and item.get("id") == seat.id for item in layout):
                seat_index = sum(item.get("type") == "seat" for item in layout)
                layout.append(
                    {
                        "id": seat.id,
                        "type": "seat",
                        "label": seat.code,
                        "x": 48 + (seat_index % 8) * 105,
                        "y": 48 + (seat_index // 8) * 82,
                        "width": 76,
                        "height": 48,
                        "rotation": 0,
                    }
                )

            person_name = str(row.get("person_name") or "").strip()
            if not person_name or row.get("kind") == "empty":
                continue
            if active_assignment_for_seat(db, seat.id):
                counts["skipped"] += 1
                continue
            major = None
            major_name = str(row.get("major_name") or "").strip()
            if major_name:
                major = db.scalar(select(Major).where(Major.name == major_name))
                if not major:
                    major = Major(name=major_name, sort_order=999, is_active=True)
                    db.add(major)
                    db.flush()
            student = Student(
                name=person_name,
                adviser=row.get("adviser"),
                enrollment_year=row.get("enrollment_year"),
                program_level=row.get("program_level"),
                major_id=major.id if major else None,
                is_complete=False,
            )
            db.add(student)
            db.flush()
            db.add(Assignment(student_id=student.id, seat_id=seat.id, source="import", note=row.get("note")))
            counts["created_students"] += 1
            counts["created_assignments"] += 1

        for room_id, layout in room_layouts.items():
            room = db.get(Room, room_id)
            if room:
                repaired, _ = repair_imported_equipment(layout, room.canvas_width, room.canvas_height)
                room.draft_layout = repaired
                room.published_layout = copy.deepcopy(repaired)
                room.is_published = True
                room.published_at = utcnow()
        audit(db, "import.committed", "import", None, after=dict(counts))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return dict(counts)
