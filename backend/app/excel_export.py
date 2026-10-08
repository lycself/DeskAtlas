"""Download administrator reports as Excel workbooks, without pagination."""

from collections import Counter
from io import BytesIO
from math import ceil
from typing import Annotated, Literal
from unicodedata import east_asian_width

from fastapi import APIRouter, Depends, Query, Response
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import select
from sqlalchemy.orm import Session, defer, joinedload, selectinload

from .auditing import audit
from .database import get_db
from .models import Application, Assignment, Room, Seat, Student, utcnow
from .seat_rules import display_state
from .security import require_admin
from .student_rules import directory_filters


router = APIRouter(prefix="/api/admin/export")
Db = Annotated[Session, Depends(get_db)]
Admin = Annotated[str, Depends(require_admin)]
EXCEL_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
STATE_LABELS = {"available": "可申请", "occupied": "已占用", "pending": "待审批", "unavailable": "不可申请"}


def add_sheet(book: Workbook, name: str, headers: list[str], rows: list[list], widths: list[int]) -> None:
    sheet = book.create_sheet(name)
    sheet.append(headers)
    for values in rows:
        sheet.append([ILLEGAL_CHARACTERS_RE.sub("", value) if isinstance(value, str) else value for value in values])
    for row in sheet:
        for cell in row:
            # Every database string is literal text, including leading '=' and leading zeroes.
            if isinstance(cell.value, str):
                cell.data_type = "s"
                cell.number_format = "@"
            cell.font = Font(name="Microsoft YaHei", size=11, color="253347")
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            if cell.row == 1:
                cell.font = Font(name="Microsoft YaHei", size=11, color="FFFFFF", bold=True)
                cell.fill = PatternFill("solid", fgColor="24476B")
            elif cell.row % 2 == 0:
                cell.fill = PatternFill("solid", fgColor="F1F5F9")
        lines = max(sum(max(1, ceil(sum(2 if east_asian_width(character) in "WF" else 1
                                       for character in line) / width))
                        for line in str(cell.value or "").split("\n"))
                    for cell, width in zip(row, widths))
        sheet.row_dimensions[row[0].row].height = min(409, max(30, lines * 16 + 10))
    for index, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    sheet.sheet_view.showGridLines = False
    sheet.print_title_rows = "1:1"
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0


@router.get("/excel")
def export_excel(db: Db, _: Admin, scope: Literal["all", "students"] = "all",
                 q: str = Query(default="", max_length=500), incomplete_only: bool = False,
                 placement: str = Query(default="", max_length=120)) -> Response:
    # Student-only downloads share the exact filters and ordering used by the directory.
    filters = directory_filters(q, incomplete_only, placement) if scope == "students" else directory_filters()
    students = db.scalars(select(Student).options(joinedload(Student.major)).where(*filters)
                          .order_by(Student.name, Student.id)).all()
    assignment_query = select(Assignment).options(
        joinedload(Assignment.seat).joinedload(Seat.room).defer(Room.draft_layout).defer(Room.published_layout),
        joinedload(Assignment.student).joinedload(Student.major),
    ).where(Assignment.ended_at.is_(None))
    if scope == "students":
        assignment_query = assignment_query.where(Assignment.student_id.in_([student.id for student in students]))
    assignments = db.scalars(assignment_query).all()
    by_student = {record.student_id: record for record in assignments}
    book = Workbook()
    book.remove(book.active)
    book.properties.title = "DeskAtlas 管理报表"
    student_rows = []
    for student in students:
        record = by_student.get(student.id)
        room = record.seat.room if record else None
        student_rows.append([
            student.student_no, student.name, student.adviser, student.email,
            student.enrollment_year, student.program_level, student.major.name if student.major else None,
            room.name if room and room.is_virtual else "实际工位" if room else "未被分配",
            room.name if room else None,
            "虚拟工位" if room and room.is_virtual else record.seat.code if record else None,
            "完整" if student.is_complete else "待补全",
        ])
    add_sheet(book, "学生名册", ["学号", "姓名", "导师", "邮箱", "年级", "培养层次", "教研中心", "工位分组", "房间", "座位号", "资料状态"],
              student_rows, [24, 18, 18, 40, 12, 14, 24, 18, 18, 14, 14])
    counts = {"students": len(student_rows)}
    if scope == "all":
        rooms = db.scalars(select(Room).options(selectinload(Room.seats), defer(Room.draft_layout), defer(Room.published_layout))
                           .where(Room.is_archived.is_(False), Room.is_virtual.is_(False)).order_by(Room.name, Room.id)).all()
        by_seat = {record.seat_id: record for record in assignments}
        pending = set(db.scalars(select(Application.seat_id).where(Application.status == "pending")))
        seat_rows, room_rows = [], []
        for room in rooms:
            states = Counter()
            for seat in sorted((seat for seat in room.seats if not seat.is_archived), key=lambda seat: (seat.code, seat.id)):
                record = by_seat.get(seat.id)
                student = record.student if record else None
                state = display_state(seat, occupied=bool(record), pending=seat.id in pending)
                states[state] += 1
                seat_rows.append([
                    room.name, seat.code, STATE_LABELS[state], student.student_no if student else None,
                    student.name if student else None, student.adviser if student else None,
                    student.enrollment_year if student else None, student.program_level if student else None,
                    student.major.name if student and student.major else None, seat.note,
                ])
            room_rows.append([
                room.name, room.building, room.floor, "、".join(room.major_names or []),
                "已发布" if room.is_published else "未发布", sum(states.values()),
                states["occupied"], states["available"], states["pending"], states["unavailable"], room.description,
            ])
        add_sheet(book, "工位分配", ["房间", "座位号", "工位状态", "学号", "姓名", "导师", "年级", "培养层次", "教研中心", "备注"],
                  seat_rows, [18, 14, 16, 24, 18, 18, 12, 14, 24, 40])
        add_sheet(book, "房间汇总", ["房间", "楼宇", "楼层", "教研中心", "发布状态", "工位总数", "已占用", "可申请", "待审批", "不可申请", "说明"],
                  room_rows, [18, 20, 14, 32, 14, 14, 12, 12, 12, 14, 40])
        counts.update(seats=len(seat_rows), rooms=len(room_rows))
    output = BytesIO()
    book.save(output)
    book.close()
    filename = f"DeskAtlas-{'Students' if scope == 'students' else 'Report'}-{utcnow():%Y%m%d-%H%M%S}-UTC.xlsx"
    audit(db, "excel.exported", "report", filename, after={"scope": scope, "counts": counts,
          "filters": {"q": q, "incomplete_only": incomplete_only, "placement": placement} if scope == "students" else {}})
    db.commit()
    return Response(output.getvalue(), media_type=EXCEL_TYPE, headers={
        "Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store",
    })
