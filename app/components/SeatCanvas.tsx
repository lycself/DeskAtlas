"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Layer, Line, Rect, Stage, Text } from "react-konva";
import type { LayoutItem, Room, SeatState } from "@/app/lib/types";

type Props = {
  room: Room;
  items?: LayoutItem[];
  editable?: boolean;
  selectedId?: string | null;
  selectedIds?: string[];
  onSelect?: (item: LayoutItem | null, additive?: boolean) => void;
  onItemsChange?: (items: LayoutItem[]) => void;
};

const stateColors: Record<SeatState, { fill: string; stroke: string }> = {
  available: { fill: "#59d6a0", stroke: "#149463" },
  pending: { fill: "#f7c75d", stroke: "#c98513" },
  occupied: { fill: "#74a9ff", stroke: "#3569c8" },
  unavailable: { fill: "#9aa4af", stroke: "#68727c" },
};

function snap(value: number) {
  return Math.max(0, Math.round(value / 12) * 12);
}

export default function SeatCanvas({ room, items, editable = false, selectedId, selectedIds = [], onSelect, onItemsChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const renderItems = items ?? room.items;

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(Math.max(320, entry.contentRect.width)));
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const scale = Math.min(containerWidth / room.canvas_width, 1.35);
  const height = Math.max(340, room.canvas_height * scale);
  const grid = useMemo(() => {
    const lines = [];
    for (let x = 0; x <= room.canvas_width; x += 48) lines.push([x, 0, x, room.canvas_height]);
    for (let y = 0; y <= room.canvas_height; y += 48) lines.push([0, y, room.canvas_width, y]);
    return lines;
  }, [room.canvas_height, room.canvas_width]);

  const moveItem = (item: LayoutItem, x: number, y: number) => {
    if (!onItemsChange) return;
    const nextX = snap(x);
    const nextY = snap(y);
    const group = selectedIds.includes(item.id) ? selectedIds : [item.id];
    const dx = nextX - item.x;
    const dy = nextY - item.y;
    onItemsChange(renderItems.map((candidate) => (group.includes(candidate.id) ? { ...candidate, x: snap(candidate.x + dx), y: snap(candidate.y + dy) } : candidate)));
  };

  return (
    <div className="seat-map" ref={containerRef}>
      <Stage
        width={containerWidth}
        height={height}
        scaleX={scale}
        scaleY={scale}
        onMouseDown={(event) => event.target === event.target.getStage() && onSelect?.(null)}
      >
        <Layer>
          <Rect width={room.canvas_width} height={room.canvas_height} fill="rgba(255,255,255,.035)" />
          {editable &&
            grid.map((points, index) => (
              <Line key={index} points={points} stroke="rgba(130,150,175,.12)" strokeWidth={1 / scale} />
            ))}
          {renderItems.map((item) => {
            const selected = selectedId === item.id || selectedIds.includes(item.id);
            const state = item.seat?.display_state ?? "available";
            const palette = stateColors[state];
            const isSeat = item.type === "seat";
            const fixtureFill = item.type === "aisle" ? "rgba(130,150,175,.08)" : "rgba(120,138,160,.2)";
            return (
              <Group
                key={item.id}
                x={item.x}
                y={item.y}
                rotation={item.rotation}
                draggable={editable}
                onClick={(event) => onSelect?.(item, Boolean(event.evt.shiftKey))}
                onTap={() => onSelect?.(item)}
                onDragEnd={(event) => moveItem(item, event.target.x(), event.target.y())}
              >
                <Rect
                  width={item.width}
                  height={item.height}
                  fill={item.type === "wall" ? "#637181" : isSeat ? palette.fill : fixtureFill}
                  stroke={selected ? "#ffffff" : isSeat ? palette.stroke : "rgba(130,150,175,.55)"}
                  strokeWidth={selected ? 3 : 1.4}
                  dash={item.type === "aisle" || item.type === "window" ? [8, 6] : undefined}
                  cornerRadius={item.type === "wall" ? 0 : isSeat ? 9 : item.type === "column" ? 3 : 6}
                  shadowColor={isSeat ? palette.stroke : "transparent"}
                  shadowBlur={selected ? 15 : 5}
                  shadowOpacity={0.2}
                />
                <Text
                  width={item.width}
                  height={item.height}
                  align="center"
                  verticalAlign="middle"
                  text={item.type === "wall" ? "" : isSeat ? `${item.label}${item.seat?.occupant ? `\n${item.seat.occupant.name}` : ""}` : item.label}
                  fill={isSeat ? "#10243a" : "#718096"}
                  fontSize={isSeat ? 13 : 12}
                  fontStyle={isSeat ? "bold" : "normal"}
                  listening={false}
                />
              </Group>
            );
          })}
        </Layer>
      </Stage>
    </div>
  );
}
