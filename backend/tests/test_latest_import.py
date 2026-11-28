from io import BytesIO

from openpyxl import Workbook
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import Session

from backend.app.database import Base
from backend.app.latest_import import latest_preview, apply_latest
from backend.app.models import Assignment, Student, Room, Seat, Teacher


def workbook_bytes(rows):
    book = Workbook()
    for row in rows:
        book.active.append(row)
    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


def test_latest_import_identity_conflicts_history_and_idempotency():
    directory = workbook_bytes([
        ["学号", "姓名", "导师姓名", "年级", "培养层次", "电子邮箱"],
        ["001", "同名", "甲导师", "2026级", "硕士", "wrong@example.com"],
        ["002", "同名", "乙导师", "2025级", "博士", "wrong@example.com"],
        ["003", "重复安排", "甲导师", "2024级", "硕士", "wrong@example.com"],
        ["004", "无工位", "甲导师", "2026级", "硕士", "wrong@example.com"],
    ])
    teachers = workbook_bytes([["姓名", "职称", "中心职务", "教研中心"],
        ["甲导师", "教授", "主任", "光学教研中心"], ["乙导师", "副教授", None, "理论物理教研中心"]])
    roster = workbook_bytes([
        ["房间", "座位号", "姓名", "导师", "年级（202X级）", "培养层次（硕/博）", "教研中心"],
        [301, 1, "同名", "甲导师", "2026级", "硕", "光学"],
        [301, 2, "同名", "乙导师", "2025级", "博", "理论物理"],
        [301, 3, "重复安排", "甲导师", "2024级", "硕", "光学"],
        [301, 4, "重复安排", "甲导师", "2024级", "硕", "光学"],
        [301, 5, "科研助理", "甲导师", None, None, "光学"],
    ])
    book = Workbook()
    book.active["E2"] = 301
    for coordinate, value in zip(("B3", "C3", "D3", "B4", "C4"), range(1, 6)):
        book.active[coordinate] = value
    stream = BytesIO()
    book.save(stream)
    preview = latest_preview(roster, stream.getvalue(), directory, teachers)
    assert preview["summary"]["unassigned_students"] == 2
    assert len(preview["identity_warnings"]) == 1
    assert preview["assignment_conflicts"][0]["chosen"] is None
    resolved = latest_preview(roster, stream.getvalue(), directory, teachers, seat_overrides={"003": "301/4"})
    assert resolved["summary"]["unassigned_students"] == 1
    assert resolved["fingerprint"] != preview["fingerprint"]
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        room = Room(name="旧房间")
        old_student = Student(name="已离校")
        known = Student(name="同名", adviser="甲导师")
        db.add_all([room, old_student, known])
        db.flush()
        seat = Seat(room_id=room.id, code="1")
        db.add(seat)
        db.flush()
        historical = Assignment(student_id=old_student.id, seat_id=seat.id)
        db.add(historical)
        db.commit()
        known_id = known.id
        result = apply_latest(db, preview)
        db.commit()
        assert result["unassigned_total"] == 2
        assert historical.ended_at and old_student.is_archived and room.is_archived
        assert db.scalar(select(Student.id).where(Student.student_no == "001")) == known_id
        assert db.scalar(select(func.count()).select_from(Teacher)) == 2
        current = db.scalars(select(Student).where(Student.is_archived.is_(False))).all()
        assert len(current) == 5
        for student in current:
            if student.student_no:
                assert student.email == f"{student.student_no}@stu.xmu.edu.cn"
            assignments = db.scalars(select(Assignment).where(Assignment.student_id == student.id, Assignment.ended_at.is_(None))).all()
            assert len(assignments) == 1
            if student.student_no in ("003", "004"):
                assert assignments[0].seat.room.name == "未被分配"
        assert all(s.admin_status == "reserved" for s in db.scalars(select(Seat).where(Seat.code.in_(["3", "4"]))))
        total = db.scalar(select(func.count()).select_from(Assignment))
        assert apply_latest(db, preview)["already_imported"]
        assert db.scalar(select(func.count()).select_from(Assignment)) == total
        db.rollback()


def test_latest_preview_preserves_undergraduate_postdoc_and_transfer_stage():
    directory = workbook_bytes([
        ["学号", "姓名", "导师姓名", "年级", "培养层次"],
        ["stage-1", "转博人员", "导师", "2026级", "博士"],
    ])
    teachers = workbook_bytes([["姓名", "职称", "中心职务", "教研中心"], ["导师", "教授", None, "光学"]])
    roster = workbook_bytes([
        ["房间", "座位号", "姓名", "导师", "年级", "培养层次"],
        [301, 1, "转博人员", "导师", "2026级", "硕转博"],
        [301, 2, "本科人员", "导师", "2024级", "本"],
        [301, 3, "博后人员", "导师", None, "博后"],
    ])
    floorplan = Workbook()
    floorplan.active["E2"] = 301
    for cell, value in zip(("B3", "C3", "D3"), (1, 2, 3)):
        floorplan.active[cell] = value
    stream = BytesIO()
    floorplan.save(stream)
    preview = latest_preview(roster, stream.getvalue(), directory, teachers)
    assert preview["students"][0]["program_level"] == "硕转博"
    assert [row["program_level"] for row in preview["rooms"]["301"]["rows"]] == ["硕转博", "本科", "博士后"]


def test_latest_preview_uses_joint_training_label_from_room_roster():
    directory = workbook_bytes([
        ["学号", "姓名", "导师姓名", "年级", "培养层次"],
        ["joint-1", "联培人员", "导师", "2026级", "博士"],
    ])
    teachers = workbook_bytes([["姓名", "职称", "中心职务", "教研中心"], ["导师", "教授", None, "光学"]])
    roster = workbook_bytes([
        ["房间", "座位号", "姓名", "导师", "年级", "培养层次", "备注"],
        [301, 1, "联培人员", "导师", "2026级", "博", "联培（2025年9月-2027年2月）"],
        [301, 2, "助理人员", "导师", None, None, "科研助理"],
    ])
    floorplan = Workbook()
    floorplan.active["E2"] = 301
    floorplan.active["B3"], floorplan.active["C3"] = 1, 2
    stream = BytesIO()
    floorplan.save(stream)
    preview = latest_preview(roster, stream.getvalue(), directory, teachers)
    assert preview["students"][0]["program_level"] == "联培"
    assert [row["program_level"] for row in preview["rooms"]["301"]["rows"]] == ["联培", "科研助理"]


def test_survey_wall_import_does_not_copy_adjacent_room_border():
    from openpyxl.styles import Border, Side
    from backend.app.office_import import surveyed_preview

    roster = workbook_bytes([
        ['房间', '座位号', '姓名', '导师', '年级', '培养层次（硕/博）', '教研中心'],
        [301, 1, None, None, None, None, '软物质物理'],
        [302, 1, None, None, None, None, '光学'],
    ])
    book = Workbook()
    sheet = book.active
    sheet['E2'], sheet['K2'] = 301, 302
    sheet['C6'], sheet['H6'] = 1, 1
    thick = Side(style='medium')
    for row in range(2, 7):
        sheet[f'E{row}'].border = Border(right=thick)
        # F is empty padding. G's wall belongs to the next room, not to 301.
        sheet[f'G{row}'].border = Border(left=thick)
    # An internal shared edge stored only on the neighbouring cell remains valid.
    sheet['B3'].border = Border(right=thick)
    sheet['B2'].border = Border(top=thick, left=thick)
    stream = BytesIO()
    book.save(stream)
    rooms = surveyed_preview(roster, stream.getvalue(), map_ranges={'301': 'B2:F6', '302': 'G2:K8'})['rooms']
    walls = rooms['301']['walls']
    assert not any(w['x'] == 509 for w in walls)
    assert sum(w['x'] == 415 and w['width'] == 4 for w in walls) == 5
    assert {'x': 133, 'y': 121, 'width': 4, 'height': 66} in walls
    assert {'x': 39, 'y': 55, 'width': 94, 'height': 4} in walls
    assert sum(w['x'] == 39 and w['width'] == 4 for w in rooms['302']['walls']) == 5


def test_latest_ranges_include_perimeter_columns():
    from openpyxl.styles import Border, Side
    from backend.app.latest_import import LATEST_MAP_RANGES
    from backend.app.office_import import surveyed_preview

    roster = workbook_bytes([
        ['房间', '座位号', '姓名'],
        [311, 1, None], [406, 1, None], [680, 1, None],
    ])
    book = Workbook()
    sheet = book.active
    for seat_cell, wall_cell, side in (
        ('N8', 'M3', 'left'),
        ('AL19', 'AK14', 'left'),
        ('N77', 'S75', 'right'),
    ):
        sheet[seat_cell] = 1
        sheet[wall_cell].border = Border(**{side: Side(style='medium')})
    sheet['Q10'], sheet['AO21'], sheet['M79'] = 311, 406, 680
    stream = BytesIO()
    book.save(stream)
    rooms = surveyed_preview(roster, stream.getvalue(), map_ranges={name: LATEST_MAP_RANGES[name]
                             for name in ('311', '406', '680')})['rooms']
    assert {'x': 39, 'y': 121, 'width': 4, 'height': 66} in rooms['311']['walls']
    assert {'x': 39, 'y': 121, 'width': 4, 'height': 66} in rooms['406']['walls']
    assert {'x': 697, 'y': 121, 'width': 4, 'height': 66} in rooms['680']['walls']


def test_virtual_layout_uses_center_order_and_distinct_positions():
    from backend.app.main import serialize_room
    from backend.app.models import Major

    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first = Major(name='甲组', sort_order=1)
        second = Major(name='乙组', sort_order=2)
        room = Room(name='未被分配', is_virtual=True, is_published=True)
        db.add_all([first, second, room])
        db.flush()
        for code, name, center in [('V1', '丙', second), ('V2', '乙', first), ('V3', '甲', first)]:
            student = Student(name=name, major_id=center.id)
            seat = Seat(room_id=room.id, code=code)
            db.add_all([student, seat])
            db.flush()
            db.add(Assignment(student_id=student.id, seat_id=seat.id))
        db.flush()
        items = serialize_room(db, room)['items']
        seats = [item for item in items if item['type'] == 'seat']
        assert {item['seat']['occupant']['name'] for item in seats[:2]} == {'甲', '乙'}
        assert seats[2]['seat']['occupant']['name'] == '丙'
        assert [item['label'] for item in seats] == ['01', '02', '03']
        assert len({(item['x'], item['y']) for item in seats}) == 3
        assert [item['label'] for item in items if item['type'] == 'label'] == ['甲组', '乙组']


def test_name_decides_occupant_and_student_number_only_settles_same_names():
    directory = workbook_bytes([
        ["学号", "姓名", "导师姓名", "年级", "培养层次"],
        ["001", "甲", "甲导师", "2026级", "硕士"],
        ["002", "乙", "乙导师", "2026级", "硕士"],
        ["003", "丙", None, "2026级", "硕士"],
        ["004", "同名", None, "2026级", "硕士"],
        ["005", "同名", None, "2026级", "硕士"],
    ])
    teachers = workbook_bytes([["姓名", "职称", "中心职务", "教研中心"],
        ["甲导师", "教授", None, "光学教研中心"], ["乙导师", "教授", None, "理论物理教研中心"]])
    roster = workbook_bytes([
        ["房间", "座位号", "姓名", "导师", "年级（202X级）", "培养层次", "教研中心", "学生备注", "工位备注", "学号"],
        [301, 1, "甲", "甲导师", "2026级", "硕", "光学", "离校两年", None, "002"],
        [301, 2, None, None, None, None, None, None, None, "003"],
        [301, 3, "乙", "甲导师", "2026级", "硕", "光学", None, None, None],
        [301, 4, "丙", "乙导师", "2026级", "硕", "理论物理", None, None, None],
        [301, 4, None, None, None, None, None, None, None, None],
        [301, 5, "同名", "甲导师", "2026级", "硕", "光学", None, None, "005"],
        [301, 6, "同名", "甲导师，丁导师", "2026级", "硕", "光学", None, None, None],
    ])
    book = Workbook()
    book.active["E2"] = 301
    for coordinate, value in zip(("B3", "C3", "D3", "B4", "C4", "D4"), range(1, 7)):
        book.active[coordinate] = value
    stream = BytesIO()
    book.save(stream)
    preview = latest_preview(roster, stream.getvalue(), directory, teachers)
    rows = {row["seat_code"]: row for row in preview["rooms"]["301"]["rows"]}
    assert len(preview["rooms"]["301"]["rows"]) == 6
    assert (rows["1"]["student_no"], rows["1"]["student_note"]) == ("001", "离校两年")
    assert "学号 002 与姓名不符，已按姓名识别" in rows["1"]["warnings"]
    assert rows["2"]["kind"] == "empty" and "student_no" not in rows["2"]
    assert rows["3"]["student_no"] == "002"
    assert rows["4"]["student_no"] == "003"
    assert rows["5"]["student_no"] == "005"
    assert rows["6"]["student_no"] == "004"
    students = {s["student_no"]: s for s in preview["students"]}
    assert (students["003"]["adviser"], students["003"]["center"]) == ("乙导师", "理论物理")
    # 导师以座位表为准，教研中心随教师名单重算。
    assert (students["002"]["adviser"], students["002"]["center"]) == ("甲导师", "光学")
    assert (students["004"]["adviser"], students["004"]["center"]) == ("甲导师，丁导师", "光学")
    assert preview["assignment_conflicts"] == [] and preview["identity_warnings"] == []
