"""Student status remarks belong to students, not to their current desks."""

from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

revision = "0006_student_notes"
down_revision = "0005_note_sources"
branch_labels = None
depends_on = None


def upgrade():
    connection = op.get_bind()
    columns = {c["name"] for c in sa.inspect(connection).get_columns("students")}
    if "note" in columns:
        return
    op.add_column("students", sa.Column("note", sa.Text(), nullable=True))
    op.add_column("students", sa.Column("note_source", sa.String(24), nullable=False, server_default="none"))
    metadata = sa.MetaData()
    students = sa.Table("students", metadata, autoload_with=connection)
    seats = sa.Table("seats", metadata, autoload_with=connection)
    assignments = sa.Table("assignments", metadata, autoload_with=connection)
    audits = sa.Table("audit_logs", metadata, autoload_with=connection)
    # Only imported, occupied student rows have known person ownership. Empty-desk
    # observations and administrator-authored desk remarks remain on the desk.
    rows = connection.execute(sa.select(
        seats.c.id.label("seat_id"), seats.c.note,
        students.c.id.label("student_id"), students.c.note.label("student_note"),
    ).join(assignments, assignments.c.seat_id == seats.c.id)
        .join(students, students.c.id == assignments.c.student_id)
        .where(seats.c.note_source == "import", seats.c.note.is_not(None),
               assignments.c.ended_at.is_(None), assignments.c.source.in_(["survey", "import"]))).mappings().all()
    for row in rows:
        connection.execute(students.update().where(students.c.id == row["student_id"])
                           .values(note=row["note"], note_source="import"))
        connection.execute(seats.update().where(seats.c.id == row["seat_id"]).values(note=None))
        connection.execute(audits.insert().values(
            action="student.note_migrated", target_type="student", target_id=str(row["student_id"]),
            before_data={"seat_id": row["seat_id"], "seat_note": row["note"], "student_note": row["student_note"]},
            after_data={"seat_id": row["seat_id"], "seat_note": None, "student_note": row["note"], "note_source": "import"},
            created_at=datetime.now(timezone.utc)))


def downgrade():
    op.drop_column("students", "note_source")
    op.drop_column("students", "note")
