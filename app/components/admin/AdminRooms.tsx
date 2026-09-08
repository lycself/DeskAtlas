"use client";

import {
  Archive,
  Armchair,
  BoxSelect,
  CircleAlert,
  Copy,
  Columns3,
  DoorOpen,
  Eye,
  EyeOff,
  Grid3X3,
  List,
  Plus,
  PanelTop,
  Printer,
  Redo2,
  RotateCw,
  Save,
  Trash2,
  Type,
  Undo2,
  Upload,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/app/lib/api";
import { getFloorLabel, groupRoomsByFloor, sortRooms } from "@/app/lib/rooms";
import type { LayoutItem, Room } from "@/app/lib/types";
import { snappedDelta } from "@/app/lib/seat-layout";
import { StudentProfile } from "../StudentProfile";
import { SeatMap } from "../SeatMap";
import { MajorTags } from "../MajorTags";

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

export function AdminRooms({ active = true }: { active?: boolean }) {
  const [rooms, setRooms] = useState<Room[]>([]);
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
  const [newRoom, setNewRoom] = useState("");
  const [newFloor, setNewFloor] = useState("");
  const [gridRows, setGridRows] = useState(3);
  const [gridCols, setGridCols] = useState(6);
  const [gridStart, setGridStart] = useState(1);
  const [gridDirection, setGridDirection] = useState<"row" | "column">("row");
  const [preview, setPreview] = useState(false);
  const [roomView, setRoomView] = useState<"map" | "list">("map");
  const [roomForm, setRoomForm] = useState<RoomForm>(emptyRoomForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [seatNote, setSeatNote] = useState("");

  const load = async (focus?: number) => {
    try {
      const rows = await api<Room[]>("/api/admin/rooms?summary_only=true");
      const ordered = sortRooms(rows);
      setRooms(ordered);
      setSelectedRoomId((current) => focus ?? (ordered.some((room) => room.id === current) ? current : ordered[0]?.id ?? null));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "加载房间失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (active) void load(); }, [active]);
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
      setRoom(next); setItems(next.items); setPast([]); setFuture([]); setSelectedId(null); setSelectedIds([]); setPreview(false); setRoomView("map");
      setRoomForm({ name: next.name, building: next.building ?? "", floor: next.floor ?? "", description: next.description ?? "", majors: (next.major_names ?? []).join("、") });
    }).catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "加载平面图失败"); })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [selectedRoomId, active]);
  const dirty = !!room && items !== room.items;
  const metadataDirty = !!room && (roomForm.name !== room.name || roomForm.floor !== (room.floor ?? "") || roomForm.building !== (room.building ?? "") || roomForm.description !== (room.description ?? "") || roomForm.majors !== (room.major_names ?? []).join("、"));
  useEffect(() => {
    if (!dirty && !metadataDirty) return;
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty, metadataDirty]);
  const chooseRoom = (id: number) => {
    if (id === selectedRoomId || busy) return;
    if ((dirty || metadataDirty) && !confirm("当前房间有未保存的更改，确定放弃并切换房间？")) return;
    setSelectedRoomId(id); setMessage("");
  };
  const updateRoom = (updated: Room, resetLayout = false) => {
    loadedRoom.current = updated; setRoom(updated);
    setRooms((rows) => sortRooms(rows.map((entry) => entry.id === updated.id ? { ...updated, items: [] } : entry)));
    if (resetLayout) { setItems(updated.items); setPast([]); setFuture([]); }
  };
  const selected = items.find((item) => item.id === selectedId) ?? null;
  useEffect(() => { setSeatNote(selected?.seat?.note ?? ""); }, [selected?.id, selected?.seat?.note]);
  const roomGroups = useMemo(() => groupRoomsByFloor(rooms), [rooms]);

  const applyItems = useCallback((next: LayoutItem[]) => {
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

  const createRoom = async (event: FormEvent) => {
    event.preventDefault(); if (!newRoom.trim() || busyRef.current) return;
    if ((dirty || metadataDirty) && !confirm("创建新房间将切换编辑器，确定放弃当前未保存的更改？")) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const created = await api<Room>("/api/admin/rooms", {
        method: "POST",
        body: JSON.stringify({ name: newRoom.trim(), floor: newFloor.trim() || null }),
      });
      setNewRoom("");
      setNewFloor("");
      await load(created.id);
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
        if (!items.some((item) => item.type !== "label" && x < item.x + item.width && x + width > item.x && y < item.y + item.height && y + height > item.y)) return { x, y };
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
  const generateGrid = () => {
    if (!room || !Number.isInteger(gridRows) || !Number.isInteger(gridCols) || !Number.isInteger(gridStart) || gridRows < 1 || gridRows > 20 || gridCols < 1 || gridCols > 20 || gridStart < 1) { setError("请输入有效的行列数（1–20）和起始编号。"); return; }
    if (48 + (gridCols - 1) * 108 + 72 > room.canvas_width || 48 + (gridRows - 1) * 84 + 48 > room.canvas_height) { setError("工位矩阵超出画布，请减少行数或列数。"); return; }
    const used = new Set(items.filter((item) => item.type === "seat").map((item) => item.label));
    if (Array.from({ length: gridRows * gridCols }, (_, index) => String(gridStart + index)).some((code) => used.has(code))) { setError("生成的编号与已有工位重复，请调整起始编号。"); return; }
    setError("");
    const created: LayoutItem[] = [];
    for (let row = 0; row < gridRows; row += 1) for (let col = 0; col < gridCols; col += 1) {
      const offset = gridDirection === "row" ? row * gridCols + col : col * gridRows + row;
      created.push({ id: crypto.randomUUID(), type: "seat", label: String(gridStart + offset), x: 48 + col * 108, y: 48 + row * 84, width: 72, height: 48, rotation: 0 });
    }
    applyItems([...items, ...created]);
  };
  const modifySelected = (patch: Partial<LayoutItem>) => selected && applyItems(items.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  const selection = items.filter((item) => selectedIds.includes(item.id) || (!selectedIds.length && item.id === selectedId));
  const rotateSelected = () => selection.length && applyItems(items.map((item) => selection.some((target) => target.id === item.id) ? { ...item, rotation: (item.rotation + 90) % 360 } : item));
  const duplicateSelected = () => {
    if (!selection.length || !room) return;
    const anchor = selection[0];
    const delta = snappedDelta(anchor, selection, anchor.x + 24, anchor.y + 24, room.canvas_width, room.canvas_height);
    if (!delta.x && !delta.y) { setError("画布边缘没有空间放置副本，请先移动所选元素。"); return; }
    let code = Number(nextSeatCode);
    const copies = selection.map((item) => ({ ...item, id: crypto.randomUUID(), label: item.type === "seat" ? String(code++) : item.label, x: item.x + delta.x, y: item.y + delta.y, seat: undefined }));
    applyItems([...items, ...copies]); setSelectedIds(copies.map((item) => item.id)); setSelectedId(copies.at(-1)?.id ?? null);
  };
  const deleteSelected = () => { if (!selection.length) return; const ids = new Set(selection.map((item) => item.id)); applyItems(items.filter((item) => !ids.has(item.id))); setSelectedId(null); setSelectedIds([]); };
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
    try { await persistLayout(); setMessage("草稿已保存"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const publish = async () => {
    if (!room || busyRef.current) return;
    if (metadataDirty) { setError("请先保存房间信息，再发布平面图。"); return; }
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (dirty) await persistLayout();
      const updated = await api<Room>(`/api/admin/rooms/${room.id}/publish`, { method: "POST" });
      updateRoom(updated, true); setMessage("最新平面图已发布");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "发布失败"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const updateSeatStatus = async (status: string) => {
    if (!selected?.seat || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await api(`/api/admin/seats/${selected.seat.id}/status`, { method: "PATCH", body: JSON.stringify({ status, note: seatNote.trim() || null }) }); setMessage("工位状态已更新");
      const updated = await api<Room>(`/api/admin/rooms/${room!.id}/layout`);
      const seats = new Map(updated.items.map((item) => [item.id, item.seat]));
      loadedRoom.current = updated; setRoom(updated); setItems((current) => dirty ? current.map((item) => ({ ...item, seat: seats.get(item.id) })) : updated.items); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "状态更新失败"); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const archiveRoom = async () => {
    if (!room || !confirm(`归档房间“${room.name}”？${dirty || metadataDirty ? "未保存的修改将被放弃。" : ""}`)) return;
    try { await api(`/api/admin/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ is_archived: true }) }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "归档失败"); }
  };

  return (
    <div className="admin-page rooms-page">
      <header className="page-heading">
        <h1>房间与平面图</h1>
        <form className="inline-create room-create" onSubmit={createRoom}>
          <input aria-label="新房间楼层" placeholder="楼层" value={newFloor} onChange={(e) => setNewFloor(e.target.value)} />
          <input aria-label="新房间名称" placeholder="房间号或名称" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} />
          <button disabled={busy}><Plus size={16} />添加房间</button>
        </form>
      </header>
      {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}{message && <p className="success-banner"><Save size={16} />{message}</p>}
      {loading ? <div className="central-message">正在加载房间目录…</div> : !rooms.length ? <div className="empty-state admin-empty"><MapIcon /><h2>还没有房间</h2><p>输入房间名称，创建第一张工位图。</p></div> : (
        <div className="room-editor-layout">
          <aside className="room-index flat-section">
            <header><h2>楼层与房间</h2><span>{rooms.length}</span></header>
            <div className="editor-floor-tabs" role="group" aria-label="选择楼层">{roomGroups.map((group) => <button key={group.floor} aria-pressed={group.floor === getFloorLabel(rooms.find((entry) => entry.id === selectedRoomId) ?? group.rooms[0])} onClick={() => chooseRoom(group.rooms[0].id)}>{group.floor}</button>)}</div>
            <div className="editor-room-list">{(roomGroups.find((group) => group.rooms.some((entry) => entry.id === selectedRoomId))?.rooms ?? []).map((entry) => <button key={entry.id} className={selectedRoomId === entry.id ? "active" : ""} onClick={() => chooseRoom(entry.id)}>
              <strong>{entry.name}</strong><span><MajorTags names={entry.major_names} compact /></span><small>{Object.values(entry.seat_counts).reduce((sum, count) => sum + count, 0)} 个工位 · {entry.is_published ? "已发布" : "草稿"}</small>
            </button>)}</div>
          </aside>
          {detailLoading ? <div className="central-message">正在加载平面图…</div> : room?.id === selectedRoomId && <section className="layout-editor" aria-busy={busy}>
            <fieldset className="editor-fields" disabled={busy}>
            <div className="editor-toolbar glass-surface">
              <button onClick={addSeat}><Armchair />单个工位</button>
              <button onClick={() => addFixture("door")}><DoorOpen />门</button>
              <button onClick={() => addFixture("window")}><PanelTop />窗</button>
              <button onClick={() => addFixture("aisle")}><BoxSelect />过道</button>
              <button onClick={() => addFixture("column")}><Columns3 />柱</button>
              <button onClick={() => addFixture("equipment")}><Printer />设备</button>
              <button onClick={() => addFixture("label")}><Type />文字</button>
              <span />
              <button onClick={undo} disabled={!past.length}><Undo2 />撤销</button><button onClick={redo} disabled={!future.length}><Redo2 />重做</button>
              <button onClick={() => setRoomView((value) => value === "map" ? "list" : "map")}>{roomView === "map" ? <List /> : <Grid3X3 />}{roomView === "map" ? "列表" : "平面图"}</button>
              <button onClick={() => { setRoomView("map"); setPreview((value) => !value); }}>{preview ? <EyeOff /> : <Eye />}{preview ? "退出预览" : "学生预览"}</button>
              <button onClick={save}><Save />{busy ? "处理中…" : dirty ? "保存草稿 · 未保存" : "保存草稿"}</button><button className="publish" onClick={publish}><Upload />发布</button>
            </div>
            <form className="room-details" onSubmit={saveRoomDetails}>
              <input aria-label="楼层" placeholder="楼层" value={roomForm.floor} onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })} />
              <input aria-label="房间名称" placeholder="房间号或名称" required value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} />
              <input aria-label="楼栋（可选）" placeholder="楼栋（可选）" value={roomForm.building} onChange={(e) => setRoomForm({ ...roomForm, building: e.target.value })} />
              <input aria-label="所属专业（多个用顿号分隔）" placeholder="所属专业（多个用顿号分隔）" value={roomForm.majors} onChange={(e) => setRoomForm({ ...roomForm, majors: e.target.value })} />
              <input aria-label="房间说明（可选）" placeholder="房间说明（可选）" value={roomForm.description} onChange={(e) => setRoomForm({ ...roomForm, description: e.target.value })} />
              <button>保存房间信息</button>
            </form>
            <div className="grid-generator">
              <Grid3X3 size={18} /><strong>批量生成</strong>
              <label>行 <input type="number" min={1} max={20} value={gridRows} onChange={(e) => setGridRows(Number(e.target.value))} /></label>
              <label>列 <input type="number" min={1} max={20} value={gridCols} onChange={(e) => setGridCols(Number(e.target.value))} /></label>
              <label>起始编号 <input type="number" min={1} value={gridStart} onChange={(e) => setGridStart(Number(e.target.value))} /></label>
              <label>编号方向 <select value={gridDirection} onChange={(e) => setGridDirection(e.target.value as "row" | "column")}><option value="row">先行后列</option><option value="column">先列后行</option></select></label>
              <button onClick={generateGrid}>生成工位矩阵</button>
            </div>
            <div className="editor-canvas">{roomView === "map" ? <SeatMap key={room.id} room={room} items={items} editable={!preview && !busy} selectedId={selectedId} selectedIds={selectedIds} onSelect={selectItem} onItemsChange={applyItems} /> : <div className="seat-table-wrap editor-seat-list"><table className="data-table"><thead><tr><th>工位</th><th>状态</th><th>使用人</th><th>导师</th><th>管理状态</th><th /></tr></thead><tbody>{items.filter((item) => item.type === "seat").map((item) => <tr key={item.id} className={selectedIds.includes(item.id) ? "selected" : ""}><td className="seat-code">{item.label}</td><td><span className={`state-label ${item.seat?.display_state ?? "available"}`}><i />{seatStateLabel[item.seat?.display_state ?? "available"]}</span></td><td>{item.seat?.occupant?.name ?? "—"}</td><td>{item.seat?.occupant?.adviser ?? "—"}</td><td>{item.seat?.admin_status === "active" || !item.seat ? "正常" : item.seat.admin_status}</td><td><button className="row-action" onClick={() => selectItem(item)}>选择</button></td></tr>)}</tbody></table></div>}</div>
            <div className="editor-inspector glass-surface">
              {selected ? <>
                <div><span>已选择{selection.length > 1 ? ` ${selection.length} 项` : ""}</span><strong>{selected.type === "seat" ? `工位 ${selected.label}` : selected.label}</strong></div>
                <label>名称或编号<input value={selected.label} onChange={(e) => modifySelected({ label: e.target.value })} /></label>
                {selected.seat?.occupant && <StudentProfile person={selected.seat.occupant} compact />}
                <button onClick={rotateSelected}><RotateCw />旋转所选项 90°</button>
                <button onClick={duplicateSelected}><Copy />复制</button>
                {selected.type === "seat" && selected.seat && <><select value={selected.seat.admin_status} onChange={(e) => updateSeatStatus(e.target.value)}><option value="active">正常可用</option><option value="disabled">停用</option><option value="maintenance">维修</option><option value="reserved">保留</option></select><label>状态说明<textarea rows={2} value={seatNote} onChange={(event) => setSeatNote(event.target.value)} placeholder="例如：设备维修、暂作保留" /></label><button disabled={seatNote === (selected.seat.note ?? "")} onClick={() => updateSeatStatus(selected.seat!.admin_status)}>保存状态说明</button></>}
                <button className="danger-plain" onClick={deleteSelected}><Trash2 />从布局移除</button>
              </> : <p>选择一个元素后可编辑；按住 Shift 点击可多选并一起拖动、旋转或复制。</p>}
              <button className="archive-button" onClick={archiveRoom}><Archive />归档房间</button>
            </div>
            </fieldset>
          </section>}
        </div>
      )}
    </div>
  );
}

function MapIcon() { return <Eye size={34} />; }
