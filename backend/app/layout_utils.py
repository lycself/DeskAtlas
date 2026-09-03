from __future__ import annotations

import copy
from typing import Any


def rectangles_overlap(first: dict[str, Any], second: dict[str, Any], gap: float = 8) -> bool:
    return not (
        float(first.get("x", 0)) + float(first.get("width", 0)) + gap <= float(second.get("x", 0))
        or float(second.get("x", 0)) + float(second.get("width", 0)) + gap <= float(first.get("x", 0))
        or float(first.get("y", 0)) + float(first.get("height", 0)) + gap <= float(second.get("y", 0))
        or float(second.get("y", 0)) + float(second.get("height", 0)) + gap <= float(first.get("y", 0))
    )


def find_open_position(
    layout: list[dict[str, Any]],
    width: float,
    height: float,
    canvas_width: float,
    canvas_height: float,
) -> tuple[float, float]:
    max_x = max(24, int(canvas_width - width - 24))
    max_y = max(24, int(canvas_height - height - 24))
    x_values = list(range(40, max_x + 1, 105))
    y_values = list(range(40, max_y + 1, 82))
    if max_x not in x_values:
        x_values.append(max_x)
    if max_y not in y_values:
        y_values.append(max_y)

    # Imported fixtures belong away from the main seat grid when space permits.
    for y in [max_y, *reversed(y_values)]:
        for x in x_values:
            candidate = {"x": x, "y": y, "width": width, "height": height}
            if not any(rectangles_overlap(candidate, item) for item in layout):
                return float(x), float(y)
    return float(max_x), float(max_y)


def repair_imported_equipment(
    layout: list[dict[str, Any]] | None,
    canvas_width: float,
    canvas_height: float,
) -> tuple[list[dict[str, Any]], bool]:
    repaired = copy.deepcopy(layout or [])
    changed = False
    for equipment in repaired:
        if equipment.get("type") != "equipment" or not str(equipment.get("id", "")).startswith("import-equipment-"):
            continue
        others = [item for item in repaired if item is not equipment]
        if not any(rectangles_overlap(equipment, item) for item in others):
            continue
        x, y = find_open_position(
            others,
            float(equipment.get("width", 82)),
            float(equipment.get("height", 52)),
            canvas_width,
            canvas_height,
        )
        equipment["x"] = x
        equipment["y"] = y
        changed = True
    return repaired, changed
