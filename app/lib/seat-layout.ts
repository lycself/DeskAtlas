import type { LayoutItem } from "./types";

export const GRID_SIZE = 12;
export const snap = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

export function itemBounds(item: LayoutItem) {
  const angle = item.rotation * Math.PI / 180;
  const corners = [[0, 0], [item.width, 0], [0, item.height], [item.width, item.height]].map(([x, y]) => ({
    x: item.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: item.y + x * Math.sin(angle) + y * Math.cos(angle),
  }));
  const left = Math.min(...corners.map((p) => p.x)), right = Math.max(...corners.map((p) => p.x));
  const top = Math.min(...corners.map((p) => p.y)), bottom = Math.max(...corners.map((p) => p.y));
  return { left, right, top, bottom, width: right - left, height: bottom - top, cx: (left + right) / 2, cy: (top + bottom) / 2 };
}

export type Alignment = "left" | "cx" | "right" | "top" | "cy" | "bottom" | "horizontal" | "vertical";

export function alignItems(items: LayoutItem[], ids: string[], mode: Alignment): LayoutItem[] {
  const selected = items.filter((item) => ids.includes(item.id));
  if (selected.length < (mode === "horizontal" || mode === "vertical" ? 3 : 2)) return items;
  const bounds = selected.map(itemBounds);
  const positions = new Map<string, { x: number; y: number }>();
  if (mode === "horizontal" || mode === "vertical") {
    const horizontal = mode === "horizontal";
    const start = horizontal ? "left" : "top", end = horizontal ? "right" : "bottom", size = horizontal ? "width" : "height";
    const sorted = selected.map((item) => ({ item, box: itemBounds(item) })).sort((a, b) => a.box[start] - b.box[start]);
    const first = sorted[0].box[start], last = sorted.at(-1)!.box[end];
    const gap = (last - first - sorted.reduce((sum, entry) => sum + entry.box[size], 0)) / (sorted.length - 1);
    if (gap < 0) throw new Error("所选元素空间不足，请先拉开两端，再等距分布。");
    let cursor = first;
    for (const { item, box } of sorted) {
      positions.set(item.id, { x: item.x + (horizontal ? cursor - box.left : 0), y: item.y + (horizontal ? 0 : cursor - box.top) });
      cursor += box[size] + gap;
    }
  } else {
    const horizontal = ["left", "cx", "right"].includes(mode);
    const low = Math.min(...bounds.map((b) => horizontal ? b.left : b.top));
    const high = Math.max(...bounds.map((b) => horizontal ? b.right : b.bottom));
    const destination = mode === "left" || mode === "top" ? low : mode === "right" || mode === "bottom" ? high : (low + high) / 2;
    selected.forEach((item, index) => positions.set(item.id, {
      x: item.x + (horizontal ? destination - bounds[index][mode] : 0),
      y: item.y + (horizontal ? 0 : destination - bounds[index][mode]),
    }));
  }
  return items.map((item) => positions.has(item.id) ? { ...item, ...positions.get(item.id) } : item);
}

export function moveItems(items: LayoutItem[], ids: string[], dx: number, dy: number, width: number, height: number) {
  const bounds = items.filter((item) => ids.includes(item.id)).map(itemBounds);
  if (!bounds.length) return items;
  const x = Math.max(-Math.min(...bounds.map((b) => b.left)), Math.min(dx, width - Math.max(...bounds.map((b) => b.right))));
  const y = Math.max(-Math.min(...bounds.map((b) => b.top)), Math.min(dy, height - Math.max(...bounds.map((b) => b.bottom))));
  return items.map((item) => ids.includes(item.id) ? { ...item, x: item.x + x, y: item.y + y } : item);
}

// Snap to matching edges/centres of neighbouring desks, independent of imported grid offsets.
export function guidedDelta(anchor: LayoutItem, targets: LayoutItem[], others: LayoutItem[], x: number, y: number,
  width: number, height: number, grid: boolean, threshold: number) {
  let delta = grid ? snappedDelta(anchor, targets, x, y, width, height) : { x: x - anchor.x, y: y - anchor.y };
  const pointerDelta = { x: x - anchor.x, y: y - anchor.y };
  const box = itemBounds({ ...anchor, x, y });
  const guides: { x?: number; y?: number } = {};
  for (const [axis, edges] of [["x", ["left", "cx", "right"]], ["y", ["top", "cy", "bottom"]]] as const) {
    let best = threshold, offset = 0;
    for (const other of others.filter((item) => item.type === anchor.type && !targets.some((t) => t.id === item.id))) {
      const reference = itemBounds(other);
      for (const edge of edges) {
        const difference = reference[edge] - box[edge];
        if (Math.abs(difference) < best) { best = Math.abs(difference); offset = difference; guides[axis] = reference[edge]; }
      }
    }
    if (guides[axis] !== undefined) delta = { ...delta, [axis]: pointerDelta[axis] + offset };
  }
  const clamped = moveItems(targets, targets.map((item) => item.id), delta.x, delta.y, width, height);
  const final = clamped.find((item) => item.id === anchor.id)!;
  if (Math.abs(final.x - anchor.x - delta.x) > .01) delete guides.x;
  if (Math.abs(final.y - anchor.y - delta.y) > .01) delete guides.y;
  return { x: final.x - anchor.x, y: final.y - anchor.y, guides };
}

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
