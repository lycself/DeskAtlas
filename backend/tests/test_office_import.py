from io import BytesIO

import pytest
from openpyxl import Workbook
from openpyxl.styles import Border, Side
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from backend.app.database import Base
from backend.app.models import Assignment, AuditLog, Room, Seat, Student
from backend.app.office_import import apply_survey, surveyed_preview


def workbook_bytes(book):
    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


def survey():
    roster = Workbook()
    roster.active.append(["房间", "座位号", "姓名", "导师", "年级", "培养层次", "教研中心", "备注"])
    for row in [
        ["444", 1, "甲", "导师甲", 2024, "硕", "物理", None],
        ["444", 20, None, None, None, None, "光学", None],
        ["444", 21, None, None, None, None, "物理", "20个工位"],
        ["680", 15, "乙", "导师乙", 2023, "博", "物理", "退学"],
        ["680", 16, None, None, None, None, "物理", None],
        ["559-2", 9, None, None, None, None, "物理", "打印机"],
        ["559-2", 27, "丙", "导师丙", 2025, "硕", "物理", None],
    ]:
        roster.active.append(row)
    plan = Workbook()
    for cell, value in {"AT8": 444, "AY6": 1, "AT2": 20, "AY8": "门",
                        "H53": 680, "I50": 15, "I51": 15,
                        "F57": "559-2", "C57": "门"}.items():
        plan.active[cell] = value
    plan.active["AT2"].border = Border(top=Side(style="medium"), bottom=Side(style="thin"))
    plan.active["AU2"].border = Border(top=Side(style="medium"))
    return surveyed_preview(workbook_bytes(roster), workbook_bytes(plan))


def test_survey_notes_duplicate_positions_and_equipment():
    preview = survey()
    assert preview["summary"]["equipment"] == 1
    assert set(preview["rooms"]["444"]["major_names"]) == {"物理", "光学"}
    assert preview["rooms"]["680"]["duplicates"] == {"15": ["I50", "I51"]}
    rows = preview["rooms"]["680"]["rows"]
    assert all(row["location"] is None for row in rows)
    assert "退学" in "".join(rows[0]["warnings"])
    assert rows[1]["reserved"] is True
    assert preview["rooms"]["444"]["rows"][0]["location"]["source_cell"] == "AY6"
    assert preview["rooms"]["444"]["walls"] == [
        {"x": 39, "y": 55, "width": 94, "height": 4},
        {"x": 133, "y": 55, "width": 94, "height": 4},
    ]


@pytest.mark.parametrize("replace", [False, True])
def test_survey_preserves_history_and_is_idempotent(replace):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        room_a, room_b = Room(name="444"), Room(name="559-2")
        db.add_all([room_a, room_b])
        db.flush()
        seat_a, seat_b = Seat(room_id=room_a.id, code="20"), Seat(room_id=room_b.id, code="27")
        matched_seat = Seat(room_id=room_a.id, code="1")
        matched_student = Student(name="甲", adviser="导师甲")
        moved, previous = Student(name="丙", adviser="导师丙"), Student(name="旧占用", adviser="旧导师")
        db.add_all([seat_a, seat_b, moved, previous, matched_seat, matched_student])
        db.flush()
        db.add_all([Assignment(student_id=moved.id, seat_id=seat_a.id),
                    Assignment(student_id=previous.id, seat_id=seat_b.id),
                    Assignment(student_id=matched_student.id, seat_id=matched_seat.id)])
        db.commit()
        preview = survey()
        result = apply_survey(db, preview, replace_conflicts=replace)
        db.commit()
        assert matched_student.enrollment_year == 2024
        assert set(room_a.major_names) == {"物理", "光学"}
        assert matched_student.program_level == "硕士"
        assert result["counts"]["updated_students"] == 1
        assert len(result["conflicts"]) == (0 if replace else 2)
        active = list(db.scalars(select(Assignment).where(Assignment.ended_at.is_(None))))
        if replace:
            assert next(a for a in active if a.student_id == moved.id).seat_id == seat_b.id
            assert not any(a.seat_id == seat_a.id for a in active)
            assert db.scalar(select(func.count()).select_from(Assignment).where(Assignment.ended_at.is_not(None))) == 2
        else:
            assert next(a for a in active if a.student_id == moved.id).seat_id == seat_a.id
        assert db.scalar(select(func.count()).select_from(Student).where(Student.name == "丙")) == 1
        assert not db.scalar(select(Seat).join(Room).where(Room.name == "559-2", Seat.code == "9"))
        for room in db.scalars(select(Room)):
            assert room.is_published
            for item in room.published_layout:
                assert item["x"] + item["width"] <= room.canvas_width
                assert item["y"] + item["height"] <= room.canvas_height
        before = {model: db.scalar(select(func.count()).select_from(model))
                  for model in (Room, Seat, Student, Assignment, AuditLog)}
        assert apply_survey(db, preview)["already_imported"] is True
        assert before == {model: db.scalar(select(func.count()).select_from(model)) for model in before}


def test_survey_failure_rolls_back_all_changes():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        room = Room(name="680")
        db.add(room)
        db.flush()
        seat = Seat(room_id=room.id, code="99")
        db.add(seat)
        db.flush()
        room.draft_layout = [{"id": seat.id, "type": "seat"}]
        db.commit()
        with pytest.raises(ValueError, match="未列出的座位"):
            with db.begin():
                apply_survey(db, survey())
        assert db.scalar(select(func.count()).select_from(Room)) == 1
        assert db.scalar(select(func.count()).select_from(Student)) == 0
        assert db.scalar(select(func.count()).select_from(AuditLog)) == 0


def test_shared_walls_thin_partition_and_map_only_seats():
    roster, plan = Workbook(), Workbook()
    roster.active.append(["房间", "座位号", "姓名"])
    for name in ("302", "402", "408"):
        roster.active.append([name, 1, None])
    for cell, value in {"AI19": 302, "AF17": 1, "H10": 402, "J5": 1,
                        "O10": 408, "S8": 1, "P2": 19, "P3": 18}.items():
        plan.active[cell] = value
    plan.active["AD13"].border = Border(right=Side(style="medium"))
    plan.active["AE12"].border = Border(bottom=Side(style="medium"))
    plan.active["I10"].border = Border(right=Side(style="thin"))
    plan.active["J5"].border = Border(bottom=Side(style="thin"))
    preview = surveyed_preview(workbook_bytes(roster), workbook_bytes(plan))
    assert {"x": 39, "y": 55, "width": 4, "height": 66} in preview["rooms"]["302"]["walls"]
    assert {"x": 39, "y": 55, "width": 94, "height": 4} in preview["rooms"]["302"]["walls"]
    assert preview["rooms"]["402"]["walls"] == [{"x": 227, "y": 583, "width": 4, "height": 66}]
    rows = preview["rooms"]["408"]["rows"]
    assert [r["seat_code"] for r in rows] == ["1", "18", "19"]
    assert all(r["reserved"] and r["location"] and r["person_name"] is None for r in rows[1:])


def test_targeted_repair_is_idempotent_and_preserves_assignments():
    from scripts.repair_survey_layouts import repair
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        preview = survey()
        apply_survey(db, preview)
        db.flush()
        room = db.scalar(select(Room).where(Room.name == "680"))
        room.published_layout = [i for i in room.published_layout if not i["id"].startswith("survey-unresolved-")]
        room.draft_layout = list(room.published_layout)
        before = [(a.id, a.student_id, a.seat_id, a.ended_at) for a in db.scalars(select(Assignment))]
        repair(db, preview)
        db.flush()
        placeholders = [i for i in room.published_layout if i["id"].startswith("survey-unresolved-")]
        assert len(placeholders) == 2
        assert {(i["x"], i["y"]) for i in placeholders} == {(142, 196), (142, 262)}
        assert before == [(a.id, a.student_id, a.seat_id, a.ended_at) for a in db.scalars(select(Assignment))]
        layout = list(room.published_layout)
        audit_count = db.scalar(select(func.count()).select_from(AuditLog))
        repair(db, preview)
        db.flush()
        assert room.published_layout == layout
        assert db.scalar(select(func.count()).select_from(AuditLog)) == audit_count
