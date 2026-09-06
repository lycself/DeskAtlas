"""Import the surveyed roster and its hand-drawn Excel seat map together.

Ranges were checked against the room borders and labels in 工位分布.xlsx.
They deliberately do not infer occupant/status information from cell colors.
"""
from __future__ import annotations

import copy
import hashlib
import io
from collections import Counter, defaultdict
from typing import Any

from openpyxl import load_workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from .importer import preview_workbook
from .models import Assignment, AuditLog, Major, Room, Seat, Student, utcnow


MAP_RANGES = {
    "406": "B2:F10", "402": "H2:M10", "408": "O2:S10", "411": "U2:W10",
    "324": "AE2:AI8", "457": "AK2:AR7", "444": "AT2:AY8",
    "424": "B13:F20", "442-2": "H13:M23", "417": "O13:Q21",
    "431": "S13:AC20", "302": "AE13:AI19", "313": "AK13:AO20",
    "442-1": "AQ13:AW23", "322": "B26:G30", "555": "I26:P30",
    "421": "R26:V34", "301": "X26:AA30", "321": "AC26:AG34",
    "423": "AI26:AM34", "415": "AO26:AS34", "419": "AU26:AY34",
    "311": "B37:F45", "315": "H37:K44", "323": "M37:Q44",
    "559-1": "S37:X46", "425": "Z37:AD44", "362": "AF37:AM42",
    "559-2": "B48:F57", "680": "H48:N53", "558": "P48:T58",
    "661": "V48:AB53", "409": "AD48:AF55", "413": "AH48:AL56",
}


def fill_missing_student_fields(student: Student, row: dict[str, Any]) -> dict[str, Any]:
    changes = {}
    for field in ("adviser", "enrollment_year", "program_level"):
        if getattr(student, field) is None and row.get(field) is not None:
            setattr(student, field, row[field])
            changes[field] = row[field]
    return changes


def surveyed_preview(roster: bytes, floorplan: bytes) -> dict[str, Any]:
    preview = preview_workbook(roster)
    sheet = load_workbook(io.BytesIO(floorplan), data_only=True).active
    rooms = defaultdict(list)
    names = Counter(row["person_name"] for row in preview["rows"] if row["person_name"])
    for row in preview["rows"]:
        if not row["room_name"] or not row["seat_code"]:
            raise ValueError(f"汇总表第 {row['source_row']} 行缺少房间或座位号")
        if not row["person_name"]:
            row["warnings"] = []
        note = row["note"] or ""
        if not row["person_name"] and "打印机" in note:
            row.update(kind="equipment", person_name="打印机")
        if names[row["person_name"]] > 1 and row["kind"] == "student":
            row["warnings"].append("姓名在汇总表中重复；未按姓名合并，请核对学号")
        if "退学" in note:
            row["warnings"].append("备注退学；保留表内占用，待核实是否已腾退")
        rooms[row["room_name"]].append(row)

    result = {}
    for name, rows in rooms.items():
        codes = [row["seat_code"] for row in rows]
        if len(codes) != len(set(codes)):
            raise ValueError(f"房间 {name} 的汇总表座位号重复")
        locations = defaultdict(list)
        doors = []
        walls = {}
        region = MAP_RANGES.get(name)
        if region:
            cells = sheet[region]
            if not any(str(cell.value) == name for line in cells for cell in line):
                raise ValueError(f"分布图 {region} 中找不到房间标签 {name}，请重新核对范围")
            origin_row, origin_col = cells[0][0].row, cells[0][0].column
            for line in cells:
                for cell in line:
                    left = 39 + (cell.column - origin_col) * 94
                    top = 55 + (cell.row - origin_row) * 66
                    edges = {"top": (left, top, 94, 4), "bottom": (left, top + 66, 94, 4),
                             "left": (left, top, 4, 66), "right": (left + 94, top, 4, 66)}
                    for edge, geometry in edges.items():
                        border = getattr(cell.border, edge)
                        if border and border.style in {"medium", "thick", "double"}:
                            walls[geometry] = dict(zip(("x", "y", "width", "height"), geometry))
                    location = {"x": 48 + (cell.column - origin_col) * 94,
                                "y": 64 + (cell.row - origin_row) * 66,
                                "source_cell": cell.coordinate}
                    if isinstance(cell.value, (int, float)) and 0 < cell.value < 100:
                        locations[str(int(cell.value))].append(location)
                    elif cell.value == "门":
                        doors.append(location)
        unique = {code: locs[0] for code, locs in locations.items() if len(locs) == 1}
        missing = [code for code in codes if code not in unique]
        duplicates = {code: [p["source_cell"] for p in locs]
                      for code, locs in locations.items() if len(locs) > 1}
        extra = sorted(set(locations) - set(codes), key=int)
        for row in rows:
            row["location"] = unique.get(row["seat_code"])
            if row["seat_code"] in missing:
                row["warnings"].append("分布图未提供唯一位置")
            row["reserved"] = (row["kind"] == "empty" and (
                any(token in (row["note"] or "") for token in ("备用间", "放物品", "个工位"))
                or bool(region and row["seat_code"] in missing)))
        result[name] = {"rows": rows, "doors": doors, "walls": list(walls.values()), "range": region,
                        "major_names": sorted({row["major_name"] for row in rows if row["major_name"]}),
                        "missing": missing, "duplicates": duplicates, "extra": extra}
    return {"fingerprint": hashlib.sha256(roster + floorplan).hexdigest(), "rooms": result,
            "summary": {"rooms": len(result), "rows": len(preview["rows"]),
                        "mapped_rooms": sum(bool(r["range"]) for r in result.values()),
                        "students": sum(r["kind"] == "student" for r in preview["rows"]),
                        "equipment": sum(r["kind"] == "equipment" for r in preview["rows"]),
                        "reserved": sum(r["reserved"] for r in preview["rows"])}}


def apply_survey(db: Session, preview: dict[str, Any], *, replace_conflicts: bool = False) -> dict[str, Any]:
    """Caller owns the transaction. Repeated source files cannot overwrite later edits."""
    fingerprint = preview["fingerprint"]
    previous = db.scalar(select(AuditLog).where(AuditLog.action == "survey.imported",
                                                AuditLog.target_id == fingerprint))
    if previous:
        return {"already_imported": True, "previous": previous.after_data}
    counts = Counter()
    conflicts = []
    before = []
    room_objects = {}
    # Lock rooms and all active assignments before reconciling occupancy.
    for room in db.scalars(select(Room).with_for_update()):
        room_objects[room.name] = room
    active = list(db.scalars(select(Assignment).where(Assignment.ended_at.is_(None)).with_for_update()))
    by_seat = {a.seat_id: a for a in active}
    reusable = {}
    if replace_conflicts:
        for name, info in preview["rooms"].items():
            room = room_objects.get(name)
            if not room:
                continue
            source = {r["seat_code"]: r for r in info["rows"]}
            for seat in room.seats:
                assignment = by_seat.get(seat.id)
                row = source.get(seat.code)
                if assignment and row and assignment.student.name != row["person_name"]:
                    before.append({"room": name, "seat": seat.code, "assignment_id": assignment.id,
                                   "student_id": assignment.student_id, "name": assignment.student.name})
                    assignment.ended_at = utcnow()
                    assignment.note = (assignment.note or "") + "；本次实测汇总表更新，保留原分配历史"
                    student = assignment.student
                    reusable[(student.name, student.adviser)] = student
                    del by_seat[seat.id]
                    counts["ended_assignments"] += 1
        db.flush()

    for name, info in preview["rooms"].items():
        room = room_objects.get(name)
        if room is None:
            room = Room(name=name, floor=f"{int(name.split('-')[0]) // 100}层")
            db.add(room)
            db.flush()
            counts["created_rooms"] += 1
        seats = {s.code: s for s in room.seats}
        room.major_names = list(dict.fromkeys([*(room.major_names or []), *info.get("major_names", [])]))
        layout = []
        mapped_bottom = max([p["y"] + 48 for p in info["doors"]] +
                            [r["location"]["y"] + 48 for r in info["rows"] if r["location"]] + [64])
        fallback_y = mapped_bottom + 96 if info["range"] else 104
        if info["missing"]:
            layout.append(dict(id=f"survey-note-{room.id}", type="label",
                               label="位置待核对（下方按编号暂排）", x=48, y=fallback_y - 48,
                               width=380, height=30, rotation=0))
        fallback_index = 0
        for row in info["rows"]:
            code = row["seat_code"]
            position = row["location"]
            if not position:
                position = {"x": 48 + (fallback_index % 8) * 94,
                            "y": fallback_y + (fallback_index // 8) * 66}
                fallback_index += 1
            note = "；".join(filter(None, [row["note"],
                f"汇总表第{row['source_row']}行", *row["warnings"]]))
            if row["kind"] == "empty":
                note += "；" + "；".join(filter(None, [
                    f"导师：{row['adviser']}" if row["adviser"] else None,
                    f"教研中心：{row['major_name']}" if row["major_name"] else None,
                ]))
            if row["kind"] == "equipment":
                existing = seats.get(code)
                if existing and (by_seat.get(existing.id) or any(a.status == "pending" for a in existing.applications)):
                    raise ValueError(f"{name}/{code} 被占用或正在申请，不能转换为设备")
                if existing:
                    existing.is_archived = True
                layout.append(dict(id=f"survey-equipment-{room.id}-{code}", type="equipment",
                                   label=f"{code}号 打印机", x=position["x"], y=position["y"],
                                   width=76, height=48, rotation=0))
                counts["equipment"] += 1
                continue
            seat = seats.get(code)
            if seat is None:
                seat = Seat(room_id=room.id, code=code, note=note,
                            admin_status="reserved" if row["reserved"] else "active")
                db.add(seat)
                db.flush()
                counts["created_seats"] += 1
            else:
                seat.note = "；".join(filter(None, [seat.note, note]))
                if row["reserved"] and seat.admin_status == "active":
                    seat.admin_status = "reserved"
            layout.append(dict(id=seat.id, type="seat", label=code, x=position["x"],
                               y=position["y"], width=76, height=48, rotation=0))
            assignment = by_seat.get(seat.id)
            if assignment:
                if assignment.student.name != row["person_name"]:
                    conflict = {"room": name, "seat": code, "platform": assignment.student.name,
                                "excel": row["person_name"]}
                    conflicts.append(conflict)
                    seat.note += "；平台占用与Excel不一致，待核对"
                else:
                    counts["matched_assignments"] += 1
                    changes = fill_missing_student_fields(assignment.student, row)
                    if changes:
                        counts["updated_students"] += 1
                        before.append({"student_id": assignment.student_id,
                                       "filled_missing_fields": changes})
                continue
            if row["kind"] != "student":
                continue
            if any(a.status == "pending" for a in seat.applications):
                raise ValueError(f"{name}/{code} 有待审批申请，请先处理再导入")
            major = db.scalar(select(Major).where(Major.name == row["major_name"])) if row["major_name"] else None
            if row["major_name"] and not major:
                major = Major(name=row["major_name"], sort_order=999)
                db.add(major)
                db.flush()
            student = reusable.pop((row["person_name"], row["adviser"]), None)
            if not student:
                student = Student(name=row["person_name"], adviser=row["adviser"],
                                  enrollment_year=row["enrollment_year"], program_level=row["program_level"],
                                  major_id=major.id if major else None, is_complete=False)
                db.add(student)
                db.flush()
                counts["created_students"] += 1
            db.add(Assignment(student_id=student.id, seat_id=seat.id, source="survey", note=note))
            counts["created_assignments"] += 1
        for i, position in enumerate(info["doors"]):
            layout.append(dict(id=f"survey-door-{room.id}-{i}", type="door", label="门",
                               x=position["x"], y=position["y"], width=76, height=42, rotation=0))
        for i, wall in enumerate(info.get("walls", [])):
            layout.append(dict(id=f"survey-wall-{room.id}-{i}", type="wall", label="墙",
                               rotation=0, **wall))
        # Preserve seats outside the source instead of silently deleting platform data.
        included = {item["id"] for item in layout}
        for item in room.draft_layout or []:
            if item.get("type") == "seat" and item["id"] not in included:
                seat = next((s for s in seats.values() if s.id == item["id"]), None)
                if seat and not seat.is_archived:
                    raise ValueError(f"平台房间 {name} 存在汇总表未列出的座位 {seat.code}")
        description = "按实测工位分布图还原相对位置；间距为示意尺寸。" if info["range"] else "分布图未提供此房间；按座位号暂排，实际位置待核对。"
        if info["missing"] and info["range"]:
            description += " 未定位编号：" + "、".join(info["missing"]) + "。"
        if info["duplicates"]:
            description += " 图中重复编号：" + "、".join(info["duplicates"]) + "。"
        if info["extra"]:
            description += " 图有但汇总表未列编号：" + "、".join(info["extra"]) + "（未新增）。"
        room.description = " ".join(filter(None, [room.description, description]))
        room.canvas_width = max(960, int(max(i["x"] + i["width"] for i in layout) + 48))
        room.canvas_height = max(620, int(max(i["y"] + i["height"] for i in layout) + 48))
        room.draft_layout = layout
        room.published_layout = copy.deepcopy(layout)
        room.is_published = True
        room.published_at = utcnow()
    result = {"counts": dict(counts), "conflicts": conflicts, "summary": preview["summary"]}
    db.add(AuditLog(action="survey.imported", target_type="import", target_id=fingerprint,
                    before_data={"replaced_assignments": before}, after_data=result))
    db.flush()
    return result
