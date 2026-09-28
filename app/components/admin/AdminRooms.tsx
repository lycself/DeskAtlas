"use client";

import { Archive, ArrowRightLeft, Armchair, Copy, Grid3X3, List, Plus, Redo2, RefreshCw, RotateCw, Save, Search, Settings2, Trash2, Undo2, Upload, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import { api } from "@/app/lib/api";
import { getFloorLabel, groupRoomsByFloor, sortRooms } from "@/app/lib/rooms";
import type { AdminJump, LayoutItem, Major, Room, Student } from "@/app/lib/types";
import { snappedDelta, alignItems, moveItems, itemBounds, type Alignment } from "@/app/lib/seat-layout";
import { RoomPlan } from "../RoomPlan";
import { SeatStudentPanel } from "./SeatStudentPanel";
import { SeatMap } from "../SeatMap";
import { MajorTags } from "../MajorTags";
import { Notice } from "../Notice";
import { VirtualRoomPlan } from "../VirtualRoomPlan";

const fixtureDefaults: Record<string, { label: string; width: number; height: number }> = {
  door: { label: "门", width: 82, height: 22 },
  window: { label: "窗", width: 120, height: 18 },
  aisle: { label: "过道", width: 170, height: 70 },
  column: { label: "柱", width: 42, height: 42 },
  equipment: { label: "设备", width: 82, height: 52 },
  label: { label: "说明", width: 110, height: 34 },
};

type RoomForm = { name: string; building: string; floor: string; description: string; majors: string };
const emptyRoomForm: RoomForm = { name: "", building: "", floor: "", description: "", majors: "" };
const seatStateLabel: Record<string, string> = { available: "可申请", pending: "审核中", occupied: "已占用", unavailable: "不可使用" };

/** `#rooms/12` opens room 12 directly, so a room can be linked and survives a reload. */
function roomIdFromHash(): number | null {
  const match = window.location.hash.match(/^#rooms\/(\d+)$/);
  const id = match ? Number(match[1]) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

function LayoutNumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const formatted = String(Math.round(value * 100) / 100);
  const [draft, setDraft] = useState(formatted);
  useEffect(() => setDraft(formatted), [formatted]);
  const commit = () => {
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next) && next !== value) onChange(next);
    setDraft(formatted);
  };
  return <label><span>{label}</span><input aria-label={label} type="number" step={1} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} /></label>;
}

export function AdminRooms({ active = true, jump = null }: { active?: boolean; jump?: Extract<AdminJump, { section: "rooms" }> | null }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [majors, setMajors] = useState<Major[]>([]);
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadedRoom = useRef<Room | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [items, setItems] = useState<LayoutItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [past, setPast] = useState<LayoutItem[][]>([]);
  const [future, setFuture] = useState<LayoutItem[][]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const createMenu = useRef<HTMLDivElement>(null);
  const [newRoom, setNewRoom] = useState("");
  const [newFloor, setNewFloor] = useState("");
  const [gridRows, setGridRows] = useState(3);
  const [gridCols, setGridCols] = useState(6);
  const [gridStart, setGridStart] = useState(1);
  const [gridDirection, setGridDirection] = useState<"row" | "column">("row");
  const [mode, setMode] = useState<"manage" | "edit">("manage");
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [query, setQuery] = useState("");
  const [movingStudent, setMovingStudent] = useState<Student | null>(null);
  const [moveTarget, setMoveTarget] = useState<LayoutItem | null>(null);
  const [seatVersion, setSeatVersion] = useState(0);
  const panelDirty = useRef(false);
  const panelBusy = useRef(false);
  const workbench = useRef<HTMLElement>(null);
  const [roomView, setRoomView] = useState<"map" | "list">("map");
  const pendingSeat = useRef<{ roomId: number; seatId: string } | null>(null);
  const [reveal, setReveal] = useState(0);
  const [roomForm, setRoomForm] = useState<RoomForm>(emptyRoomForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const clearError = useCallback(() => setError(""), []);
  const clearMessage = useCallback(() => setMessage(""), []);

  const load = async (focus?: number) => {
    try {
      const rows = await api<Room[]>("/api/admin/rooms?summary_only=true");
      const ordered = sortRooms(rows);
      setRooms(ordered);
      setSelectedRoomId((current) => {
        const wanted = focus ?? current ?? roomIdFromHash();
        return wanted !== null && ordered.some((entry) => entry.id === wanted) ? wanted : ordered[0]?.id ?? null;
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "加载房间失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (active) void load(); }, [active]);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    api<{ majors: Array<Major & { is_active?: boolean }> }>("/api/admin/options", { signal: controller.signal })
      .then((options) => setMajors(options.majors.filter((major) => major.is_active !== false)))
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "加载教研组失败"); });
    return () => controller.abort();
  }, [active]);
  useEffect(() => {
    if (selectedRoomId === null || !active) return;
    const controller = new AbortController();
    setDetailLoading(true); setError("");
    api<Room>(`/api/admin/rooms/${selectedRoomId}/layout`, { signal: controller.signal }).then((next) => {
      if (loadedRoom.current?.id === next.id) {
        const previous = loadedRoom.current;
        const seats = new Map(next.items.map((item) => [item.id, item.seat]));
        setItems((current) => current === previous.items ? next.items : current.map((item) => ({ ...item, seat: seats.get(item.id) })));
        setRoom(next); loadedRoom.current = next; return;
      }
      loadedRoom.current = next;
      setRoom(next); setItems(next.items); setPast([]); setFuture([]); setSelectedId(null); setSelectedIds([]); setRoomView("map"); setMoveTarget(null); setQuery("");
      setRoomForm({ name: next.name, building: next.building ?? "", floor: next.floor ?? "", description: next.description ?? "", majors: (next.major_names ?? []).join("、") });
    }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "加载平面图失败"); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedRoomId, active]);
  useEffect(() => {
    if (!active || selectedRoomId === null) return;
    const next = `#rooms/${selectedRoomId}`;
    if (window.location.hash !== next) window.history.replaceState(null, "", next);
  }, [selectedRoomId, active]);
  useEffect(() => {
    if (!showCreate) return;
    const onPointer = (event: MouseEvent) => { if (!createMenu.current?.contains(event.target as Node)) setShowCreate(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setShowCreate(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [showCreate]);
  const dirty = !!room && items !== room.items;
  const metadataDirty = !!room && (roomForm.name !== room.name || roomForm.floor !== (room.floor ?? "") || roomForm.building !== (room.building ?? "") || roomForm.description !== (room.description ?? "") || roomForm.majors !== (room.major_names ?? []).join("、"));
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => { if (dirty || metadataDirty || panelDirty.current) event.preventDefault(); };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, metadataDirty]);
  const chooseRoom = (id: number) => {
    if (id === selectedRoomId) return true;
    if (busy || panelBusy.current) return false;
    if (panelDirty.current && !confirm("学生资料或工位备注尚未保存，放弃修改并切换房间？")) return false;
    panelDirty.current = false;
    if ((dirty || metadataDirty) && !confirm("当前房间有未保存的更改，确定放弃并切换房间？")) return false;
    setSelectedRoomId(id); setMessage("");
    return true;
  };
  const updateRoom = (updated: Room, resetLayout = false) => {
    loadedRoom.current = updated; setRoom(updated);
    setRooms((rows) => sortRooms(rows.map((entry) => entry.id === updated.id ? { ...updated, items: [] } : entry)));
    if (resetLayout) { setItems(updated.items); setPast([]); setFuture([]); }
  };
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const roomGroups = useMemo(() => groupRoomsByFloor(rooms), [rooms]);

  const applyItems = useCallback((next: LayoutItem[]) => {
    if (next.every((item, index) => item === items[index]) && next.length === items.length) return;
    setPast((history) => [...history.slice(-29), items]);
    setItems(next);
    setFuture([]);
  }, [items]);
  const undo = () => {
    const previous = past.at(-1); if (!previous) return;
    setFuture((history) => [items, ...history]); setItems(previous); setPast((history) => history.slice(0, -1));
  };
  const redo = () => {
    const next = future[0]; if (!next) return;
    setPast((history) => [...history, items]); setItems(next); setFuture((history) => history.slice(1));
  };
  const restoreSavedDraft = () => {
    if (!room || !dirty || !confirm("恢复到上次保存的草稿？本次未保存的修改会丢失。")) return;
    setItems(room.items); setPast([]); setFuture([]);
    setSelectedId(null); setSelectedIds([]); setShowGrid(false);
    setError(""); setMessage("已恢复到上次保存的草稿");
  };

  const createRoom = async (event: FormEvent) => {
    event.preventDefault(); if (!newRoom.trim() || busyRef.current || panelBusy.current) return;
    if (panelDirty.current && !confirm("学生资料尚未保存，放弃修改并创建房间？")) return;
    if ((dirty || metadataDirty) && !confirm("创建新房间将切换编辑器，确定放弃当前未保存的更改？")) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const created = await api<Room>("/api/admin/rooms", {
        method: "POST",
        body: JSON.stringify({ name: newRoom.trim(), floor: newFloor.trim() || null }),
      });
      setNewRoom("");
      setNewFloor("");
      setShowCreate(false);
      panelDirty.current = false;
      await load(created.id);
      setMessage(`房间 ${created.name} 已创建，切换到“编辑布局”添加工位。`);
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "创建房间失败"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const saveRoomDetails = async (event: FormEvent) => {
    event.preventDefault(); if (!room || !roomForm.name.trim() || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    const value = (text: string) => text.trim() || null;
    try {
      const updated = await api<Room>(`/api/admin/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ name: roomForm.name.trim(), building: value(roomForm.building), floor: value(roomForm.floor), description: value(roomForm.description), major_names: roomForm.majors.split(/[、,，;；]/).map((name) => name.trim()).filter(Boolean) }) });
      updateRoom({ ...updated, items: room.items });
      setRoomForm({ name: updated.name, building: updated.building ?? "", floor: updated.floor ?? "", description: updated.description ?? "", majors: (updated.major_names ?? []).join("、") }); setMessage("房间信息已更新");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "房间信息更新失败"); }
    finally { busyRef.current = false; setBusy(false); }
  };

  const nextSeatCode = useMemo(() => {
    const nums = items.filter((item) => item.type === "seat").map((item) => Number(item.label)).filter(Number.isFinite);
    return String((nums.length ? Math.max(...nums) : 0) + 1);
  }, [items]);

  const freePosition = (width: number, height: number) => {
    if (!room) return null;
    for (let y = 48; y + height <= room.canvas_height; y += 84) {
      for (let x = 48; x + width <= room.canvas_width; x += 108) {
        if (!items.some((item) => { const box = itemBounds(item); return item.type !== "label" && x < box.right && x + width > box.left && y < box.bottom && y + height > box.top; })) return { x, y };
      }
    }
    setError("当前画布没有足够的空白位置，请先整理布局。"); return null;
  };
  const addSeat = () => {
    const position = freePosition(72, 48); if (!position) return;
    applyItems([...items, { id: crypto.randomUUID(), type: "seat", label: nextSeatCode, ...position, width: 72, height: 48, rotation: 0 }]);
  };
  const addFixture = (type: keyof typeof fixtureDefaults) => {
    const value = fixtureDefaults[type];
    const position = freePosition(value.width, value.height); if (!position) return;
    applyItems([...items, { id: crypto.randomUUID(), type: type as LayoutItem["type"], label: value.label, ...position, width: value.width, height: value.height, rotation: 0 }]);
  };
  const addWall = (direction: "horizontal" | "vertical") => {
    const width = direction === "horizontal" ? 120 : 6;
    const height = direction === "horizontal" ? 6 : 120;
    const position = freePosition(width, height); if (!position) return;
    const wall: LayoutItem = { id: crypto.randomUUID(), type: "wall", label: "墙", ...position, width, height, rotation: 0 };
    applyItems([...items, wall]); selectItem(wall);
  };
  const generateGrid = () => {
    if (!room || !Number.isInteger(gridRows) || !Number.isInteger(gridCols) || !Number.isInteger(gridStart) || gridRows < 1 || gridRows > 20 || gridCols < 1 || gridCols > 20 || gridStart < 1) { setError("请输入有效的行列数（1–20）和起始编号。"); return; }
    if (48 + (gridCols - 1) * 108 + 72 > room.canvas_width || 48 + (gridRows - 1) * 84 + 48 > room.canvas_height) { setError("工位矩阵超出画布，请减少行数或列数。"); return; }
    const used = new Set(items.filter((item) => item.type === "seat").map((item) => item.label));
    if (Array.from({ length: gridRows * gridCols }, (_, index) => String(gridStart + index)).some((code) => used.has(code))) { setError("生成的编号与已有工位重复，请调整起始编号。"); return; }
    setError("");
    const origin = freePosition((gridCols - 1) * 108 + 72, (gridRows - 1) * 84 + 48);
    if (!origin) return;
    const created: LayoutItem[] = [];
    for (let row = 0; row < gridRows; row += 1) for (let col = 0; col < gridCols; col += 1) {
      const offset = gridDirection === "row" ? row * gridCols + col : col * gridRows + row;
      created.push({ id: crypto.randomUUID(), type: "seat", label: String(gridStart + offset), x: origin.x + col * 108, y: origin.y + row * 84, width: 72, height: 48, rotation: 0 });
    }
    applyItems([...items, ...created]); setSelectedIds(created.map((item) => item.id)); setSelectedId(created.at(-1)?.id ?? null); setShowGrid(false);
  };
  const modifySelected = (patch: Partial<LayoutItem>) => {
    if (!selected || !room) return;
    const next = { ...selected, ...patch }, bounds = itemBounds(next);
    if (next.width <= 0 || next.height <= 0 || bounds.left < -.01 || bounds.top < -.01 || bounds.right > room.canvas_width + .01 || bounds.bottom > room.canvas_height + .01) {
      setError("尺寸或位置超出画布，请调整后重试。"); return;
    }
    setError(""); applyItems(items.map((item) => item.id === selected.id ? next : item));
  };
  const selection = items.filter((item) => selectedIds.includes(item.id) || (!selectedIds.length && item.id === selectedId));
  const rotateSelected = () => {
    if (!room || !selection.length) return;
    const ids = selection.map((item) => item.id);
    const rotated = items.map((item) => ids.includes(item.id) ? { ...item, rotation: (item.rotation + 90) % 360 } : item);
    applyItems(moveItems(rotated, ids, 0, 0, room.canvas_width, room.canvas_height));
  };
  const arrange = (alignment: Alignment) => {
    try { setError(""); applyItems(alignItems(items, selection.map((item) => item.id), alignment)); }
    catch (e) { setError(e instanceof Error ? e.message : "无法对齐所选元素"); }
  };
  const duplicateSelected = () => {
    if (!selection.length || !room) return;
    const anchor = selection[0];
    const delta = snappedDelta(anchor, selection, anchor.x + 24, anchor.y + 24, room.canvas_width, room.canvas_height);
    if (!delta.x && !delta.y) { setError("画布边缘没有空间放置副本，请先移动所选元素。"); return; }
    let code = Number(nextSeatCode);
    const copies = selection.map((item) => ({ ...item, id: crypto.randomUUID(), label: item.type === "seat" ? String(code++) : item.label, x: item.x + delta.x, y: item.y + delta.y, seat: undefined }));
    applyItems([...items, ...copies]); setSelectedIds(copies.map((item) => item.id)); setSelectedId(copies.at(-1)?.id ?? null);
  };
  const deleteSelected = () => { if (!selection.length) return;
    if (selection.some((item) => item.seat?.occupant || item.seat?.display_state === "pending")) { setError("所选工位仍有学生或申请，请先在“工位管理”中移动学生或处理申请。"); return; } const ids = new Set(selection.map((item) => item.id)); applyItems(items.filter((item) => !ids.has(item.id))); setSelectedId(null); setSelectedIds([]); };
  const selectItem = useCallback((item: LayoutItem | null, additive = false) => {
    if (!item) { setSelectedId(null); setSelectedIds([]); return; }
    if (additive) {
      const next = selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id];
      setSelectedIds(next); setSelectedId(next.at(-1) ?? null);
    } else {
      setSelectedId(item.id); setSelectedIds([item.id]);
    }
  }, [selectedIds]);

  const persistLayout = async () => {
    if (!room) return null;
    const updated = await api<Room>(`/api/admin/rooms/${room.id}/layout`, {
      method: "PUT", body: JSON.stringify({ items: items.map(({ id, type, label, x, y, width, height, rotation }) => ({ id, type, label, x, y, width, height, rotation })) }),
    });
    updateRoom(updated, true);
    return updated;
  };
  const save = async () => {
    if (!room || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try { await persistLayout(); setMessage("草稿已保存。学生端仍显示已发布的布局，发布后才会更新。"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const discardDraftAndExit = async () => {
    if (!room || busyRef.current || !confirm(`放弃草稿并退出编辑？服务器上已保存但未发布的布局修改也会被丢弃，学生端保持当前已发布的布局。${metadataDirty ? "未保存的房间信息也会丢失。" : ""}`)) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const updated = await api<Room>(`/api/admin/rooms/${room.id}/layout/discard`, { method: "POST" });
      updateRoom(updated, true);
      setSelectedId(null); setSelectedIds([]); setShowGrid(false); setMode("manage");
      setRoomForm({ name: updated.name, building: updated.building ?? "", floor: updated.floor ?? "", description: updated.description ?? "", majors: (updated.major_names ?? []).join("、") });
      setShowRoomSettings(false);
      setMessage("已放弃草稿，返回工位管理");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "放弃草稿失败"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const publish = async () => {
    if (!room || busyRef.current) return;
    if (metadataDirty) { setError("请先保存房间信息，再发布平面图。"); return; }
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (dirty) await persistLayout();
      const updated = await api<Room>(`/api/admin/rooms/${room.id}/publish`, { method: "POST" });
      updateRoom(updated, true); setMessage("最新平面图已发布，学生端已更新");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "发布失败"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const refreshSeatData = async () => {
    if (!room) return;
    try {
      const updated = await api<Room>(`/api/admin/rooms/${room.id}/layout`);
      updateRoom(updated, true); setSeatVersion((value) => value + 1);
      await load(room.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "刷新房间失败"); }
  };
  const refresh = () => {
    if (busy || panelBusy.current) return;
    setMessage("");
    // Reloading the layout would drop unsaved edits, so only refresh the list in that case.
    if (room && !dirty && !metadataDirty && !panelDirty.current) void refreshSeatData();
    else void load();
  };
  const selectManaged = (item: LayoutItem) => {
    if (panelBusy.current) return;
    if (movingStudent) {
      if (item.seat?.display_state !== "available") { setError("请选择绿色的空闲工位作为目标。"); return; }
      setMoveTarget(item); setError(""); return;
    }
    if (panelDirty.current && !confirm("当前资料尚未保存，放弃修改并查看其他工位？")) return;
    panelDirty.current = false; selectItem(item); setError("");
  };
  const changeMode = (next: "manage" | "edit") => {
    if (panelBusy.current || busy) return false;
    if (next === mode) return true;
    if (dirty || metadataDirty) { setError("请先保存布局与房间信息，再切换工作模式。"); return false; }
    if (panelDirty.current && !confirm("资料尚未保存，放弃修改并切换模式？")) return false;
    panelDirty.current = false; setMode(next); setMovingStudent(null); setMoveTarget(null); setSelectedId(null); setSelectedIds([]); setError("");
    return true;
  };
  // A search result opens its room; a seat is selected once that room's layout has loaded.
  const openJump = useEffectEvent((target: NonNullable<typeof jump>) => {
    pendingSeat.current = null;
    if (!chooseRoom(target.roomId)) return;
    setQuery("");
    if (target.seatId) pendingSeat.current = { roomId: target.roomId, seatId: target.seatId };
  });
  useEffect(() => { if (jump) openJump(jump); }, [jump]);
  const selectPendingSeat = useEffectEvent(() => {
    const target = pendingSeat.current;
    if (!target || room?.id !== target.roomId || detailLoading) return;
    pendingSeat.current = null;
    const item = items.find((entry) => entry.id === target.seatId);
    if (!item) { setError("该工位不在当前布局中，请刷新后重试。"); return; }
    if (!changeMode("manage")) return;
    selectManaged(item); setReveal((value) => value + 1);
  });
  useEffect(() => { selectPendingSeat(); }, [jump, room, items, detailLoading]);
  useEffect(() => {
    if (!reveal) return;
    // Centred so the match clears the sticky header; virtual groups can list hundreds of people.
    workbench.current?.querySelector(".managed-map .selected-seat, .managed-map .virtual-position.selected, .managed-seat-list tr.selected")?.scrollIntoView({ block: "center" });
  }, [reveal]);
  const archiveRoom = async () => {
    if (!room || busy || panelBusy.current || !confirm(`归档房间“${room.name}”？归档后房间不再显示在列表和学生端。${dirty || metadataDirty || panelDirty.current ? "未保存的修改将被放弃。" : ""}`)) return;
    try { await api(`/api/admin/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ is_archived: true }) }); setShowRoomSettings(false); await load(); setMessage(`房间 ${room.name} 已归档`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "归档失败"); }
  };

  const roomStatus = !room ? "" : room.is_virtual ? "虚拟工位分组" : room.is_published ? "已发布" : "未发布";
  const draftNote = !room || room.is_virtual ? "" : dirty ? "有未保存修改" : room.has_draft ? "有未发布草稿" : "";

  return (
    <div className="admin-page rooms-page">
      <header className="page-heading"><div><h1>房间与工位</h1><p className="page-subtitle">在图上管理学生和座位，按需编辑房间布局。</p></div>
        <div className="heading-actions">
          <button className="secondary-action" disabled={busy || loading} onClick={refresh}><RefreshCw size={16} />刷新</button>
          <div className="room-create-menu" ref={createMenu}>
            <button className="primary-action compact" aria-expanded={showCreate} aria-haspopup="dialog" onClick={() => setShowCreate((value) => !value)}><Plus size={16} />新建房间</button>
            {showCreate && <form className="room-create-form" role="dialog" aria-label="新建房间" onSubmit={createRoom}>
              <label><span>楼层</span><input aria-label="新房间楼层" placeholder="例如 3层" value={newFloor} onChange={(e) => setNewFloor(e.target.value)} /></label>
              <label><span>房间号或名称</span><input aria-label="新房间名称" placeholder="例如 301" required autoFocus value={newRoom} onChange={(e) => setNewRoom(e.target.value)} /></label>
              <div className="form-actions"><button className="primary-action compact" disabled={busy}>创建房间</button><button type="button" className="secondary-action compact" onClick={() => setShowCreate(false)}>取消</button></div>
            </form>}
          </div>
        </div>
      </header>
      <Notice error={error} message={message} onClearError={clearError} onClearMessage={clearMessage} />
      {loading ? <div className="central-message"><RefreshCw className="spin" />正在加载房间…</div> : !rooms.length ? <div className="empty-state admin-empty"><h2>还没有房间</h2><p>点击“新建房间”，创建第一张工位图。</p></div> : <div className="room-editor-layout">
        <aside className="room-index"><header><h2>房间</h2><span>{rooms.length}</span></header>
          <div className="editor-floor-tabs" role="group" aria-label="选择楼层">{roomGroups.map((group) => <button key={group.floor} aria-pressed={group.floor === getFloorLabel(rooms.find((entry) => entry.id === selectedRoomId) ?? group.rooms[0])} onClick={() => chooseRoom(group.rooms[0].id)}>{group.floor === "虚拟工位" ? "虚拟分组" : group.floor}</button>)}</div>
          <div className="editor-room-list">{(roomGroups.find((group) => group.rooms.some((entry) => entry.id === selectedRoomId))?.rooms ?? []).map((entry) => <button key={entry.id} className={selectedRoomId === entry.id ? "active" : ""} aria-pressed={selectedRoomId === entry.id} aria-label={`打开 ${entry.name} 房间`} onClick={() => chooseRoom(entry.id)}>
            <strong>{entry.name}</strong>
            {!entry.is_virtual && <span className="room-tab-majors"><MajorTags names={entry.major_names} compact /></span>}
            <small>{entry.is_virtual ? `${entry.seat_counts.occupied ?? 0} 人` : `${entry.seat_counts.available ?? 0} 空闲 / ${Object.values(entry.seat_counts).reduce((sum, count) => sum + count, 0)} 工位`}</small>
            {entry.has_draft && <em className="draft-flag" title="有已保存但未发布的布局草稿">未发布草稿</em>}
          </button>)}</div>
        </aside>
        {!room ? (detailLoading && <div className="central-message"><RefreshCw className="spin" />正在加载房间…</div>) : <section ref={workbench} className={`room-workbench ${mode === "edit" && !room.is_virtual ? "editing-layout" : "managing-seats"} ${detailLoading ? "is-loading" : ""}`} aria-busy={busy || detailLoading} onKeyDown={(event) => {
          if (mode !== "edit" || busy || (event.target as HTMLElement).closest("input, textarea, select, button")) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
          else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && selection.length) {
            event.preventDefault(); const step = event.shiftKey ? 12 : 1;
            applyItems(moveItems(items, selection.map((item) => item.id), event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0, event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0, room.canvas_width, room.canvas_height));
          } else if (event.key === "Escape") { setSelectedId(null); setSelectedIds([]); }
        }}>
          <div className="room-workbench-header">
            <div className="room-identity">
              <strong>{room.name}</strong>
              {!room.is_virtual && <div className="room-center-affiliation"><span>教研中心：</span><MajorTags names={room.major_names} /></div>}
              <span className="room-status">{roomStatus}</span>
              {draftNote && <span className="draft-flag">{draftNote}</span>}
            </div>
            {!room.is_virtual && <div className="section-tabs workbench-modes" role="group" aria-label="工作模式"><button aria-pressed={mode === "manage"} onClick={() => changeMode("manage")}>工位管理</button><button aria-pressed={mode === "edit"} onClick={() => changeMode("edit")}>编辑布局</button></div>}
            {!room.is_virtual && <button className="secondary-action compact" aria-expanded={showRoomSettings} onClick={() => setShowRoomSettings(!showRoomSettings)}><Settings2 size={16} />房间设置</button>}
          </div>
          {showRoomSettings && !room.is_virtual && <form className="room-settings-form" onSubmit={saveRoomDetails}>
            <div className="field-grid three"><label><span>房间名称</span><input required value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} /></label><label><span>楼层</span><input value={roomForm.floor} onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })} /></label><label><span>楼栋</span><input value={roomForm.building} onChange={(e) => setRoomForm({ ...roomForm, building: e.target.value })} /></label></div>
            <label><span>所属教研中心（多个用顿号分隔）</span><input value={roomForm.majors} onChange={(e) => setRoomForm({ ...roomForm, majors: e.target.value })} /></label>
            <label><span>房间说明</span><input value={roomForm.description} onChange={(e) => setRoomForm({ ...roomForm, description: e.target.value })} /></label>
            <div className="form-actions"><button className="primary-action compact" disabled={busy || !metadataDirty}>保存房间信息</button><button type="button" className="secondary-action compact" onClick={() => setShowRoomSettings(false)}>收起</button></div>
            <div className="danger-zone">
              <div><strong>归档房间</strong><p>归档后房间不再显示在列表和学生端，学生与工位记录会保留。</p></div>
              <button type="button" className="danger-action compact" disabled={busy} onClick={archiveRoom}><Archive size={15} />归档房间</button>
            </div>
          </form>}
          {mode === "edit" && !room.is_virtual ? <fieldset disabled={busy}>
            <div className="layout-toolbar">
              <div className="tool-group"><button onClick={addSeat}><Armchair />添加工位</button><button aria-expanded={showGrid} onClick={() => setShowGrid(!showGrid)}><Grid3X3 />批量添加</button><button onClick={() => addWall("horizontal")}><Plus />横墙</button><button onClick={() => addWall("vertical")}><Plus />竖墙</button><select aria-label="添加房间设施" value="" onChange={(e) => { if (e.target.value) addFixture(e.target.value); }}><option value="">添加设施…</option>{Object.entries(fixtureDefaults).map(([type, value]) => <option key={type} value={type}>{value.label}</option>)}</select></div>
              <div className="tool-group"><button aria-label="撤销布局修改" title="撤销（Ctrl / ⌘ Z）" onClick={undo} disabled={!past.length}><Undo2 />撤销</button><button aria-label="重做布局修改" title="重做（Ctrl / ⌘ Shift Z）" onClick={redo} disabled={!future.length}><Redo2 />重做</button><button title="丢弃本次未保存的修改，恢复到上次保存的草稿" disabled={!dirty} onClick={restoreSavedDraft}><RotateCw />恢复到上次保存</button><button className="danger-plain" title="放弃所有未发布的布局修改并退出编辑" onClick={discardDraftAndExit}><X />放弃草稿并退出</button></div>
              <div className="tool-group tool-group-commit"><button disabled={!dirty} onClick={save}><Save />保存草稿</button><button className="primary-action compact" onClick={publish}><Upload />发布布局</button></div>
            </div>
            {showGrid && <div className="grid-generator"><label>行<input aria-label="矩阵行数" type="number" min={1} max={20} value={gridRows} onChange={(e) => setGridRows(Number(e.target.value))} /></label><label>列<input aria-label="矩阵列数" type="number" min={1} max={20} value={gridCols} onChange={(e) => setGridCols(Number(e.target.value))} /></label><label>起始编号<input aria-label="矩阵起始编号" type="number" min={1} value={gridStart} onChange={(e) => setGridStart(Number(e.target.value))} /></label><label>编号方向<select value={gridDirection} onChange={(e) => setGridDirection(e.target.value as "row" | "column")}><option value="row">先行后列</option><option value="column">先列后行</option></select></label><button onClick={generateGrid}>添加到空白位置</button></div>}
            <div className="layout-alignment-toolbar" role="group" aria-label="对齐与分布"><span>{selection.length ? `已选 ${selection.length} 项` : "框选或 Shift 点击多选"}</span>{([["left", "左对齐"], ["cx", "水平居中"], ["right", "右对齐"], ["top", "顶对齐"], ["cy", "垂直居中"], ["bottom", "底对齐"], ["horizontal", "水平等距"], ["vertical", "垂直等距"]] as [Alignment, string][]).map(([value, label]) => <button key={value} disabled={selection.length < (value === "horizontal" || value === "vertical" ? 3 : 2)} onClick={() => arrange(value)}>{label}</button>)}</div>
            <div className="layout-edit-body"><SeatMap key={room.id} room={room} items={items} editable={!busy} selectedId={selectedId} selectedIds={selectedIds} onSelect={selectItem} onSelectMany={(ids) => { setSelectedIds(ids); setSelectedId(ids.at(-1) ?? null); }} onItemsChange={applyItems} />
              <aside className="layout-properties"><h3>{selected ? `${selection.length > 1 ? `已选 ${selection.length} 项 · ` : ""}${selected.type === "seat" ? "工位 " : ""}${selected.label}` : "布局属性"}</h3>{selected ? <>
                <label><span>{selected.type === "seat" ? "工位编号" : "名称"}</span><input value={selected.label} onChange={(e) => modifySelected({ label: e.target.value })} /></label>
                <div className="field-grid two">{([['x', 'X 坐标'], ['y', 'Y 坐标'], ['width', '宽度'], ['height', '高度']] as const).map(([key, label]) => <LayoutNumberField key={`${selected.id}-${key}`} label={label} value={selected[key]} onChange={(value) => modifySelected({ [key]: value })} />)}</div>
                <div className="panel-actions"><button onClick={rotateSelected}><RotateCw />旋转 90°</button><button onClick={duplicateSelected}><Copy />复制</button><button className="danger-plain" onClick={deleteSelected}><Trash2 />移除</button></div>
                {selected.seat?.occupant && <p className="form-hint">使用人：{selected.seat.occupant.name}。人员调整请切换“工位管理”。</p>}
              </> : <p>选择工位、墙体或设施后可调整尺寸和坐标；拖动空白区域可框选多个元素。</p>}<p className="keyboard-hint">方向键微调 1 px<br />Shift + 方向键移动 12 px<br />墙体可选中、拖动和调整尺寸</p></aside>
            </div>
          </fieldset> : <>
            {movingStudent && <div className="move-instruction" role="status"><ArrowRightLeft size={16} /><span>正在为 <strong>{movingStudent.name}</strong> 选择新工位。可切换房间，再点击绿色空位。</span><button aria-label="取消移动" onClick={() => { setMovingStudent(null); setMoveTarget(null); }}><X /></button></div>}
            <div className="manage-toolbar"><label className="search-field"><Search size={16} /><input aria-label="搜索房间中的学生或工位" placeholder={room.is_virtual ? "姓名、导师或虚拟位置编号" : "姓名、导师或工位编号"} value={query} onChange={(e) => setQuery(e.target.value)} /></label><div className="segmented-control"><button aria-pressed={roomView === "map"} onClick={() => setRoomView("map")}><Grid3X3 />{room.is_virtual ? "位置图" : "平面图"}</button><button aria-pressed={roomView === "list"} onClick={() => setRoomView("list")}><List />列表</button></div></div>
            <div className="room-manage-body"><div className="managed-map"><div className="manage-legend">{room.is_virtual ? <span>按教研组排列 · {items.filter((item) => item.type === "seat").length} 人 · 虚拟位置不可申请</span> : Object.entries(seatStateLabel).map(([state, label]) => <span key={state}><i className={`state-dot ${state}`} />{label} {room.seat_counts[state as keyof Room["seat_counts"]] ?? 0}</span>)}</div>
              {roomView === "map" ? room.is_virtual ? <VirtualRoomPlan room={{ ...room, items }} majors={majors} query={query} onSelect={selectManaged} selectedId={selectedId} context="admin" /> : <RoomPlan key={room.id} room={{ ...room, items }} query={query} onSelect={selectManaged} selectedId={moveTarget?.id ?? selectedId} choosingTarget={!!movingStudent} /> : <div className="seat-table-wrap"><table className="data-table managed-seat-list"><thead><tr><th>{room.is_virtual ? "虚拟位置" : "工位"}</th><th>使用人</th><th>状态</th><th /></tr></thead><tbody>{items.filter((item) => item.type === "seat" && `${item.label} ${item.seat?.occupant?.name ?? ''} ${item.seat?.occupant?.adviser ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())).map((item) => <tr key={item.id} className={selectedId === item.id ? "selected" : ""}><td>{item.label}</td><td>{item.seat?.occupant?.name ?? "—"}</td><td>{room.is_virtual ? room.name : seatStateLabel[item.seat?.display_state ?? "available"]}</td><td><button className="row-action" onClick={() => selectManaged(item)}>管理</button></td></tr>)}</tbody></table></div>}
            </div><SeatStudentPanel key={`${room.id}-${selected?.id ?? "none"}`} item={selected} roomName={room.name} virtual={room.is_virtual} version={seatVersion} moving={movingStudent} target={moveTarget} onMove={(student) => {
              if (!student && moveTarget) { setSelectedId(moveTarget.id); setSelectedIds([moveTarget.id]); }
              setMovingStudent(student); setMoveTarget(null);
              if (student && window.matchMedia("(max-width: 1050px)").matches) workbench.current?.querySelector(".managed-map")?.scrollIntoView({ block: "start" });
            }} onUpdated={refreshSeatData} onDirty={(value) => { panelDirty.current = value; }} onBusy={(value) => { panelBusy.current = value; }} /></div>
          </>}
        </section>}
      </div>}
    </div>
  );
}
