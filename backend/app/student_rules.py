"""Shared identity and virtual placement rules for all write paths."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Assignment, Room, Seat, Student

VIRTUAL_ROOMS = ("翔安", "未被分配")


def student_email(student_no: str | None) -> str | None:
    return f"{student_no.strip()}@stu.xmu.edu.cn" if isinstance(student_no, str) and student_no.strip() else None


def ensure_virtual_rooms(db: Session) -> dict[str, Room]:
    result = {}
    for name in VIRTUAL_ROOMS:
        room = db.scalar(select(Room).where(Room.name == name))
        if room is None:
            room = Room(name=name, is_virtual=True, is_published=True, floor="虚拟工位",
                        description="虚拟工位分组，不占用实际办公室座位。")
            db.add(room)
            db.flush()
        if not room.is_virtual:
            raise ValueError(f"房间名称 {name} 已被实际房间使用")
        result[name] = room
    return result


def virtual_seat(db: Session, student: Student, name: str = "未被分配") -> Seat:
    room = ensure_virtual_rooms(db)[name]
    # Each person has a private backing slot, preserving physical-seat uniqueness.
    code = f"V{student.id}"
    seat = db.scalar(select(Seat).where(Seat.room_id == room.id, Seat.code == code))
    if seat is None:
        seat = Seat(room_id=room.id, code=code)
        db.add(seat)
        db.flush()
    return seat


def place_unassigned(db: Session, student: Student) -> None:
    seat = virtual_seat(db, student)
    db.add(Assignment(student_id=student.id, seat_id=seat.id, source="unassigned"))
