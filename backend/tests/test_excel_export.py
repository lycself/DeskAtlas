"""Report downloads: authorization, current data, literal identifiers and complete filtering."""

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from backend.app.database import Base, build_engine, get_db
from backend.app.excel_export import EXCEL_TYPE
from backend.app.main import app
from backend.app.migrations import stamp, upgrade_database
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
    assert students["0002"][7:11] == ("翔安", "翔安", None, "待补全")
    assert book["学生名册"]["A2"].data_type == "s"
    assert book["学生名册"]["A2"].number_format == "@"
    assert book["学生名册"]["B2"].data_type == "s"  # formula-like user input stays literal
    assert book["学生名册"]["B2"].value.startswith("=HYPERLINK")
    assert book["学生名册"]["F2"].value == "+导师"
    assert book["学生名册"]["C2"].data_type == "n"
    assert next(book["学生名册"].values) == ("学号", "姓名", "年级", "电子邮箱", "培养层次", "导师姓名", "教研中心", "工位分组", "房间", "座位号", "资料状态", "学生备注")
    assert next(book["工位分配"].values) == ("序号", "房间", "座位号", "姓名", "导师", "年级（202X级）", "培养层次", "教研中心", "学生备注", "工位备注", "学号", "电子邮箱", "工位状态")
    seats = {row[2]: row for row in list(book["工位分配"].values)[1:]}
    assert set(seats) == {"001", "002", "003", "004"}
    assert [seats[code][12] for code in sorted(seats)] == ["已占用", "待审批", "不可申请", "可申请"]
    assert seats["001"][10] == "00001234567890123456"
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
            db.add(Assignment(student_id=student.id, seat_id=seat.id, source="survey"))
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


def test_report_omits_import_metadata_and_keeps_actual_remarks(export_client):
    client, engine = export_client
    boilerplate = "按实测工位分布图还原相对位置；间距为示意尺寸。"
    with Session(engine) as db:
        room = Room(name="备注测试", description=boilerplate)
        special_room = Room(name="位置待核对", description=boilerplate + " 未定位编号：9。房间有投影仪。")
        db.add_all([room, special_room])
        db.flush()
        for code, level, note in [
            ("1", "科研助理", "科研助理；汇总表第5行；培养层次缺失；年级缺失；教研中心：光学；导师：测试导师"),
            ("2", "联培", "联培 离校时间 2026年1月15日 离校时长 2年；汇总表第229行；博士"),
            ("3", "联培", "出国联培（2025年11月-2026年11月）；汇总表第378行；退学待核实"),
            ("4", "硕士", "带换行\n实际备注；汇总表第99行；分布图未提供唯一位置"),
            ("5", "硕士", "备用间；汇总表第82行；2026-09-28 用户确认可用，解除备用预留"),
            ("6", "博士", "2026-09-28 用户核定：肖楠在423/21；417/7解除重复安排预留。；离校时间 2026年1月15日；汇总表第6行"),
            ("7", "硕士", "平台占用与Excel不一致，待核对；姓名在汇总表中重复；未按姓名合并，请核对学号；工位分布图 B2；汇总表未列，使用情况待核对；某人在最新表存在重复安排，原记录保留待核对"),
            ("8", "硕士", "退学；汇总表第8行；备注退学；保留表内占用，待核实是否已腾退"),
        ]:
            student = Student(name=f"人员{code}", program_level=level)
            seat = Seat(room_id=room.id, code=code, note=note)
            db.add_all([student, seat])
            db.flush()
            db.add(Assignment(student_id=student.id, seat_id=seat.id, source="survey"))
        db.commit()
    # Old mixed remarks are repaired once by migration, before normal exports.
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE seats DROP COLUMN note_source"))
        connection.execute(text("ALTER TABLE students DROP COLUMN note_source"))
        connection.execute(text("ALTER TABLE students DROP COLUMN note"))
    stamp(engine, str(engine.url), "0004_centers_virtual")
    upgrade_database(engine, str(engine.url))
    login(client)
    book = read_report(client.get("/api/admin/export/excel"))
    seats = {row[2]: row for row in list(book["工位分配"].values)[1:]}
    assert seats["1"][6:9] == ("科研助理", None, None)
    assert seats["2"][6] == "联培"
    assert seats["2"][8] == "离校时间 2026年1月15日 离校时长 2年"
    assert seats["3"][8] == "时间（2025年11月-2026年11月）；退学待核实"
    assert seats["4"][8] == "带换行\n实际备注"
    assert seats["5"][8] is None
    assert seats["6"][8] == "离校时间 2026年1月15日"
    assert seats["7"][8] is None
    assert seats["8"][8] == "退学"
    assert [row[4] for row in list(book["学生名册"].values)[1:]] == ["科研助理", "联培", "联培", "硕士", "硕士", "博士", "硕士", "硕士"]
    rooms = {row[0]: row for row in list(book["房间汇总"].values)[1:]}
    assert rooms["备注测试"][10] is None
    assert rooms["位置待核对"][10] == "房间有投影仪。"
    for sheet in book:
        for row in sheet:
            for cell in row:
                assert cell.alignment.horizontal == cell.alignment.vertical == "center"
                assert all(side.style == "thin" for side in (cell.border.left, cell.border.right, cell.border.top, cell.border.bottom))
                if cell.row > 1:
                    assert cell.fill.patternType is None
    book.close()
    # Migration preserves the old text in audit history; exports only read actual remarks.
    with Session(engine) as db:
        assert db.scalar(select(Seat.note).where(Seat.code == "1")) is None
        assert db.scalar(select(Room.description).where(Room.name == "备注测试")) is None
        logs = db.scalars(select(AuditLog).where(AuditLog.action == "remarks.migrated")).all()
        assert any(log.before_data.get("note", "").startswith("科研助理；汇总表第5行") for log in logs)


def test_export_preserves_manual_text_even_when_it_matches_old_filter_words(export_client):
    client, engine = export_client
    note = "用户确认：设备检修完成；教研中心：备用设备由光学组保管"
    description = "分布图未提供此房间；按座位号暂排，实际位置待核对。"
    with Session(engine) as db:
        room = Room(name="人工说明", description=description)
        db.add(room)
        db.flush()
        seat = Seat(room_id=room.id, code="1")
        db.add(seat)
        db.commit()
        seat_id = seat.id
    login(client)
    updated = client.patch(f"/api/admin/seats/{seat_id}/status", json={"status": "maintenance", "note": note})
    assert updated.status_code == 200
    with Session(engine) as db:
        assert db.get(Seat, seat_id).note_source == "manual"
    book = read_report(client.get("/api/admin/export/excel"))
    assert book["工位分配"]["I2"].value is None
    assert book["工位分配"]["J2"].value == note
    assert book["房间汇总"]["K2"].value == description
    book.close()


def test_status_only_update_does_not_turn_imported_remarks_into_manual_edits(export_client):
    client, engine = export_client
    with Session(engine) as db:
        room = Room(name="来源测试")
        db.add(room)
        db.flush()
        seat = Seat(room_id=room.id, code="1", note="设备检修", note_source="import")
        db.add(seat)
        db.commit()
        seat_id = seat.id
    login(client)
    for payload in ({"status": "maintenance"}, {"status": "active", "note": "设备检修"}):
        response = client.patch(f"/api/admin/seats/{seat_id}/status", json=payload)
        assert response.status_code == 200
        with Session(engine) as db:
            seat = db.get(Seat, seat_id)
            assert seat.note == "设备检修" and seat.note_source == "import"
    response = client.patch(f"/api/admin/seats/{seat_id}/status", json={"status": "active", "note": None})
    assert response.status_code == 200
    with Session(engine) as db:
        seat = db.get(Seat, seat_id)
        assert seat.note is None and seat.note_source == "manual"


def test_student_remarks_follow_student_and_never_include_desk_observations(export_client):
    client, engine = export_client
    with Session(engine) as db:
        room = Room(name="备注归属测试", is_published=True)
        student = Student(name="备注学生", student_no="remark-student", note="休学（2026.2-2027.2）", note_source="import")
        db.add_all([room, student])
        db.flush()
        old = Seat(room_id=room.id, code="1", note="桌上有东西但不确定新老生", note_source="manual")
        new = Seat(room_id=room.id, code="2")
        db.add_all([old, new])
        db.flush()
        db.add(Assignment(student_id=student.id, seat_id=old.id, source="survey"))
        db.commit()
        student_id, new_id = student.id, new.id
    login(client)

    def check_student_report(expected_note):
        for scope in ("all", "students"):
            book = read_report(client.get("/api/admin/export/excel", params={"scope": scope}))
            headers, *rows = list(book["学生名册"].values)
            record = next(dict(zip(headers, row)) for row in rows if row[0] == "remark-student")
            assert record["学生备注"] == expected_note
            assert "桌上有东西" not in record["学生备注"]
            if scope == "all":
                headers, *rows = list(book["工位分配"].values)
                records = [dict(zip(headers, row)) for row in rows]
                original = next(row for row in records if row["座位号"] == "1")
                assert original["工位备注"] == "桌上有东西但不确定新老生"
                current = next((row for row in records if row["姓名"] == "备注学生"), None)
                if current:
                    assert current["学生备注"] == expected_note
            book.close()
    check_student_report("休学（2026.2-2027.2）")
    updated = client.patch(f"/api/admin/students/{student_id}", json={"note": "学生已返校"})
    assert updated.status_code == 200 and updated.json()["note"] == "学生已返校"
    for destination in (new_id, "virtual:翔安", "virtual:未被分配"):
        moved = client.post(f"/api/admin/students/{student_id}/move", json={"seat_id": destination})
        assert moved.status_code == 200, moved.text
        assert moved.json()["note"] == "学生已返校"
        check_student_report("学生已返校")
    cleared = client.patch(f"/api/admin/students/{student_id}", json={"note": None})
    assert cleared.status_code == 200 and cleared.json()["note"] is None
    with Session(engine) as db:
        assert db.get(Student, student_id).note_source == "manual"
        assert db.get(Seat, new_id).note is None


@pytest.mark.parametrize("scope", ["all", "students"])
def test_student_report_leaves_virtual_seat_numbers_blank(export_client, scope):
    client, engine = export_client
    with Session(engine) as db:
        for index, name in enumerate(["翔安", "未被分配", "未分配", "实际房间"]):
            room = Room(name=name, is_virtual=name in {"翔安", "未被分配"})
            student = Student(name=f"人员{index}", student_no=f"student-{index}")
            db.add_all([room, student])
            db.flush()
            seat = Seat(room_id=room.id, code="001" if name == "实际房间" else f"V{student.id}")
            db.add(seat)
            db.flush()
            db.add(Assignment(student_id=student.id, seat_id=seat.id))
        db.add(Student(name="无分配人员", student_no="student-none"))
        db.commit()
    login(client)
    book = read_report(client.get("/api/admin/export/excel", params={"scope": scope}))
    students = {row[0]: row for row in list(book["学生名册"].values)[1:]}
    for index, name in enumerate(["翔安", "未被分配", "未分配"]):
        assert students[f"student-{index}"][8:10] == (name, None)
    assert students["student-3"][8:10] == ("实际房间", "001")
    assert students["student-none"][9] is None
    book.close()
