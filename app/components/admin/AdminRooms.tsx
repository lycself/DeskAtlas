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
import { FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "@/app/lib/api";
import { groupRoomsByFloor, sortRooms } from "@/app/lib/rooms";
import type { LayoutItem, Room } from "@/app/lib/types";
import { SeatMap } from "../SeatMap";

const fixtureDefaults: Record<string, { label: string; width: number; height: number }> = {
  door: { label: "门", width: 82, height: 22 },
  window: { label: "窗", width: 120, height: 18 },
  aisle: { label: "过道", width: 170, height: 70 },
  column: { label: "柱", width: 42, height: 42 },
  equipment: { label: "设备", width: 82, height: 52 },
  label: { label: "说明", width: 110, height: 34 },
};

type RoomForm = { name: string; building: string; floor: string; description: string };
const emptyRoomForm: RoomForm = { name: "", building: "", floor: "", description: "" };
const seatStateLabel: Record<string, string> = { available: "可申请", pending: "审核中", occupied: "已占用", unavailable: "不可使用" };

export function AdminRooms() {
  const [rooms, setRooms] = useState<Room[]>([]);
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

  const load = async (focus?: number) => {
    try {
      const rows = await api<Room[]>("/api/admin/rooms");
      const ordered = sortRooms(rows);
      setRooms(ordered);
      setSelectedRoomId((current) => focus ?? (ordered.some((room) => room.id === current) ? current : ordered[0]?.id ?? null));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "加载房间失败"); }
  };
  useEffect(() => { void load(); }, []);
  const room = rooms.find((item) => item.id === selectedRoomId);
  useEffect(() => { setItems(room?.items ?? []); setPast([]); setFuture([]); setSelectedId(null); setSelectedIds([]); setPreview(false); setRoomView("map"); setRoomForm(room ? { name: room.name, building: room.building ?? "", floor: room.floor ?? "", description: room.description ?? "" } : emptyRoomForm); }, [room]);
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const roomGroups = useMemo(() => groupRoomsByFloor(rooms), [rooms]);

  const applyItems = (next: LayoutItem[]) => {
    setPast((history) => [...history.slice(-29), items]);
    setItems(next);
    setFuture([]);
  };
  const undo = () => {
    const previous = past.at(-1); if (!previous) return;
    setFuture((history) => [items, ...history]); setItems(previous); setPast((history) => history.slice(0, -1));
  };
  const redo = () => {
    const next = future[0]; if (!next) return;
    setPast((history) => [...history, items]); setItems(next); setFuture((history) => history.slice(1));
  };

  const createRoom = async (event: FormEvent) => {
    event.preventDefault(); if (!newRoom.trim()) return;
    setError("");
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
  };
  const saveRoomDetails = async (event: FormEvent) => {
    event.preventDefault(); if (!room || !roomForm.name.trim()) return;
    const value = (text: string) => text.trim() || null;
    try {
      const updated = await api<Room>(`/api/admin/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ name: roomForm.name.trim(), building: value(roomForm.building), floor: value(roomForm.floor), description: value(roomForm.description) }) });
      setRooms((rows) => sortRooms(rows.map((item) => item.id === updated.id ? updated : item))); setMessage("房间信息已更新");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "房间信息更新失败"); }
  };

  const nextSeatCode = useMemo(() => {
    const nums = items.filter((item) => item.type === "seat").map((item) => Number(item.label)).filter(Number.isFinite);
    return String((nums.length ? Math.max(...nums) : 0) + 1);
  }, [items]);

  const addSeat = () => {
    const count = items.filter((item) => item.type === "seat").length;
    applyItems([...items, { id: crypto.randomUUID(), type: "seat", label: nextSeatCode, x: 48 + (count % 8) * 105, y: 48 + Math.floor(count / 8) * 82, width: 76, height: 48, rotation: 0 }]);
  };
  const addFixture = (type: keyof typeof fixtureDefaults) => {
    const value = fixtureDefaults[type];
    applyItems([...items, { id: crypto.randomUUID(), type: type as LayoutItem["type"], label: value.label, x: 48, y: 48, width: value.width, height: value.height, rotation: 0 }]);
  };
  const generateGrid = () => {
    const created: LayoutItem[] = [];
    for (let row = 0; row < gridRows; row += 1) for (let col = 0; col < gridCols; col += 1) {
      const offset = gridDirection === "row" ? row * gridCols + col : col * gridRows + row;
      created.push({ id: crypto.randomUUID(), type: "seat", label: String(gridStart + offset), x: 54 + col * 105, y: 54 + row * 82, width: 76, height: 48, rotation: 0 });
    }
    applyItems([...items, ...created]);
  };
  const modifySelected = (patch: Partial<LayoutItem>) => selected && applyItems(items.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
  const selection = items.filter((item) => selectedIds.includes(item.id) || (!selectedIds.length && item.id === selectedId));
  const rotateSelected = () => selection.length && applyItems(items.map((item) => selection.some((target) => target.id === item.id) ? { ...item, rotation: (item.rotation + 90) % 360 } : item));
  const duplicateSelected = () => {
    if (!selection.length) return;
    let code = Number(nextSeatCode);
    const copies = selection.map((item) => ({ ...item, id: crypto.randomUUID(), label: item.type === "seat" ? String(code++) : item.label, x: item.x + 24, y: item.y + 24, seat: undefined }));
    applyItems([...items, ...copies]); setSelectedIds(copies.map((item) => item.id)); setSelectedId(copies.at(-1)?.id ?? null);
  };
  const deleteSelected = () => { if (!selection.length) return; const ids = new Set(selection.map((item) => item.id)); applyItems(items.filter((item) => !ids.has(item.id))); setSelectedId(null); setSelectedIds([]); };
  const selectItem = (item: LayoutItem | null, additive = false) => {
    if (!item) { setSelectedId(null); setSelectedIds([]); return; }
    if (additive) {
      const next = selectedIds.includes(item.id) ? selectedIds.filter((id) => id !== item.id) : [...selectedIds, item.id];
      setSelectedIds(next); setSelectedId(next.at(-1) ?? null);
    } else {
      setSelectedId(item.id); setSelectedIds([item.id]);
    }
  };

  const save = async () => {
    if (!room) return; setError(""); setMessage("");
    try {
      const updated = await api<Room>(`/api/admin/rooms/${room.id}/layout`, {
        method: "PUT",
        body: JSON.stringify({
          items: items.map((item) => ({
            id: item.id,
            type: item.type,
            label: item.label,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
            rotation: item.rotation,
          })),
        }),
      });
      setMessage("草稿已保存"); setRooms((rows) => rows.map((item) => item.id === updated.id ? updated : item));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
  };
  const publish = async () => {
    if (!room) return; setError(""); setMessage("");
    try { const updated = await api<Room>(`/api/admin/rooms/${room.id}/publish`, { method: "POST" }); setMessage("平面图已发布"); setRooms((rows) => rows.map((item) => item.id === updated.id ? { ...updated, items: updated.items } : item)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "发布失败"); }
  };
  const updateSeatStatus = async (status: string) => {
    if (!selected?.seat) return;
    try { await api(`/api/admin/seats/${selected.seat.id}/status`, { method: "PATCH", body: JSON.stringify({ status, note: selected.seat.note }) }); setMessage("工位状态已更新"); await load(room?.id); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "状态更新失败"); }
  };
  const archiveRoom = async () => {
    if (!room || !confirm(`归档房间“${room.name}”？`)) return;
    try { await api(`/api/admin/rooms/${room.id}`, { method: "PATCH", body: JSON.stringify({ is_archived: true }) }); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "归档失败"); }
  };

  return (
    <div className="admin-page rooms-page">
      <header className="page-heading">
        <h1>空间与平面图</h1>
        <form className="inline-create room-create" onSubmit={createRoom}>
          <input aria-label="新房间楼层" placeholder="楼层" value={newFloor} onChange={(e) => setNewFloor(e.target.value)} />
          <input aria-label="新房间名称" placeholder="房间号或名称" value={newRoom} onChange={(e) => setNewRoom(e.target.value)} />
          <button><Plus size={16} />添加房间</button>
        </form>
      </header>
      {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}{message && <p className="success-banner"><Save size={16} />{message}</p>}
      {!rooms.length ? <div className="empty-state admin-empty"><MapIcon /><h2>还没有房间</h2><p>输入房间名称，创建第一张工位图。</p></div> : (
        <div className="room-editor-layout">
          <aside className="room-index flat-section">
            <header><h2>楼层与房间</h2><span>{rooms.length}</span></header>
            {roomGroups.map((group) => (
              <section className="admin-floor-group" key={group.floor}>
                <h3>{group.floor}</h3>
                {group.rooms.map((item) => (
                  <button key={item.id} className={room?.id === item.id ? "active" : ""} onClick={() => setSelectedRoomId(item.id)}>
                    <span><strong>{item.name}</strong><small>{item.items.filter((x) => x.type === "seat").length} 个工位</small></span>
                    <i className={item.is_published ? "published" : "draft"}>{item.is_published ? "已发布" : "草稿"}</i>
                  </button>
                ))}
              </section>
            ))}
          </aside>
          {room && <section className="layout-editor">
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
              <button onClick={save}><Save />保存草稿</button><button className="publish" onClick={publish}><Upload />发布</button>
            </div>
            <form className="room-details" onSubmit={saveRoomDetails}>
              <input aria-label="楼层" placeholder="楼层" value={roomForm.floor} onChange={(e) => setRoomForm({ ...roomForm, floor: e.target.value })} />
              <input aria-label="房间名称" placeholder="房间号或名称" required value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} />
              <input aria-label="楼栋（可选）" placeholder="楼栋（可选）" value={roomForm.building} onChange={(e) => setRoomForm({ ...roomForm, building: e.target.value })} />
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
            <div className="editor-canvas">{roomView === "map" ? <SeatMap room={{ ...room, items }} items={items} editable={!preview} selectedId={selectedId} selectedIds={selectedIds} onSelect={selectItem} onItemsChange={applyItems} /> : <div className="seat-table-wrap editor-seat-list"><table className="data-table"><thead><tr><th>工位</th><th>状态</th><th>使用人</th><th>导师</th><th>管理状态</th><th /></tr></thead><tbody>{items.filter((item) => item.type === "seat").map((item) => <tr key={item.id} className={selectedIds.includes(item.id) ? "selected" : ""}><td className="seat-code">{item.label}</td><td><span className={`state-label ${item.seat?.display_state ?? "available"}`}><i />{seatStateLabel[item.seat?.display_state ?? "available"]}</span></td><td>{item.seat?.occupant?.name ?? "—"}</td><td>{item.seat?.occupant?.adviser ?? "—"}</td><td>{item.seat?.admin_status === "active" || !item.seat ? "正常" : item.seat.admin_status}</td><td><button className="row-action" onClick={() => selectItem(item)}>选择</button></td></tr>)}</tbody></table></div>}</div>
            <div className="editor-inspector glass-surface">
              {selected ? <>
                <div><span>已选择{selection.length > 1 ? ` ${selection.length} 项` : ""}</span><strong>{selected.type === "seat" ? `工位 ${selected.label}` : selected.label}</strong></div>
                <label>名称或编号<input value={selected.label} onChange={(e) => modifySelected({ label: e.target.value })} /></label>
                <button onClick={rotateSelected}><RotateCw />旋转所选项 90°</button>
                <button onClick={duplicateSelected}><Copy />复制</button>
                {selected.type === "seat" && selected.seat && <><select value={selected.seat.admin_status} onChange={(e) => updateSeatStatus(e.target.value)}><option value="active">正常可用</option><option value="disabled">停用</option><option value="maintenance">维修</option><option value="reserved">保留</option></select><label>状态说明<textarea key={selected.seat.id} rows={2} defaultValue={selected.seat.note ?? ""} placeholder="例如：设备维修、暂作保留" onBlur={(e) => { if (e.currentTarget.value !== (selected.seat?.note ?? "")) void api(`/api/admin/seats/${selected.seat?.id}/status`, { method: "PATCH", body: JSON.stringify({ status: selected.seat?.admin_status, note: e.currentTarget.value.trim() || null }) }).then(() => { setMessage("工位说明已更新"); return load(room?.id); }).catch((caught) => setError(caught instanceof Error ? caught.message : "说明更新失败")); }} /></label></>}
                <button className="danger-plain" onClick={deleteSelected}><Trash2 />从布局移除</button>
              </> : <p>选择一个元素后可编辑；按住 Shift 点击可多选并一起拖动、旋转或复制。</p>}
              <button className="archive-button" onClick={archiveRoom}><Archive />归档房间</button>
            </div>
          </section>}
        </div>
      )}
    </div>
  );
}

function MapIcon() { return <Eye size={34} />; }
