from __future__ import annotations

import io
import re
from typing import Any

from openpyxl import load_workbook


HEADER_ALIASES = {
    "room": {"房间", "房间号", "办公室", "教室"},
    "seat": {"座位号", "工位号", "座位", "工位"},
    "name": {"姓名", "学生姓名"},
    "adviser": {"导师", "指导教师"},
    "year": {"年级", "入学年份", "年级（202X级）"},
    "level": {"培养层次（硕/博）", "培养层次", "学历层次"},
    "major": {"专业", "教研中心", "方向"},
    "note": {"备注", "说明"},
}


def _header_key(value: Any) -> str:
    text = str(value or "").strip()
    for key, aliases in HEADER_ALIASES.items():
        if text in aliases:
            return key
    return ""


def normalize_level(value: Any) -> tuple[str | None, str | None]:
    text = str(value or "").strip()
    if text in {"硕", "硕士", "硕士生"}:
        return "硕士", None
    if text in {"博", "博士", "博士生"}:
        return "博士", None
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
        missing = "、".join(sorted(required - set(indices)))
        raise ValueError(f"缺少必要列：{missing}")

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
        year, year_warning = normalize_year(value("year"))
        if level_warning:
            warnings.append(level_warning)
        if year_warning:
            warnings.append(year_warning)
        if not room:
            warnings.append("房间缺失")
        if not seat:
            warnings.append("座位号缺失")

        lower_name = name.lower()
        equipment = any(token in lower_name for token in ("打印机", "柜", "设备", "服务器"))
        kind = "equipment" if equipment else "student"
        if kind == "student" and not name:
            kind = "empty"
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
                "major_name": str(value("major") or "").strip() or None,
                "note": str(value("note") or "").strip() or None,
                "kind": kind,
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
