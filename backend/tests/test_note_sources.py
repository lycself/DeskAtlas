"""Legacy data migrates once; literal manual remarks remain safe thereafter."""

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from backend.app.auditing import audit
from backend.app.database import Base, build_engine
from backend.app.migrations import alembic_config, current_revision, head_revision, stamp, upgrade_database
from backend.app.models import Assignment, AuditLog, Room, Seat, Student


def test_alembic_config_preserves_encoded_windows_url():
    url = "sqlite:///C%3A%5CUsers%5Crunneradmin%5CAppData%5CLocal%5CTemp%5Cexport.db"
    config = alembic_config(url)
    assert config.get_main_option("sqlalchemy.url") == url
    assert config.attributes["database_url"] == url


def test_stamp_and_upgrade_preserve_percent_signs_in_database_path(tmp_path):
    path = tmp_path / "report%notes.db"
    engine = build_engine(f"sqlite:///{path}")
    try:
        Base.metadata.create_all(engine)
        url = engine.url.render_as_string(hide_password=False)
        stamp(engine, url, "0005_note_sources")
        assert current_revision(engine) == "0005_note_sources"
        assert upgrade_database(engine, url) == head_revision()
        assert current_revision(engine) == head_revision()
        assert sorted(p.name for p in tmp_path.glob("*.db")) == [path.name]
    finally:
        engine.dispose()


@pytest.mark.parametrize("versioned", [True, False])
def test_old_notes_migrate_once_without_deleting_explicit_manual_text(tmp_path, versioned):
    url = f"sqlite:///{tmp_path / 'old.db'}"
    engine = build_engine(url)
    Base.metadata.create_all(engine)
    old = "设备检修；汇总表第2行；分布图未提供唯一位置"
    description = "按实测工位分布图还原相对位置；间距为示意尺寸。"
    with Session(engine) as db:
        imported_room = Room(name="431", description=description)
        manual_room = Room(name="432", description=description)
        db.add_all([imported_room, manual_room])
        db.flush()
        imported = Seat(room_id=imported_room.id, code="1", note=old)
        manual = Seat(room_id=imported_room.id, code="2", note=old)
        cleared = Seat(room_id=imported_room.id, code="3", note=None)
        retired = Seat(room_id=imported_room.id, code="4", note="汇总表第87行；2026-09-28 用户确认可用，解除备用预留")
        db.add_all([imported, manual, cleared, retired])
        db.flush()
        audit(db, "seat.status_updated", "seat", manual.id, after={"note": old})
        audit(db, "seat.status_updated", "seat", cleared.id, after={"note": None})
        audit(db, "seat.status_updated", "seat", retired.id, after={"note": retired.note})
        audit(db, "room.updated", "room", manual_room.id, after={"description": description})
        db.commit()
        ids = imported.id, manual.id, cleared.id, imported_room.id, manual_room.id, retired.id
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE seats DROP COLUMN note_source"))
    if versioned:
        stamp(engine, url, "0004_centers_virtual")
    assert upgrade_database(engine, url) == head_revision()
    with Session(engine) as db:
        assert db.get(Seat, ids[0]).note == "设备检修"
        assert db.get(Seat, ids[0]).note_source == "import"
        assert db.get(Seat, ids[1]).note == old
        assert db.get(Seat, ids[1]).note_source == "manual"
        assert db.get(Seat, ids[2]).note is None
        assert db.get(Seat, ids[2]).note_source == "manual"
        assert db.get(Room, ids[3]).description is None
        assert db.get(Room, ids[4]).description == description
        assert db.get(Seat, ids[5]).note is None and db.get(Seat, ids[5]).note_source == "manual"
        migrated = db.scalars(select(AuditLog).where(AuditLog.action == "remarks.migrated")).all()
        assert len(migrated) == 3
        assert any(log.before_data == {"note": old} for log in migrated)
        # A later manual remark must never be run through the legacy cleanup again.
        db.get(Seat, ids[0]).note = old
        db.get(Seat, ids[0]).note_source = "manual"
        db.commit()
    upgrade_database(engine, url)
    with Session(engine) as db:
        assert db.get(Seat, ids[0]).note == old
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "remarks.migrated")) == 3
    engine.dispose()


def test_student_note_migration_keeps_empty_and_manual_desk_remarks_on_desks(tmp_path):
    url = f"sqlite:///{tmp_path / 'ownership.db'}"
    engine = build_engine(url)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        room = Room(name="444")
        student = Student(name="状态备注人员")
        other = Student(name="工位备注人员")
        db.add_all([room, student, other])
        db.flush()
        imported = Seat(room_id=room.id, code="1", note="休学（2026.2-2027.2）", note_source="import")
        empty = Seat(room_id=room.id, code="12", note="桌上有东西但不确定新老生", note_source="import")
        manual = Seat(room_id=room.id, code="2", note="设备检修", note_source="manual")
        db.add_all([imported, empty, manual])
        db.flush()
        db.add_all([Assignment(student_id=student.id, seat_id=imported.id, source="survey"),
                    Assignment(student_id=other.id, seat_id=manual.id, source="survey")])
        db.commit()
        ids = student.id, other.id, imported.id, empty.id, manual.id
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE students DROP COLUMN note_source"))
        connection.execute(text("ALTER TABLE students DROP COLUMN note"))
    stamp(engine, url, "0005_note_sources")
    upgrade_database(engine, url)
    with Session(engine) as db:
        assert db.get(Student, ids[0]).note == "休学（2026.2-2027.2）"
        assert db.get(Student, ids[0]).note_source == "import"
        assert db.get(Seat, ids[2]).note is None
        assert db.get(Seat, ids[3]).note == "桌上有东西但不确定新老生"
        assert db.get(Seat, ids[4]).note == "设备检修"
        assert db.get(Student, ids[1]).note is None
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "student.note_migrated")) == 1
    engine.dispose()
