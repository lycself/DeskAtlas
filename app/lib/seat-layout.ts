import type { LayoutItem } from "./types";

export const GRID_SIZE = 12;
export const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

// Move the group by one delta so imported spacing is preserved.
export function snappedDelta(anchor: LayoutItem, targets: LayoutItem[], x: number, y: number, width: number, height: number) {
  const corners = targets.flatMap((item) => {
    const angle = item.rotation * Math.PI / 180;
    return [[0, 0], [item.width, 0], [0, item.height], [item.width, item.height]].map(([dx, dy]) => ({
      x: item.x + dx * Math.cos(angle) - dy * Math.sin(angle),
      y: item.y + dx * Math.sin(angle) + dy * Math.cos(angle),
    }));
  });
  const clampDelta = (value: number, origin: number, min: number, max: number, size: number) => {
    // The anchor stays on the grid, including at room boundaries.
    const lower = Math.ceil((origin - min) / GRID_SIZE) * GRID_SIZE;
    const upper = Math.floor((origin + size - max) / GRID_SIZE) * GRID_SIZE;
    if (lower > upper) return 0; // Oversized imported groups cannot fit without reshaping.
    return Math.min(upper, Math.max(lower, snap(value))) - origin;
  };
  return {
    x: clampDelta(x, anchor.x, Math.min(...corners.map((point) => point.x)), Math.max(...corners.map((point) => point.x)), width),
    y: clampDelta(y, anchor.y, Math.min(...corners.map((point) => point.y)), Math.max(...corners.map((point) => point.y)), height),
  };
}
