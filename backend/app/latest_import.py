"""Reconcile the September arrangement, directory and teacher roster atomically."""
from collections import defaultdict
import hashlib
import io

from openpyxl import load_workbook
from sqlalchemy import select

from .importer import normalize_level, normalize_year
from .models import Application, Assignment, AuditLog, Major, Room, Student, Teacher, utcnow
from .office_import import surveyed_preview, apply_survey
from .student_rules import ensure_virtual_rooms, place_unassigned, student_email


LATEST_MAP_RANGES = {
    "301": "B2:F6", "302": "G2:K8", "311": "M2:Q10", "313": "S2:W9",
    "315": "Y2:AB9", "319": "AD2:AH10", "321": "AJ2:AN10",
    "322": "A13:F17", "323": "I13:M20", "324": "O13:S19", "362": "U13:AB18",
    "402": "AD13:AI21", "406": "AK13:AO21", "408": "B24:F32", "409": "I24:K31",
    "411": "M24:O32", "413": "Q24:U32", "415": "X24:AB32", "417": "AF24:AH32",
    "419": "AK24:AO32", "421": "B35:F43", "423": "I35:M43", "424": "P35:T42",
    "425": "W35:AA42", "431": "AD35:AN42", "444": "A47:F53", "457": "H47:O52",
    "442-1": "Q47:W57", "442-2": "Z47:AE57", "555": "AG47:AN51",
    "558": "B61:F71", "561": "I61:N66", "567": "Q61:W67",
    "559-1": "Z61:AE70", "559-2": "AH61:AN70", "661": "B74:K79", "680": "M74:S79",
}


def clean(value):
    return str(value or "").strip()


def center_name(value):
    return clean(value).removesuffix("教研中心")


def latest_preview(roster: bytes, floorplan: bytes, directory: bytes, teachers: bytes,
                   *, seat_overrides: dict[str, str] | None = None) -> dict:
    preview = surveyed_preview(roster, floorplan, map_ranges=LATEST_MAP_RANGES)
    preview["fingerprint"] = hashlib.sha256(b"latest-arrangement-v2\0" + roster + floorplan + directory + teachers).hexdigest()
    teacher_sheet = load_workbook(io.BytesIO(teachers), data_only=True).worksheets[0]
    faculty = [dict(name=clean(r[0]), title=clean(r[1]) or None, role=clean(r[2]) or None,
                    center=center_name(r[3])) for r in list(teacher_sheet.values)[1:] if r[0]]
    if any(not t["center"] for t in faculty):
        raise ValueError("教师名单存在缺少教研中心的记录")
    adviser_centers = defaultdict(set)
    for teacher in faculty:
        adviser_centers[teacher["name"]].add(teacher["center"])
    sheet = load_workbook(io.BytesIO(directory), data_only=True).active
    records = list(sheet.values)
    headers = {clean(v): i for i, v in enumerate(records[0])}
    students = []
    for row in records[1:]:
        get = lambda key: clean(row[headers[key]])
        if not get("学号"):
            continue
        adviser = get("导师姓名")
        centers = adviser_centers[adviser]
        level, level_warning = normalize_level(get("培养层次"))
        if get("培养层次") and level_warning:
            raise ValueError(f"学生信息表{level_warning}")
        students.append(dict(student_no=get("学号"), name=get("姓名"), adviser=adviser or None,
            enrollment_year=normalize_year(get("年级"))[0], program_level=level,
            center=next(iter(centers)) if len(centers) == 1 else None))
    if len({s["student_no"] for s in students}) != len(students):
        raise ValueError("学生信息表中有重复学号")
    by_name = defaultdict(list)
    for student in students:
        by_name[student["name"]].append(student)
    warnings, assigned_numbers = [], set()
    matched_rows = defaultdict(list)
    for room in preview["rooms"].values():
        for row in room["rows"]:
            if row["kind"] != "student":
                continue
            candidates = by_name[row["person_name"]]
            if len(candidates) > 1:
                candidates = [s for s in candidates if s["adviser"] == row["adviser"]]
            if len(candidates) > 1 and row["enrollment_year"]:
                candidates = [s for s in candidates if s["enrollment_year"] == row["enrollment_year"]]
            if len(candidates) == 1:
                student = candidates[0]
                if row["program_level"] == "硕转博" and student["program_level"] == "博士":
                    student["program_level"] = "硕转博"
                if row["program_level"] in {"科研助理", "联培"}:
                    student["program_level"] = row["program_level"]
                assigned_numbers.add(student["student_no"])
                row["student_no"] = student["student_no"]
                matched_rows[student["student_no"]].append(row)
                # Room affiliation comes from the room survey; student affiliation from teacher roster.
                if not student["center"]:
                    student["center"] = center_name(row["major_name"]) or None
            else:
                warnings.append(dict(source_row=row["source_row"], name=row["person_name"],
                                     reason="未在学生信息表唯一匹配，保留座位记录，学号待补全"))
    conflicts = []
    for number, rows in matched_rows.items():
        if len(rows) < 2:
            continue
        chosen = (seat_overrides or {}).get(number)
        targets = [f"{row['room_name']}/{row['seat_code']}" for row in rows]
        if chosen and chosen not in targets:
            raise ValueError(f"重复安排的确认工位必须为 {targets}")
        conflicts.append(dict(student_no=number, name=rows[0]["person_name"], seats=targets, chosen=chosen))
        if not chosen:
            assigned_numbers.remove(number)
        for row in rows:
            if f"{row['room_name']}/{row['seat_code']}" != chosen:
                row.update(kind="empty", reserved=True, note=None, student_note=None)
                row["warnings"].append("最新表存在重复安排，原记录保留待核对")
    if seat_overrides:
        preview["fingerprint"] = hashlib.sha256((preview["fingerprint"] + repr(sorted(seat_overrides.items()))).encode()).hexdigest()
    preview.update(students=students, teachers=faculty, identity_warnings=warnings, assignment_conflicts=conflicts)
    preview["summary"].update(directory_students=len(students), teachers=len(faculty),
        matched_seated_students=len(assigned_numbers), unassigned_students=len(students)-len(assigned_numbers),
        unmatched_seated_records=len(warnings))
    return preview


def apply_latest(db, preview):
    fingerprint = preview["fingerprint"]
    previous = db.scalar(select(AuditLog).where(AuditLog.action == "latest.imported", AuditLog.target_id == fingerprint))
    if previous:
        return {"already_imported": True, "previous": previous.after_data}
    if db.scalar(select(Application.id).where(Application.status == "pending").limit(1)):
        raise ValueError("有待审批申请，请先处理后再同步最新安排")
    ensure_virtual_rooms(db)
    centers = {m.name: m for m in db.scalars(select(Major).with_for_update())}
    names = {t["center"] for t in preview["teachers"]}
    for name in sorted(names):
        if name not in centers:
            centers[name] = Major(name=name, sort_order=len(centers), is_active=True)
            db.add(centers[name])
    db.flush()
    for name, center in centers.items():
        center.is_active = name in names
    for teacher in db.scalars(select(Teacher)):
        teacher.is_active = False
    for record in preview["teachers"]:
        mid = centers[record["center"]].id
        teacher = db.scalar(select(Teacher).where(Teacher.name == record["name"], Teacher.major_id == mid))
        if teacher is None:
            teacher = Teacher(name=record["name"], major_id=mid)
            db.add(teacher)
        teacher.title, teacher.role, teacher.is_active = record["title"], record["role"], True
        db.flush()
    existing = list(db.scalars(select(Student).with_for_update()))
    by_number = {s.student_no: s for s in existing if s.student_no}
    by_name = defaultdict(list)
    for student in existing:
        by_name[student.name].append(student)
    claimed = set()

    def find_student(record):
        number = record.get("student_no")
        student = by_number.get(number) if number else None
        if student is None:
            candidates = [s for s in by_name[record["name"]] if s.id not in claimed and not s.student_no]
            matching = [s for s in candidates if s.adviser == record.get("adviser")]
            candidates = matching or candidates
            if len(candidates) == 1:
                student = candidates[0]
        if student is None:
            student = Student(name=record["name"])
            db.add(student)
            db.flush()
            existing.append(student)
        claimed.add(student.id)
        student.is_archived = False
        return student

    directory = {}
    for record in preview["students"]:
        student = find_student(record)
        for key in ("student_no", "name", "adviser", "enrollment_year", "program_level"):
            setattr(student, key, record[key])
        student.major_id = centers[record["center"]].id if record["center"] in centers else None
        student.email = student_email(student.student_no)
        student.is_complete = all((student.student_no, student.adviser, student.major_id,
                                   student.enrollment_year, student.program_level))
        directory[record["student_no"]] = student
    students_by_row = {}
    for room in preview["rooms"].values():
        for row in room["rows"]:
            if row["kind"] != "student":
                continue
            student = directory.get(row.get("student_no"))
            if student is None:
                student = find_student(dict(name=row["person_name"], adviser=row["adviser"]))
                student.adviser, student.enrollment_year = row["adviser"], row["enrollment_year"]
                student.program_level = row["program_level"]
                center = centers.get(center_name(row["major_name"]))
                student.major_id = center.id if center else None
                student.is_complete = False
            students_by_row[row["source_row"]] = student
    ended = []
    for assignment in db.scalars(select(Assignment).where(Assignment.ended_at.is_(None)).with_for_update()):
        ended.append(assignment.id)
        assignment.ended_at = utcnow()
    for student in existing:
        student.is_archived = student.id not in claimed
        student.email = student_email(student.student_no)
    db.flush()
    for room in db.scalars(select(Room).where(Room.is_virtual.is_(False))):
        if room.name not in preview["rooms"]:
            room.is_archived = True
    result = apply_survey(db, preview, students_by_row=students_by_row, authoritative=True)
    db.flush()
    unassigned = list(db.scalars(select(Student).where(Student.is_archived.is_(False), ~Student.assignments.any(Assignment.ended_at.is_(None)))))
    for student in unassigned:
        student.email = student_email(student.student_no)
        place_unassigned(db, student)
    result.update(unassigned_total=len(unassigned), identity_warnings=preview["identity_warnings"],
                  archived_students=sum(s.is_archived for s in existing),
                  assignment_conflicts=preview["assignment_conflicts"])
    db.add(AuditLog(action="latest.imported", target_type="import", target_id=fingerprint,
                    before_data={"ended_assignment_ids": ended}, after_data=result))
    db.flush()
    return result
