from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


def allowed_years() -> list[int]:
    current = datetime.now(ZoneInfo("Asia/Shanghai")).year
    return list(range(2020, current + 2))


class StudentData(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    student_no: str = Field(min_length=1, max_length=40)
    adviser: str = Field(min_length=1, max_length=80)
    email: EmailStr
    enrollment_year: int
    program_level: Literal["硕士", "博士"]
    major_id: int

    @field_validator("name", "student_no", "adviser", mode="before")
    @classmethod
    def trim_required_text(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("email")
    @classmethod
    def require_student_email(cls, value: EmailStr) -> EmailStr:
        normalized = str(value).strip().lower()
        if not normalized.endswith("@stu.xmu.edu"):
            raise ValueError("请使用以 @stu.xmu.edu 结尾的学生邮箱")
        return normalized

    @field_validator("enrollment_year")
    @classmethod
    def require_allowed_year(cls, value: int) -> int:
        if value not in allowed_years():
            raise ValueError("年级不在当前允许范围内")
        return value


class ApplicationCreate(StudentData):
    seat_id: str


class ApplicationReview(BaseModel):
    action: Literal["approve", "reject"]
    data: StudentData
    rejection_reason: str | None = Field(default=None, max_length=1000)

    @field_validator("rejection_reason", mode="before")
    @classmethod
    def normalize_reason(cls, value: Any) -> Any:
        if isinstance(value, str):
            return value.strip() or None
        return value


class RoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    building: str | None = Field(default=None, max_length=120)
    floor: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=1000)
    major_names: list[str] = Field(default_factory=list, max_length=20)
    canvas_width: int = Field(default=960, ge=480, le=2400)
    canvas_height: int = Field(default=620, ge=320, le=1600)

    @field_validator("name", "building", "floor", "description", mode="before")
    @classmethod
    def trim_text(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("major_names")
    @classmethod
    def normalize_majors(cls, values: list[str]) -> list[str]:
        if any(not value.strip() or len(value.strip()) > 120 for value in values):
            raise ValueError("专业名称不能为空且不能超过120字")
        return list(dict.fromkeys(value.strip() for value in values))


class RoomUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    building: str | None = Field(default=None, max_length=120)
    floor: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=1000)
    major_names: list[str] = Field(default_factory=list, max_length=20)
    canvas_width: int | None = Field(default=None, ge=480, le=2400)
    canvas_height: int | None = Field(default=None, ge=320, le=1600)
    is_archived: bool | None = None

    @field_validator("major_names")
    @classmethod
    def normalize_majors(cls, values: list[str]) -> list[str]:
        return RoomCreate.normalize_majors(values)


class LayoutItem(BaseModel):
    id: str | None = None
    type: Literal["seat", "door", "window", "aisle", "column", "equipment", "label", "wall"]
    label: str = Field(default="", max_length=80)
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    rotation: float = Field(default=0, ge=-360, le=360)


class LayoutSave(BaseModel):
    items: list[LayoutItem]

    @model_validator(mode="after")
    def require_unique_seat_labels(self) -> "LayoutSave":
        labels = [item.label.strip() for item in self.items if item.type == "seat"]
        if any(not label for label in labels):
            raise ValueError("每个座位都必须有编号")
        if len(labels) != len(set(labels)):
            raise ValueError("同一房间内的座位编号不能重复")
        return self


class SeatStatusUpdate(BaseModel):
    status: Literal["active", "disabled", "maintenance", "reserved"]
    note: str | None = Field(default=None, max_length=1000)


class MajorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = 0

    @field_validator("name", mode="before")
    @classmethod
    def trim_name(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value


class MajorUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = None
    is_active: bool | None = None


class AdminLogin(BaseModel):
    username: str
    password: str


class DirectStudentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    student_no: str | None = Field(default=None, max_length=40)
    adviser: str | None = Field(default=None, max_length=80)
    email: EmailStr | None = None
    enrollment_year: int | None = None
    program_level: Literal["硕士", "博士"] | None = None
    major_id: int | None = None
    seat_id: str | None = None

    @field_validator("name", "student_no", "adviser", mode="before")
    @classmethod
    def trim_optional_text(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def set_complete_rule(self) -> "DirectStudentCreate":
        if self.email is not None and not str(self.email).lower().endswith("@stu.xmu.edu"):
            raise ValueError("请使用以 @stu.xmu.edu 结尾的学生邮箱")
        if self.enrollment_year is not None and self.enrollment_year not in allowed_years():
            raise ValueError("年级不在当前允许范围内")
        return self


class StudentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    student_no: str | None = Field(default=None, max_length=40)
    adviser: str | None = Field(default=None, max_length=80)
    email: EmailStr | None = None
    enrollment_year: int | None = None
    program_level: Literal["硕士", "博士"] | None = None
    major_id: int | None = None

    @field_validator("name", mode="before")
    @classmethod
    def require_update_name(cls, value: Any) -> Any:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("姓名不能为空")
        return value.strip()

    @field_validator("student_no", "adviser", mode="before")
    @classmethod
    def trim_update_optional_text(cls, value: Any) -> Any:
        return value.strip() or None if isinstance(value, str) else value

    @model_validator(mode="after")
    def validate_update_options(self) -> "StudentUpdate":
        if self.email is not None and not str(self.email).lower().endswith("@stu.xmu.edu"):
            raise ValueError("请使用以 @stu.xmu.edu 结尾的学生邮箱")
        if self.enrollment_year is not None and self.enrollment_year not in allowed_years():
            raise ValueError("年级不在当前允许范围内")
        return self


class MoveStudent(BaseModel):
    seat_id: str
    note: str | None = Field(default=None, max_length=1000)


class SmtpConfig(BaseModel):
    host: str = Field(min_length=1, max_length=240)
    port: int = Field(ge=1, le=65535)
    security: Literal["ssl", "starttls", "none"]
    username: str = Field(default="", max_length=240)
    password: str | None = Field(default=None, max_length=500)
    sender_name: str = Field(default="DeskAtlas", max_length=120)
    sender_email: EmailStr


class TestEmail(BaseModel):
    recipient: EmailStr


class ImportCommit(BaseModel):
    rows: list[dict[str, Any]]
