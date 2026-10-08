"""Report downloads: authorization, current data, literal identifiers and complete filtering."""

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.database import Base, build_engine, get_db
from backend.app.excel_export import EXCEL_TYPE
from backend.app.main import app
from backend.app.models import Application, Assignment, AuditLog, Major, Room, Seat, Student, utcnow
from backend.tests.test_workflows import login


@pytest.fixture
def export_client(tmp_path):
    engine = build_engine(f"sqlite:///{tmp_path / 'export.db'}")
    Base.metadata.create_all(engine)

    def session():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = session
    with TestClient(app) as client:
        yield client, engine
    app.dependency_overrides.pop(get_db)
    engine.dispose()


def read_report(response):
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == EXCEL_TYPE
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-disposition"].endswith('.xlsx"')
    return load_workbook(BytesIO(response.content))


def test_excel_export_requires_admin(export_client):
    client, _ = export_client
    assert client.get("/api/admin/export/excel").status_code == 401
    assert client.get("/api/admin/export/excel?scope=students").status_code == 401


def test_full_report_has_current_students_all_seat_states_and_room_totals(export_client):
    client, engine = export_client
    with Session(engine) as db:
        major = Major(name="导出教研中心")
        room = Room(name="导出房间", floor="3层", building="教学楼", is_published=True, major_names=[major.name])
        draft = Room(name="未发布房间", is_published=False)
        archived = Room(name="归档房间", is_archived=True)
        virtual = Room(name="翔安", is_virtual=True)
        db.add_all([major, room, draft, archived, virtual])
        db.flush()
        seats = [Seat(room_id=room.id, code=f"00{i}", note="带换行\n备注" if i == 4 else None) for i in range(1, 6)]
        seats[2].admin_status = "disabled"
        seats[4].is_archived = True
        virtual_seat = Seat(room_id=virtual.id, code="V123")
        hidden = Seat(room_id=archived.id, code="H1")
        student = Student(name='=HYPERLINK("https://example.com","学生")', student_no="00001234567890123456",
                          adviser="+导师", email="test@stu.xmu.edu.cn", enrollment_year=2026,
                          program_level="硕士", major_id=major.id, is_complete=True)
        unassigned = Student(name="虚拟学生", student_no="0002", is_complete=False)
        former = Student(name="归档学生", student_no="0003", is_archived=True)
        db.add_all([*seats, virtual_seat, hidden, student, unassigned, former])
        db.flush()
        db.add_all([
            Assignment(student_id=student.id, seat_id=seats[0].id),
            Assignment(student_id=student.id, seat_id=seats[3].id, ended_at=utcnow()),
            Assignment(student_id=unassigned.id, seat_id=virtual_seat.id),
            Application(seat_id=seats[1].id, student_no="pending-123", original_data={}, status="pending"),
        ])
        db.commit()
    login(client)
    book = read_report(client.get("/api/admin/export/excel"))
    assert book.sheetnames == ["学生名册", "工位分配", "房间汇总"]
    students = {row[0]: row for row in list(book["学生名册"].values)[1:]}
    assert set(students) == {"00001234567890123456", "0002"}
    assert students["00001234567890123456"][7:11] == ("实际工位", "导出房间", "001", "完整")
    assert students["0002"][7:11] == ("翔安", "翔安", "虚拟工位", "待补全")
    assert book["学生名册"]["A2"].data_type == "s"
    assert book["学生名册"]["A2"].number_format == "@"
    assert book["学生名册"]["B2"].data_type == "s"  # formula-like user input stays literal
    assert book["学生名册"]["B2"].value.startswith("=HYPERLINK")
    assert book["学生名册"]["F2"].value == "+导师"
    assert book["学生名册"]["C2"].data_type == "n"
    assert next(book["学生名册"].values) == ("学号", "姓名", "年级", "电子邮箱", "培养层次", "导师姓名", "教研中心", "工位分组", "房间", "座位号", "资料状态")
    assert next(book["工位分配"].values) == ("序号", "房间", "座位号", "姓名", "导师", "年级（202X级）", "培养层次（硕/博）", "教研中心", "备注", "学号", "电子邮箱", "工位状态")
    seats = {row[2]: row for row in list(book["工位分配"].values)[1:]}
    assert set(seats) == {"001", "002", "003", "004"}
    assert [seats[code][11] for code in sorted(seats)] == ["已占用", "待审批", "不可申请", "可申请"]
    assert seats["001"][9] == "00001234567890123456"
    assert seats["001"][5:7] == ("2026级", "硕")
    assert [seats[code][0] for code in sorted(seats)] == [1, 2, 3, 4]
    assert seats["004"][3] is None  # an ended assignment must not look occupied
    rooms = {row[0]: row for row in list(book["房间汇总"].values)[1:]}
    assert set(rooms) == {"导出房间", "未发布房间"}
    assert rooms["导出房间"][5:10] == (4, 1, 1, 1, 1)
    assert rooms["未发布房间"][4:10] == ("未发布", 0, 0, 0, 0, 0)
    for sheet in book:
        assert sheet.freeze_panes == "A2"
        assert sheet.auto_filter.ref == sheet.dimensions
    with Session(engine) as db:
        log = db.scalar(select(AuditLog).where(AuditLog.action == "excel.exported"))
        assert log.after_data["counts"] == {"students": 2, "seats": 4, "rooms": 2}
    book.close()


def test_student_export_matches_filters_across_all_pages(export_client):
    client, engine = export_client
    with Session(engine) as db:
        room = Room(name="翔安", is_virtual=True)
        db.add(room)
        db.flush()
        for index in range(105):
            student = Student(name=f"筛选%_学生{index:03d}", student_no=f"{index:05d}", is_complete=False)
            db.add(student)
            db.flush()
            seat = Seat(room_id=room.id, code=f"V{student.id}")
            db.add(seat)
            db.flush()
            db.add(Assignment(student_id=student.id, seat_id=seat.id))
        db.add_all([
            Student(name="筛选XX学生", student_no="outside", is_complete=False),
            Student(name="筛选%_完整学生", student_no="complete", is_complete=True),
            Student(name="筛选%_归档学生", student_no="archived", is_complete=False, is_archived=True),
        ])
        db.commit()
    login(client)
    filters = {"q": "筛选%_", "incomplete_only": "true", "placement": "翔安"}
    listing = client.get("/api/admin/student-directory", params={**filters, "limit": 100}).json()
    assert listing["total"] == 105 and len(listing["items"]) == 100
    book = read_report(client.get("/api/admin/export/excel", params={**filters, "scope": "students"}))
    assert book.sheetnames == ["学生名册"]
    rows = list(book.active.values)[1:]
    assert len(rows) == 105
    assert [row[0] for row in rows[:100]] == [student["student_no"] for student in listing["items"]]
    assert rows[-1][0] == "00104"
    book.close()
    empty = read_report(client.get("/api/admin/export/excel", params={"scope": "students", "placement": "physical"}))
    assert empty.active.max_row == 1  # no matching students is still a valid workbook
    empty.close()


def test_empty_report_and_invalid_scope(export_client):
    client, _ = export_client
    login(client)
    book = read_report(client.get("/api/admin/export/excel"))
    assert book.sheetnames == ["学生名册", "工位分配", "房间汇总"]
    assert all(sheet.max_row == 1 for sheet in book)
    book.close()
    assert client.get("/api/admin/export/excel?scope=unknown").status_code == 422


def test_report_cleans_control_characters_and_expands_long_rows(export_client):
    client, engine = export_client
    with Session(engine) as db:
        db.add(Student(name="很长的学生姓名" * 8, adviser="导师\x01名称", student_no="001", is_complete=False))
        db.commit()
    login(client)
    book = read_report(client.get("/api/admin/export/excel?scope=students"))
    assert book.active["F2"].value == "导师名称"
    assert book.active.row_dimensions[2].height > 30
    book.close()
