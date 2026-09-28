from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Assignment, Major, Student
from .student_rules import ensure_virtual_rooms, place_unassigned, student_email


INITIAL_MAJORS = [
    "理论物理",
    "凝聚态物理",
    "光学",
    "软物质物理",
    "半导体物理",
    "多信使天体物理",
]


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
