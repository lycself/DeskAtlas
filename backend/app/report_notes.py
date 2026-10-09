"""Normalize source fields at import; report remarks are otherwise literal text."""

import re

from .program_levels import LEVEL_ALIASES


def import_note(note: str | None, program_level: str | None) -> str | None:
    """Move explicit level/status labels into their fields, retaining actual details."""
    if not note:
        return None
    parts = []
    for part in re.split(r"[；;]", note):
        part = part.strip()
        if part == "备用间":
            continue  # The source status is stored in reserved/admin_status.
        if program_level and LEVEL_ALIASES.get(part) == program_level:
            continue
        match = re.match(r"^(科研助理|(?:出国)?联培)(?=$|[\s（(])", part)
        if match and LEVEL_ALIASES[match[1]] == program_level:
            part = part[match.end():].strip()
            if part.startswith(("（", "(")):
                part = "时间" + part
        if part:
            parts.append(part)
    return "；".join(parts) or None


def row_notes(row: dict) -> tuple[str | None, str | None]:
    """Explicit columns take precedence; legacy occupied rows describe the person."""
    student_note = row.get("student_note", row.get("note") if row.get("kind") == "student" else None)
    seat_note = row.get("seat_note", row.get("note") if row.get("kind") != "student" else None)
    return student_note, seat_note


def update_imported_student_note(student, row: dict) -> None:
    if student.note_source != "manual":
        student.note = row_notes(row)[0]
        student.note_source = "import"
