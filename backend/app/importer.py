from __future__ import annotations

import io
import re
from typing import Any

from openpyxl import load_workbook

from .program_levels import LEVEL_ALIASES, level_from_note
from .report_notes import import_note

HEADER_ALIASES = {
    "room": {"房间", "房间号", "办公室", "教室"},
    "seat": {"座位号", "工位号", "座位", "工位"},
    "name": {"姓名", "学生姓名", "姓名或设备名", "姓名/设备名"},
    "adviser": {"导师", "指导教师"},
    "year": {"年级", "入学年份", "年级（202X级）"},
    "level": {"培养层次（硕/博）", "培养层次", "学历层次"},
    "major": {"专业", "教研中心", "方向"},
    "note": {"备注", "说明"},
    "student_note": {"学生备注", "学生状态备注"},
    "seat_note": {"工位备注", "座位备注"},
    "student_no": {"学号"},
}


def _header_key(value: Any) -> str:
    text = str(value or "").strip()
    for key, aliases in HEADER_ALIASES.items():
        if text in aliases:
            return key
    return ""


def normalize_level(value: Any) -> tuple[str | None, str | None]:
    text = str(value or "").strip()
    if text in LEVEL_ALIASES:
        return LEVEL_ALIASES[text], None
    if not text:
        return None, "培养层次缺失"
    return None, f"无法识别培养层次：{text}"


def normalize_year(value: Any) -> tuple[int | None, str | None]:
    if value is None or str(value).strip() == "":
        return None, "年级缺失"
    text = str(value).strip().replace(".0", "")
    match = re.fullmatch(r"(20\d{2})级?", text)
    if match:
        return int(match.group(1)), None
    return None, f"年级需要人工确认：{text}"


def preview_workbook(content: bytes) -> dict[str, Any]:
    workbook = load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    worksheet = workbook.active
    rows = list(worksheet.iter_rows(values_only=True))
    if not rows:
        return {"rows": [], "summary": {"total": 0, "review": 0}}

    indices: dict[str, int] = {}
    for index, value in enumerate(rows[0]):
        key = _header_key(value)
        if key:
            indices[key] = index
    required = {"room", "seat", "name"}
    if not required.issubset(indices):
        missing = "、".join({"room": "房间", "seat": "座位号", "name": "姓名或设备名"}[key] for key in sorted(required - set(indices)))
        raise ValueError(f"缺少必要列：{missing}。请下载模板并保留第一行表头。")

    result: list[dict[str, Any]] = []
    for row_number, row in enumerate(rows[1:], start=2):
        value = lambda key: row[indices[key]] if key in indices and indices[key] < len(row) else None
        room = str(value("room") or "").strip()
        seat = str(value("seat") or "").strip().replace(".0", "")
        name = str(value("name") or "").strip()
        if not room and not seat and not name:
            continue

        warnings: list[str] = []
        level, level_warning = normalize_level(value("level"))
        source_level = level
        note = str(value("note") or "").strip() or None
        equipment = any(token in name.lower() for token in ("打印机", "柜", "设备", "服务器"))
        kind = "equipment" if equipment else "student" if name else "empty"
        source_student_note = (str(value("student_note") or "").strip() or None) if "student_note" in indices else note if kind == "student" else None
        source_seat_note = (str(value("seat_note") or "").strip() or None) if "seat_note" in indices else note if kind != "student" else None
        note_level = level_from_note(source_student_note)
        if note_level:
            level, level_warning = note_level, None
        year, year_warning = normalize_year(value("year"))
        if kind == "student" and level_warning:
            warnings.append(level_warning)
        if kind == "student" and year_warning:
            warnings.append(year_warning)
        if not room:
            warnings.append("房间缺失")
        if not seat:
            warnings.append("座位号缺失")

        if equipment:
            warnings = [warning for warning in warnings if "培养层次" not in warning and "年级" not in warning]
            warnings.append("识别为设备，请确认")

        result.append(
            {
                "source_row": row_number,
                "room_name": room,
                "seat_code": seat,
                "person_name": name,
                "adviser": str(value("adviser") or "").strip() or None,
                "enrollment_year": year,
                "program_level": level,
                "source_program_level": source_level,
                "major_name": str(value("major") or "").strip() or None,
                "note": import_note(note, level),
                "source_note": note,
                "student_note": import_note(source_student_note, level),
                "seat_note": import_note(source_seat_note, None),
                "source_student_note": source_student_note,
                "source_seat_note": source_seat_note,
                "source_student_no": str(value("student_no") or "").strip().removesuffix(".0") or None,
                "kind": kind,
                "reserved": kind == "empty" and any(token in (source_seat_note or "") for token in ("备用间", "放物品", "个工位")),
                "warnings": warnings,
            }
        )

    return {
        "rows": result,
        "summary": {
            "total": len(result),
            "review": sum(bool(row["warnings"]) for row in result),
            "students": sum(row["kind"] == "student" for row in result),
            "empty": sum(row["kind"] == "empty" for row in result),
            "equipment": sum(row["kind"] == "equipment" for row in result),
        },
    }


def validate_import_row(row: dict[str, Any]) -> dict[str, Any]:
    """Validate the edited values, rather than trusting warnings from the upload."""
    row = dict(row)
    warnings = []
    if not str(row.get("room_name") or "").strip():
        warnings.append("房间缺失")
    if row.get("kind") != "equipment" and not str(row.get("seat_code") or "").strip():
        warnings.append("座位号缺失")
    if row.get("kind") == "student":
        if not str(row.get("person_name") or "").strip():
            warnings.append("学生姓名缺失")
        level, warning = normalize_level(row.get("program_level"))
        row["program_level"] = level
        if warning:
            warnings.append(warning)
        year, warning = normalize_year(row.get("enrollment_year"))
        row["enrollment_year"] = year
        if warning:
            warnings.append(warning)
    elif row.get("kind") == "equipment":
        warnings.append("识别为设备，请确认")
    row["warnings"] = warnings
    return row
