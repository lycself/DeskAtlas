"use client";

import { memo, useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Group, Layer, Rect, Shape, Stage, Text } from "react-konva";
import { Maximize2, Minus, Plus } from "lucide-react";
import type { LayoutItem, Room, SeatState } from "@/app/lib/types";
import { GRID_SIZE, snappedDelta } from "@/app/lib/seat-layout";

type Props = {
  room: Room; items?: LayoutItem[]; editable?: boolean; selectedId?: string | null; selectedIds?: string[];
  onSelect?: (item: LayoutItem | null, additive?: boolean) => void;
  onItemsChange?: (items: LayoutItem[]) => void;
};
const colors: Record<SeatState, { fill: string; stroke: string }> = {
  available: { fill: "#d5eee2", stroke: "#388264" }, pending: { fill: "#fff0cf", stroke: "#b78628" },
  occupied: { fill: "#dce8f8", stroke: "#628ac1" }, unavailable: { fill: "#e1e5eb", stroke: "#8793a2" },
};
type DragNode = { node: Konva.Group; item: LayoutItem; index: number };

function SeatCanvas({ room, items, editable = false, selectedId, selectedIds = [], onSelect, onItemsChange }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const scene = useRef<Konva.Layer>(null);
  const dragLayer = useRef<Konva.Layer>(null);
  const drag = useRef<DragNode[]>([]);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const renderItems = items ?? room.items;
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const viewportHeight = 520;
  const fitScale = Math.min(width / room.canvas_width, viewportHeight / room.canvas_height, 1);
  const scale = fitScale * zoom;
  const selectedSet = new Set(selectedIds.length ? selectedIds : selectedId ? [selectedId] : []);

  const beginDrag = (node: Konva.Group, item: LayoutItem) => {
    if (!scene.current || !dragLayer.current) return;
    const ids = selectedSet.has(item.id) ? selectedSet : new Set([item.id]);
    const entries: DragNode[] = [];
    scene.current.getChildren().forEach((child) => {
      const target = renderItems.find((candidate) => candidate.id === child.id());
      if (target && ids.has(target.id)) entries.push({ node: child as Konva.Group, item: target, index: child.zIndex() });
    });
    drag.current = entries;
    entries.forEach((entry) => entry.node.moveTo(dragLayer.current!));
    scene.current.batchDraw();
  };
  const moveDrag = (node: Konva.Group, item: LayoutItem) => {
    const targets = drag.current.map((entry) => entry.item);
    if (!targets.length) return;
    const delta = snappedDelta(item, targets, node.x(), node.y(), room.canvas_width, room.canvas_height);
    drag.current.forEach((entry) => entry.node.position({ x: entry.item.x + delta.x, y: entry.item.y + delta.y }));
  };
  const finishDrag = (node: Konva.Group, item: LayoutItem) => {
    moveDrag(node, item);
    const positions = new Map(drag.current.map((entry) => [entry.item.id, entry.node.position()]));
    // Explicitly set final node positions even when snapped React props did not change.
    drag.current.sort((a, b) => a.index - b.index).forEach((entry) => { entry.node.moveTo(scene.current!); entry.node.zIndex(entry.index); });
    drag.current = [];
    scene.current?.batchDraw(); dragLayer.current?.batchDraw();
    const next = renderItems.map((candidate) => {
      const position = positions.get(candidate.id);
      return position && (position.x !== candidate.x || position.y !== candidate.y) ? { ...candidate, ...position } : candidate;
    });
    if (next.some((candidate, index) => candidate !== renderItems[index])) onItemsChange?.(next);
    if (!selectedSet.has(item.id)) onSelect?.(next.find((candidate) => candidate.id === item.id) ?? item);
  };

  return <div className="canvas-workspace" ref={container}>
    <div className="canvas-controls"><span>{editable ? "网格吸附 · Shift 多选" : "平面图预览"}</span><div>
      <button aria-label="缩小编辑画布" disabled={zoom <= .5} onClick={() => setZoom((value) => Math.max(.5, value - .25))}><Minus size={15} /></button>
      <span>{Math.round(scale * 100)}%</span>
      <button aria-label="放大编辑画布" disabled={zoom >= 3} onClick={() => setZoom((value) => Math.min(3, value + .25))}><Plus size={15} /></button>
      <button aria-label="适应编辑窗口" onClick={() => setZoom(1)}><Maximize2 size={15} /></button>
    </div></div>
    <div className="canvas-viewport" style={{ height: viewportHeight }}>
      <Stage width={Math.max(width, room.canvas_width * scale)} height={Math.max(viewportHeight, room.canvas_height * scale)} scaleX={scale} scaleY={scale}
        onMouseDown={(event) => { if (event.target === event.target.getStage()) onSelect?.(null); }}
        onTouchStart={(event) => { if (event.target === event.target.getStage()) onSelect?.(null); }}>
        <Layer listening={false}>
          <Rect width={room.canvas_width} height={room.canvas_height} fill="#f8fafc" />
          {editable && <Shape sceneFunc={(context) => {
            for (const major of [false, true]) {
              context.beginPath();
              for (let x = 0; x <= room.canvas_width; x += GRID_SIZE) if ((x % 48 === 0) === major) { context.moveTo(x, 0); context.lineTo(x, room.canvas_height); }
              for (let y = 0; y <= room.canvas_height; y += GRID_SIZE) if ((y % 48 === 0) === major) { context.moveTo(0, y); context.lineTo(room.canvas_width, y); }
              context.strokeStyle = major ? "#d4deeb" : "#eaf0f6"; context.lineWidth = 1 / scale; context.stroke();
            }
          }} />}
        </Layer>
        <Layer ref={scene}>
          {renderItems.map((item) => {
            const selected = selectedSet.has(item.id);
            const seat = item.type === "seat";
            const palette = colors[item.seat?.display_state ?? "available"];
            return <Group key={item.id} id={item.id} x={item.x} y={item.y} rotation={item.rotation} draggable={editable}
              onClick={(event) => onSelect?.(item, event.evt.shiftKey)} onTap={() => onSelect?.(item)}
              onDragStart={(event) => beginDrag(event.target as Konva.Group, item)}
              onDragMove={(event) => moveDrag(event.target as Konva.Group, item)}
              onDragEnd={(event) => finishDrag(event.target as Konva.Group, item)}>
              <Rect width={item.width} height={item.height} fill={item.type === "wall" ? "#637181" : seat ? palette.fill : "#e4e9ef"}
                stroke={selected ? "#00448d" : seat ? palette.stroke : "#8997a8"} strokeWidth={selected ? 2.5 / scale : 1}
                dash={item.type === "aisle" || item.type === "window" ? [6, 4] : undefined}
                cornerRadius={item.type === "wall" ? 0 : 3} perfectDrawEnabled={false} shadowForStrokeEnabled={false} />
              {item.type !== "wall" && <Text width={item.width} height={item.height} padding={3} align="center" verticalAlign="middle"
                text={seat ? `${item.label}${item.seat?.occupant ? `\n${item.seat.occupant.name}` : ""}` : item.label}
                fill="#20344b" fontSize={seat ? 13 : 12} lineHeight={1.35} listening={false} perfectDrawEnabled={false} />}
            </Group>;
          })}
        </Layer>
        <Layer ref={dragLayer} />
      </Stage>
    </div>
  </div>;
}
export default memo(SeatCanvas);
