from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .database import Base


JsonType = JSON().with_variant(JSONB, "postgresql")


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class UtcDateTime(TypeDecorator):
    """Timezone-aware UTC datetimes on every backend.

    PostgreSQL stores timestamptz natively; SQLite drops the offset, so values are
    normalised to UTC before writing and re-tagged as UTC when read back.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, onupdate=utcnow)


class Room(Base, TimestampMixin):
    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    is_virtual: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    building: Mapped[str | None] = mapped_column(String(120), nullable=True)
    floor: Mapped[str | None] = mapped_column(String(60), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    major_names: Mapped[list[str]] = mapped_column(JsonType, default=list, server_default=text("'[]'"))
    canvas_width: Mapped[int] = mapped_column(Integer, default=960)
    canvas_height: Mapped[int] = mapped_column(Integer, default=620)
    draft_layout: Mapped[list[dict[str, Any]]] = mapped_column(JsonType, default=list)
    published_layout: Mapped[list[dict[str, Any]]] = mapped_column(JsonType, default=list)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    seats: Mapped[list[Seat]] = relationship(back_populates="room", cascade="all, delete-orphan")


class Seat(Base, TimestampMixin):
    __tablename__ = "seats"
    __table_args__ = (UniqueConstraint("room_id", "code", name="uq_seat_room_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    room_id: Mapped[int] = mapped_column(ForeignKey("rooms.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40))
    admin_status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    room: Mapped[Room] = relationship(back_populates="seats")
    assignments: Mapped[list[Assignment]] = relationship(back_populates="seat")
    applications: Mapped[list[Application]] = relationship(back_populates="seat")


class Major(Base, TimestampMixin):
    __tablename__ = "majors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)


class Teacher(Base, TimestampMixin):
    __tablename__ = "teachers"
    __table_args__ = (UniqueConstraint("name", "major_id", name="uq_teacher_center_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    title: Mapped[str | None] = mapped_column(String(80), nullable=True)
    role: Mapped[str | None] = mapped_column(String(120), nullable=True)
    major_id: Mapped[int] = mapped_column(ForeignKey("majors.id", ondelete="RESTRICT"), index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    major: Mapped[Major] = relationship()


class Student(Base, TimestampMixin):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    student_no: Mapped[str | None] = mapped_column(String(40), unique=True, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(80), index=True)
    adviser: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    email: Mapped[str | None] = mapped_column(String(200), nullable=True)
    enrollment_year: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    program_level: Mapped[str | None] = mapped_column(String(16), nullable=True, index=True)
    major_id: Mapped[int | None] = mapped_column(ForeignKey("majors.id", ondelete="SET NULL"), nullable=True)
    is_complete: Mapped[bool] = mapped_column(Boolean, default=True, index=True)

    major: Mapped[Major | None] = relationship()
    assignments: Mapped[list[Assignment]] = relationship(back_populates="student")


class Assignment(Base):
    __tablename__ = "assignments"
    __table_args__ = (
        Index(
            "uq_active_assignment_student",
            "student_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
            sqlite_where=text("ended_at IS NULL"),
        ),
        Index(
            "uq_active_assignment_seat",
            "seat_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
            sqlite_where=text("ended_at IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="RESTRICT"), index=True)
    seat_id: Mapped[str] = mapped_column(ForeignKey("seats.id", ondelete="RESTRICT"), index=True)
    started_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    ended_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True, index=True)
    source: Mapped[str] = mapped_column(String(24), default="admin")
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    student: Mapped[Student] = relationship(back_populates="assignments")
    seat: Mapped[Seat] = relationship(back_populates="assignments")


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (
        Index(
            "uq_pending_application_student",
            "student_no",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
        Index(
            "uq_pending_application_seat",
            "seat_id",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    seat_id: Mapped[str] = mapped_column(ForeignKey("seats.id", ondelete="RESTRICT"), index=True)
    student_no: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(24), default="pending", index=True)
    original_data: Mapped[dict[str, Any]] = mapped_column(JsonType)
    reviewed_data: Mapped[dict[str, Any] | None] = mapped_column(JsonType, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    submitted_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)

    seat: Mapped[Seat] = relationship(back_populates="applications")


class SmtpSetting(Base, TimestampMixin):
    __tablename__ = "smtp_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    host: Mapped[str] = mapped_column(String(240), default="")
    port: Mapped[int] = mapped_column(Integer, default=587)
    security: Mapped[str] = mapped_column(String(20), default="starttls")
    username: Mapped[str] = mapped_column(String(240), default="")
    encrypted_password: Mapped[str] = mapped_column(Text, default="")
    sender_name: Mapped[str] = mapped_column(String(120), default="DeskAtlas")
    sender_email: Mapped[str] = mapped_column(String(240), default="")
    is_configured: Mapped[bool] = mapped_column(Boolean, default=False)


class EmailDelivery(Base):
    __tablename__ = "email_deliveries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    application_id: Mapped[int | None] = mapped_column(ForeignKey("applications.id", ondelete="SET NULL"), nullable=True)
    recipient: Mapped[str] = mapped_column(String(240))
    subject: Mapped[str] = mapped_column(String(240))
    body: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    last_attempt_at: Mapped[datetime | None] = mapped_column(UtcDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    target_type: Mapped[str] = mapped_column(String(80), index=True)
    target_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    before_data: Mapped[dict[str, Any] | None] = mapped_column(JsonType, nullable=True)
    after_data: Mapped[dict[str, Any] | None] = mapped_column(JsonType, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UtcDateTime, default=utcnow, index=True)
