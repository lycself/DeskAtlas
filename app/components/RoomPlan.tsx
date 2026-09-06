"use client";

import { Maximize2, Minus, Plus } from "lucide-react";
import { useState } from "react";
import type { LayoutItem, Room, SeatState } from "@/app/lib/types";

const statusLabel: Record<SeatState, string> = {
  available: "可申请", occupied: "已占用", pending: "审核中", unavailable: "暂不可用",
};

function bounds(items: LayoutItem[]) {
  if (!items.length) return { x: 0, y: 0, width: 480, height: 320 };
  const corners = items.flatMap((item) => {
    const angle = item.rotation * Math.PI / 180;
    return [[0, 0], [item.width, 0], [0, item.height], [item.width, item.height]].map(([x, y]) => ({
      x: item.x + x * Math.cos(angle) - y * Math.sin(angle),
      y: item.y + x * Math.sin(angle) + y * Math.cos(angle),
    }));
  });
  const x = Math.min(...corners.map((p) => p.x)) - 34;
  const y = Math.min(...corners.map((p) => p.y)) - 34;
  return { x, y, width: Math.max(...corners.map((p) => p.x)) - x + 34,
    height: Math.max(...corners.map((p) => p.y)) - y + 34 };
}

export function RoomPlan({ room, query, onSelect }: {
  room: Room; query: string; onSelect: (item: LayoutItem) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(false);
  const [showNames, setShowNames] = useState(true);
  const reviewLabel = room.items.find((item) => item.type === "label" && item.label.includes("位置待核对"));
  const unplaced = reviewLabel ? room.items.filter((item) =>
    (item.type === "seat" || item.type === "equipment") && item.y >= reviewLabel.y) : [];
  const unplacedIds = new Set(unplaced.map((item) => item.id));
  const mapped = room.items.filter((item) => !unplacedIds.has(item.id) && item.id !== reviewLabel?.id);
  const frame = bounds(mapped);
  const normalized = query.trim().toLowerCase();
  const matches = (item: LayoutItem) => !normalized ||
    `${item.label} ${item.seat?.occupant?.name ?? ""} ${item.seat?.occupant?.adviser ?? ""} ${item.seat?.occupant?.major ?? ""}`.toLowerCase().includes(normalized);
  const resultCount = room.items.filter((item) => item.type === "seat" && matches(item)).length;
  const hasWalls = mapped.some((item) => item.type === "wall");

  return <div className="room-plan">
    <div className="plan-controls">
      <div className="plan-caption"><span className="plan-indicator" />{hasWalls ? "房间平面图" : "工位示意图"}
        <small>{normalized ? `${resultCount} 个匹配工位` : "点击工位查看详情"}</small></div>
      <div className="plan-actions">
        <button className="name-toggle" aria-pressed={showNames} onClick={() => setShowNames(!showNames)}>{showNames ? "姓名 + 编号" : "仅编号"}</button>
        {mapped.length > 0 && <div className="zoom-control">
          <button onClick={() => { setFit(false); setZoom(Math.max(.5, zoom - .25)); }} disabled={!fit && zoom === .5} aria-label="缩小平面图"><Minus size={14} /></button>
          <span>{fit ? "适应" : `${Math.round(zoom * 100)}%`}</span>
          <button onClick={() => { setFit(false); setZoom(Math.min(2.5, zoom + .25)); }} disabled={!fit && zoom === 2.5} aria-label="放大平面图"><Plus size={14} /></button>
          <button onClick={() => { setZoom(1); setFit(true); }} aria-label="适应窗口" title="适应窗口"><Maximize2 size={14} /></button>
        </div>}
      </div>
    </div>
    {mapped.length > 0 && <div className="plan-viewport">
      <svg className="plan-svg" role="group" aria-label={`${room.name} 房间平面图`}
        viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`}
        style={{ width: fit ? "100%" : `max(100%, ${frame.width * .9 * zoom}px)`,
          height: fit ? "var(--plan-height)" : `max(var(--plan-height), ${frame.height * .9 * zoom}px)` }}>
        <title>{room.name} 房间工位分布，点击或按 Tab 选择工位</title>
        {mapped.filter((item) => item.type === "wall").map((item) =>
          <rect key={item.id} className="plan-wall" x={item.x} y={item.y} width={item.width} height={item.height}
            transform={`rotate(${item.rotation} ${item.x} ${item.y})`} />)}
        {mapped.filter((item) => item.type !== "wall").map((item) => {
          const state = item.seat?.display_state ?? "unavailable";
          const occupant = item.seat?.occupant;
          const seat = item.type === "seat";
          return <g key={item.id} transform={`translate(${item.x} ${item.y}) rotate(${item.rotation})`}
            className={`${seat ? `plan-seat ${state}` : `plan-fixture ${item.type}`} ${seat && !matches(item) ? "dimmed" : ""}`}
            role={seat ? "button" : undefined} tabIndex={seat ? 0 : undefined}
            aria-label={seat ? `工位 ${item.label}，${occupant?.name ?? statusLabel[state]}` : item.label}
            onClick={seat ? () => onSelect(item) : undefined}
            onKeyDown={seat ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(item); } } : undefined}>
            <title>{seat ? `${item.label} 号 · ${occupant?.name ?? statusLabel[state]}${occupant?.adviser ? ` · 导师 ${occupant.adviser}` : ""}` : item.label}</title>
            {item.type === "door" ? <>
              <path className="door-swing" d={`M 6 ${item.height - 4} L 6 4 M 6 4 Q ${item.width - 8} 4 ${item.width - 8} ${item.height - 4}`} />
              <text x={item.width / 2} y={item.height + 13} textAnchor="middle">入口</text>
            </> : item.type === "label" ? <text x={0} y={18}>{item.label}</text> : <>
              <rect className="desk-shape" width={item.width} height={item.height} rx={seat ? 3 : 2} />
              {seat && <rect className="desk-status" x={0} y={0} width={3} height={item.height} rx={1.5} />}
              <text className="desk-number" x={item.width / 2} y={seat && showNames ? 19 : item.height / 2 + 5} textAnchor="middle">{item.label}</text>
              {seat && showNames && <text className="desk-name" x={item.width / 2} y={37} textAnchor="middle">{occupant?.name ?? statusLabel[state]}</text>}
            </>}
          </g>;
        })}
      </svg>
    </div>}
    {unplaced.length > 0 && <section className="unplaced-seats" aria-label="位置待核对工位">
      <header><strong>位置待核对</strong><span>{unplaced.length} 处 · 原表未提供唯一位置，暂列于此</span></header>
      <div>{unplaced.map((item) => item.type === "seat" ? <button key={item.id}
        className={`unplaced-seat ${item.seat?.display_state ?? "unavailable"} ${!matches(item) ? "dimmed" : ""}`}
        onClick={() => onSelect(item)}><b>{item.label}</b><span>{item.seat?.occupant?.name ?? statusLabel[item.seat?.display_state ?? "unavailable"]}</span></button>
        : <span className="unplaced-equipment" key={item.id}>{item.label}</span>)}</div>
    </section>}
    <footer className="plan-footer"><span>座位位置以房间内实际标识为准</span><span>{hasWalls ? "实测布局 · 非比例图" : "示意布局 · 位置待核对"}</span></footer>
  </div>;
}
