from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from pydantic import ValidationError
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from backend.app.database import Base
from backend.app.importer import normalize_level, preview_workbook
from backend.app.main import app
from backend.app.models import Assignment, AuditLog, Room, Seat, Student
from backend.app.program_levels import PROGRAM_LEVELS
from backend.app.schemas import DirectStudentCreate, StudentData, StudentUpdate, allowed_years
from backend.tests.test_workflows import login
from scripts.repair_program_levels import apply_plan, repair_plan


@pytest.mark.parametrize("source, expected", [
    ("本", "本科"), ("本科", "本科"), ("本科生", "本科"), ("硕", "硕士"), ("硕士生", "硕士"),
    ("博", "博士"), ("博士生", "博士"), ("博后", "博士后"), ("博士后", "博士后"), ("硕转博", "硕转博"),
])
def test_import_recognizes_source_stages(source, expected):
    assert normalize_level(source) == (expected, None)


def test_unknown_stage_remains_a_review_warning():
    assert normalize_level("未定义类别") == (None, "无法识别培养层次：未定义类别")
    assert normalize_level(None) == (None, "培养层次缺失")


@pytest.mark.parametrize("level", PROGRAM_LEVELS)
def test_all_write_schemas_accept_supported_stages(level):
    assert DirectStudentCreate(name="测试", program_level=level).program_level == level
    assert StudentUpdate(program_level=level).program_level == level
    assert StudentData(name="测试", student_no="level001", adviser="导师", enrollment_year=allowed_years()[0],
                       program_level=level, major_id=1).program_level == level
    with pytest.raises(ValidationError):
        StudentUpdate(program_level="未定义类别")


def test_options_and_student_create_update_support_all_stages():
    with TestClient(app) as client:
        assert client.get("/api/public/bootstrap").json()["program_levels"] == PROGRAM_LEVELS
        login(client)
        assert client.get("/api/admin/options").json()["program_levels"] == PROGRAM_LEVELS
        created = client.post("/api/admin/students", json={"name": "阶段测试人员", "program_level": "本科"})
        assert created.status_code == 201, created.text
        for level in PROGRAM_LEVELS:
            updated = client.patch(f"/api/admin/students/{created.json()['id']}", json={"program_level": level})
            assert updated.status_code == 200, updated.text
            assert updated.json()["program_level"] == level


def test_stage_repair_matches_identity_and_seat_and_preserves_other_fields():
    book = Workbook()
    book.active.append(["房间", "座位号", "姓名", "导师", "培养层次"])
    book.active.append(["stage-room", "1", "本科人员", "导师", "本"])
    book.active.append(["stage-room", "2", "博后人员", "导师", "博后"])
    book.active.append(["stage-room", "3", "转博人员", "导师", "硕转博"])
    book.active.append(["stage-room", "4", "已修改人员", "导师", "本科"])
    stream = BytesIO()
    book.save(stream)
    rows = preview_workbook(stream.getvalue())["rows"]
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        room = Room(name="stage-room")
        db.add(room)
        db.flush()
        students = []
        for code, name, level in [("1", "本科人员", None), ("2", "博后人员", None),
                                  ("3", "转博人员", "博士"), ("4", "已修改人员", "硕士")]:
            student = Student(name=name, adviser="导师", program_level=level)
            seat = Seat(room_id=room.id, code=code)
            db.add_all([student, seat])
            db.flush()
            db.add(Assignment(student_id=student.id, seat_id=seat.id))
            students.append(student)
        db.commit()
        plan = repair_plan(db, rows)
        assert len(plan["changes"]) == 3 and len(plan["conflicts"]) == 1
        assert students[0].program_level is None
        apply_plan(db, plan)
        db.commit()
        assert [s.program_level for s in students] == ["本科", "博士后", "硕转博", "硕士"]
        assert db.scalar(select(func.count()).select_from(Assignment)) == 4
        assert db.scalar(select(func.count()).select_from(AuditLog)) == 3
        assert not repair_plan(db, rows)["changes"]
        rows[0]["seat_code"] = "99"
        assert any(row["source_row"] == 2 for row in repair_plan(db, rows)["conflicts"])
    engine.dispose()
