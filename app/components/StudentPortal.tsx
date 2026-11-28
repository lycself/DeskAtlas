"use client";

import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  LayoutGrid,
  List,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import { FormEvent, Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Select } from "@/app/components/Select";
import { useCommandShortcut } from "@/app/hooks/useCommandShortcut";
import { api } from "@/app/lib/api";
import { getFloorLabel, groupRoomsByFloor, sortRooms } from "@/app/lib/rooms";
import type { Bootstrap, LayoutItem, Room, SeatState } from "@/app/lib/types";
import { StudentProfile } from "./StudentProfile";
import { DetailDialog } from "./DetailDialog";
import { RoomPlan } from "./RoomPlan";
import { VirtualRoomPlan } from "./VirtualRoomPlan";
import { PublicHeader } from "./PublicHeader";
import { MajorTags } from "./MajorTags";
import { StudentSearch } from "./StudentSearch";
import { emptyStudentForm, StudentFormFields, type StudentFormValues } from "./admin/StudentFormFields";

const labels: Record<SeatState, string> = {
  available: "可申请",
  pending: "审核中",
  occupied: "已占用",
  unavailable: "不可使用",
};

const ROOM_PARAM = "room";
const VIEW_PARAM = "view";
const MAJOR_PARAM = "major";
/** `view=available` opens the free-seat overview; `view=list` the seat list of a room. */
const AVAILABLE_VIEW = "available";

function roomIdFromUrl(): number | null {
  const value = Number(new URLSearchParams(window.location.search).get(ROOM_PARAM));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function RoomPicker({ rooms, allRooms, selected, onSelect, majorFilter, onMajorChange }: {
  rooms: Room[]; allRooms: Room[]; selected?: Room; onSelect: (room: Room, reveal?: boolean) => void;
  majorFilter: string; onMajorChange: (major: string) => void;
}) {
  const groups = groupRoomsByFloor(rooms);
  const selectedFloor = selected ? getFloorLabel(selected) : groups[0]?.floor;
  const floorRooms = groups.find((group) => group.floor === selectedFloor)?.rooms ?? [];

  return (
    <aside className="room-picker" aria-label="选择房间">
      <div className="directory-heading"><Building2 size={17} /><strong>房间与分组</strong></div>
      <label className="major-filter"><span>教研中心</span><Select aria-label="按教研中心筛选房间" value={majorFilter} onChange={onMajorChange} options={[
        { value: "", label: "全部教研中心" },
        ...[...new Set(allRooms.flatMap((room) => room.major_names ?? []))].sort((a, b) => a.localeCompare(b, "zh-CN"))
          .map((major) => ({ value: major, label: `${major}（${allRooms.filter((room) => room.major_names?.includes(major)).length}）` })),
      ]} /></label>
      <section className="picker-row">
        <h2>楼层</h2>
        <div className="floor-strip" role="group" aria-label="楼层列表">
          {groups.map((group) => (
            <button
              type="button"
              aria-label={group.floor}
              aria-pressed={selectedFloor === group.floor}
              className={`floor-tab ${selectedFloor === group.floor ? "active" : ""}`}
              key={group.floor}
              onClick={() => onSelect(group.rooms[0], false)}
            >
              <strong>{group.floor === "虚拟工位" ? "分组" : group.floor}</strong>
            </button>
          ))}
        </div>
      </section>
      <section className="picker-row room-picker-row">
        <h2>{selected?.is_virtual ? "人员分组" : "房间"} <small>{floorRooms.length} {selected?.is_virtual ? "组" : "间"}</small></h2>
        <div className="room-strip" role="group" aria-label={`${selectedFloor ?? "当前楼层"}教室列表`}>
          {floorRooms.map((room) => (
            <button
              type="button"
              aria-pressed={selected?.id === room.id}
              className={`room-tab ${selected?.id === room.id ? "active" : ""}`}
              key={room.id}
              onClick={() => onSelect(room)}
            >
              <span>{room.name}</span>
              {!room.is_virtual && <div className="room-tab-majors"><MajorTags names={room.major_names} compact /></div>}
              <small className={room.seat_counts.available ? "has-vacancy" : ""}><i />{room.is_virtual ? `${room.items.filter((item) => item.type === "seat").length} 人` : room.seat_counts.available ? `${room.seat_counts.available} 空位` : "暂无空位"}</small>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

export function StudentPortal() {
  const workspace = useRef<HTMLElement>(null);
  const showRoom = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [data, setData] = useState<Bootstrap | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedItem, setSelectedItem] = useState<LayoutItem | null>(null);
  const [expandedListItemId, setExpandedListItemId] = useState<string | null>(null);
  const [majorFilter, setMajorFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<StudentFormValues>(emptyStudentForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // The page opens on the rooms; the free-seat overview across rooms is the second tab.
  const [browse, setBrowse] = useState<"rooms" | "vacancies">("rooms");
  const [paletteOpen, setPaletteOpen] = useState(false);
  // A seat chosen in the search: marked on the plan until another seat or room is chosen.
  const [foundSeatId, setFoundSeatId] = useState<string | null>(null);
  const revealSeat = useRef(false);
  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const next = await api<Bootstrap>("/api/public/bootstrap");
      const ordered = { ...next, rooms: sortRooms(next.rooms) };
      setData(ordered);
      setMajorFilter((current) => ordered.rooms.some((room) => room.major_names?.includes(current)) ? current : "");
      // Without a room in the address, open the first room of the centre the address filters by.
      const major = new URLSearchParams(window.location.search).get(MAJOR_PARAM);
      setSelectedRoomId((current) => {
        const wanted = current ?? roomIdFromUrl();
        return ordered.rooms.some((room) => room.id === wanted) ? wanted
          : (ordered.rooms.find((room) => major && room.major_names?.includes(major)) ?? ordered.rooms[0])?.id ?? null;
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "无法连接 DeskAtlas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(VIEW_PARAM) === "list") setView("list");
    if (params.get(VIEW_PARAM) === AVAILABLE_VIEW) setBrowse("vacancies");
    setMajorFilter(params.get(MAJOR_PARAM) ?? "");
    void load();
  }, []);

  // Keep the room, view and centre filter in the address bar, so a reload or a shared link
  // opens the same page. A centre no room belongs to is dropped once the rooms load. The free-seat
  // overview is `view=available`, without a room.
  useEffect(() => {
    // Wait for the rooms: until then the address still holds the room a shared link asked for.
    const rooms = browse === "rooms";
    if (!data || (rooms && selectedRoomId === null)) return;
    const url = new URL(window.location.href);
    const wanted: Array<[string, string]> = [[ROOM_PARAM, rooms ? String(selectedRoomId) : ""], [VIEW_PARAM, !rooms ? AVAILABLE_VIEW : view === "list" ? "list" : ""], [MAJOR_PARAM, majorFilter]];
    let changed = false;
    for (const [key, value] of wanted) {
      if ((url.searchParams.get(key) ?? "") === value) continue;
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
      changed = true;
    }
    if (changed) window.history.replaceState(null, "", url);
  }, [data, browse, selectedRoomId, view, majorFilter]);

  useEffect(() => {
    if (showRoom.current && !loading) { showRoom.current = false; const top = workspace.current?.getBoundingClientRect().top ?? 0; if (window.innerWidth <= 820 || top < 64) workspace.current?.scrollIntoView({ block: "start" }); }
  }, [selectedRoomId, loading]);
  // After a search, bring the chosen seat into view and give it focus, on the plan or in the list.
  useEffect(() => {
    if (!revealSeat.current || !foundSeatId || loading) return;
    const frame = requestAnimationFrame(() => {
      const node = workspace.current?.querySelector<HTMLElement | SVGElement>(`[data-seat-id="${CSS.escape(foundSeatId)}"]`);
      if (!node) return;
      revealSeat.current = false;
      node.scrollIntoView({ block: "center" });
      node.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [foundSeatId, selectedRoomId, view, browse, loading, paletteOpen]);
  const selectedRoom = data?.rooms.find((room) => room.id === selectedRoomId);
  const filteredRooms = (data?.rooms ?? []).filter((room) => !majorFilter || room.major_names?.includes(majorFilter));
  const changeMajor = (major: string) => {
    setMajorFilter(major);
    if (major && !selectedRoom?.major_names?.includes(major)) {
      setSelectedRoomId(data?.rooms.find((room) => room.major_names?.includes(major))?.id ?? null);
    }
    setSelectedItem(null);
    setExpandedListItemId(null);
   
  };
  const seats = useMemo(() => (selectedRoom?.items ?? []).filter((item) => item.type === "seat" && item.seat), [selectedRoom]);

  const openSeat = (item: LayoutItem | null) => {
    setSelectedItem(item);
    if (item) setFoundSeatId(null);
    setFormError("");
    setSubmitted(false);
    if (item?.seat?.display_state === "available") {
      setForm({
        ...emptyStudentForm,
        program_level: "",
        note: "",
        enrollment_year: "",
        major_id: "",
      });
    }
  };

  const applyFrom = (room: Room, item: LayoutItem) => { setSelectedRoomId(room.id); openSeat(item); };
  const openRoom = (room: Room) => { setSelectedRoomId(room.id); setBrowse("rooms"); setSelectedItem(null); setFoundSeatId(null); showRoom.current = true; };

  useCommandShortcut(!!data?.rooms.length, paletteOpen, setPaletteOpen);
  // Search results open a room (and mark a seat in it). A centre filter that would hide the room is cleared.
  const jumpTo = useCallback((room: Room, item?: LayoutItem) => {
    setPaletteOpen(false);
    setMajorFilter((current) => current && !room.major_names?.includes(current) ? "" : current);
    setBrowse("rooms");
    setSelectedRoomId(room.id);
    setSelectedItem(null);
    setPickerOpen(false);
   
    setExpandedListItemId(item?.id ?? null);
    setFoundSeatId(item?.id ?? null);
    revealSeat.current = !!item;
    showRoom.current = !item;
  }, []);
  const jumpToMajor = useCallback((major: string) => {
    setPaletteOpen(false);
    setBrowse("rooms");
    setMajorFilter(major);
    setSelectedRoomId((current) => data?.rooms.find((room) => room.id === current)?.major_names?.includes(major) ? current : data?.rooms.find((room) => room.major_names?.includes(major))?.id ?? current);
    setSelectedItem(null);
    setExpandedListItemId(null);
    setFoundSeatId(null);
   
    showRoom.current = true;
  }, [data]);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  const submitApplication = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedItem?.seat) return;
    setSubmitting(true);
    setFormError("");
    try {
      await api("/api/public/applications", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          seat_id: selectedItem.seat.id,
          enrollment_year: Number(form.enrollment_year),
          major_id: Number(form.major_id),
        }),
      });
      setSubmitted(true);
      await load();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "申请提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="student-shell">
      <PublicHeader onSearch={data?.rooms.length ? () => setPaletteOpen(true) : undefined} />

      <section className="hero-line">
        <div>
          <h1>工位查询与申请</h1>
        </div>
        {data && data.rooms.length > 0 && (
          <div className="hero-metrics" aria-label="工位概况">
            <span><strong>{data.rooms.filter((room) => !room.is_virtual).length}</strong> 间实体房间</span>
            <span><strong>{data.rooms.filter((room) => !room.is_virtual).reduce((sum, room) => sum + room.items.filter((item) => item.type === "seat").length, 0)}</strong> 个工位</span>
          </div>
        )}
      </section>

      {loading ? (
        <div className="central-message"><RefreshCw className="spin" /> 正在加载房间数据…</div>
      ) : loadError ? (
        <div className="central-message error"><CircleAlert /> <span>{loadError}</span><button onClick={load}>重试</button></div>
      ) : !data?.rooms.length ? (
        <div className="empty-state">
          <Building2 size={34} />
          <h2>房间尚未发布</h2>
          <p>管理员完成房间布局并发布后，工位会显示在这里。</p>
        </div>
      ) : (
        <>
        <div className="segmented-control browse-switch" role="group" aria-label="浏览方式">
          <button aria-pressed={browse === "rooms"} onClick={() => setBrowse("rooms")}>按房间浏览</button>
          <button aria-pressed={browse === "vacancies"} onClick={() => setBrowse("vacancies")}>可申请的工位 <b>{data.rooms.reduce((sum, room) => sum + (room.is_virtual ? 0 : room.seat_counts.available ?? 0), 0)}</b></button>
        </div>
        {browse === "vacancies" ? <VacancyList rooms={data.rooms} majorFilter={majorFilter} onMajorChange={changeMajor} onApply={applyFrom} onOpenRoom={openRoom} /> :
        <div className="public-workspace">
          <div className={`public-directory ${pickerOpen ? "open" : ""}`}><button className="public-directory-toggle" aria-label="切换房间" aria-expanded={pickerOpen} onClick={() => setPickerOpen(!pickerOpen)}><span>当前{selectedRoom?.is_virtual ? "分组" : "房间"} · <strong>{selectedRoom?.name ?? "请选择"}</strong></span><small>{pickerOpen ? "收起" : "切换"}</small><ChevronDown size={16} /></button><RoomPicker rooms={filteredRooms} allRooms={data.rooms} selected={selectedRoom} majorFilter={majorFilter} onMajorChange={changeMajor} onSelect={(room, reveal = true) => { if (reveal) setPickerOpen(false); showRoom.current = reveal; setSelectedRoomId(room.id); setSelectedItem(null); setExpandedListItemId(null); setFoundSeatId(null); }} /></div>
          {selectedRoom && (
            <section ref={workspace} className="workspace-frame" id="workspace" aria-label={`${selectedRoom.name} 工位与人员`}>
              <div className="room-heading">
                <div className="room-heading-title"><span className="room-number">{selectedRoom.name}</span><div>{selectedRoom.is_virtual && <h2>人员分组</h2>}{!selectedRoom.is_virtual && <div className="room-major-tags" aria-label="房间所属教研中心"><MajorTags names={selectedRoom.major_names} /></div>}<p>{[selectedRoom.building, getFloorLabel(selectedRoom)].filter(Boolean).join(" · ")}<span> / </span>{selectedRoom.items.filter((item) => item.type === "seat").length} {selectedRoom.is_virtual ? "人" : "个工位"}</p></div></div>
                <div className="segmented-control room-view-switch" aria-label="视图切换">
                  <button aria-label={selectedRoom.is_virtual ? "位置图" : "平面图"} className={view === "map" ? "active" : ""} aria-pressed={view === "map"} onClick={() => setView("map")}><LayoutGrid size={16} /><span className="view-label">{selectedRoom.is_virtual ? "位置图" : "平面图"}</span></button>
                  <button aria-label="列表" className={view === "list" ? "active" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}><List size={16} /><span className="view-label">列表</span></button>
                </div>
              </div>

              <div className="legend-line" hidden={selectedRoom.is_virtual}>
                {(Object.keys(labels) as SeatState[]).map((state) => (
                  <span key={state}><i className={`state-dot ${state}`} />{labels[state]}<b>{selectedRoom.seat_counts[state] ?? 0}</b></span>
                ))}
              </div>

              {view === "map" ? (
                <div className="public-plan-layout">
                  {selectedRoom.is_virtual
                    ? <VirtualRoomPlan room={selectedRoom} majors={data.majors} onSelect={openSeat} selectedId={selectedItem?.id ?? foundSeatId} />
                    : <RoomPlan key={selectedRoom.id} room={selectedRoom} onSelect={openSeat} selectedId={selectedItem?.id ?? foundSeatId} />}
                </div>
              ) : (
                <div className="seat-table-wrap">
                  <table className="data-table public-seat-table sticky-first-col">
                    <thead><tr><th>{selectedRoom.is_virtual ? "虚拟位置" : "工位"}</th><th>状态</th><th>使用人</th><th>导师</th><th>教研中心</th><th /></tr></thead>
                    <tbody>
                      {seats.map((item) => {
                        const expanded = expandedListItemId === item.id;
                        const occupant = item.seat!.occupant;
                        return (
                          <Fragment key={item.id}>
                            <tr
                              className={`public-seat-row ${expanded ? "selected" : ""}`}
                              tabIndex={0}
                              data-seat-id={item.id}
                              aria-expanded={expanded}
                              onClick={() => setExpandedListItemId(expanded ? null : item.id)}
                              onKeyDown={(event) => {
                                if (event.nativeEvent.isComposing) return;
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  setExpandedListItemId(expanded ? null : item.id);
                                }
                              }}
                            >
                              <td className="seat-code">{item.label}</td>
                              <td><span className={`state-label ${item.seat!.display_state}`}><i />{selectedRoom.is_virtual ? selectedRoom.name === "未被分配" ? "待分配" : "翔安" : labels[item.seat!.display_state]}</span></td>
                              <td>{occupant?.name ?? "—"}</td>
                              <td>{occupant?.adviser ?? "—"}</td>
                              <td>{occupant?.major ?? "—"}</td>
                              <td className="row-chevron" aria-hidden>{expanded ? <ChevronUp /> : <ChevronDown />}</td>
                            </tr>
                            {expanded && (
                              <tr className="public-seat-expanded-row">
                                <td colSpan={6}>
                                  {occupant ? (
                                    <StudentProfile person={occupant} location={selectedRoom.is_virtual ? selectedRoom.name : `${selectedRoom.name} · 工位 ${item.label}`} />
                                  ) : (
                                    <div className="inline-seat-status">
                                      <div><strong>工位 {item.label}</strong><p>{item.seat!.display_state === "available" ? "当前可以申请这个工位。" : item.seat!.note || "这个工位目前不可申请。"}</p></div>
                                      {item.seat!.display_state === "available" && <button className="primary-action compact" onClick={() => openSeat(item)}>申请这个工位 <ArrowRight size={15} /></button>}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>}
        </>
      )}

      {paletteOpen && data && <StudentSearch rooms={data.rooms} onSeat={jumpTo} onRoom={jumpTo} onMajor={jumpToMajor} onClose={closePalette} />}

      {view === "map" && selectedItem?.seat?.occupant && (
        <DetailDialog label={`${selectedItem.seat.occupant.name}的资料`} onClose={() => setSelectedItem(null)}>
          <StudentProfile person={selectedItem.seat.occupant}
            location={`${selectedRoom?.name} · ${selectedRoom?.is_virtual ? "虚拟位置" : "工位"} ${selectedItem.label}`} />
        </DetailDialog>
      )}

      {selectedItem?.seat && !selectedItem.seat.occupant && (
        <DetailDialog label={`${selectedRoom?.name} · 工位 ${selectedItem.label}`} onClose={() => setSelectedItem(null)} wide={selectedItem.seat.display_state === "available"}>
            <div className="drawer-heading">
              <div><p>{selectedRoom?.name}</p><h2>工位 {selectedItem.label}</h2></div>
            </div>
            {selectedItem.seat.display_state === "pending" ? (
              <div className="drawer-message"><CircleAlert /><h3>申请正在审核</h3><p>该工位已被临时锁定，暂时不能提交新的申请。</p></div>
            ) : selectedItem.seat.display_state === "unavailable" ? (
              <div className="drawer-message"><LockKeyhole /><h3>工位暂不可用</h3><p>{selectedItem.seat.note || "管理员暂时关闭了这个工位。"}</p></div>
            ) : submitted ? (
              <div className="drawer-message success"><Check /><h3>申请已经提交</h3><p>管理员处理后会通过你的学生邮箱发送结果，请留意邮件。</p></div>
            ) : (
              <form className="application-form" onSubmit={submitApplication}>
                <div className="form-intro"><h3>申请这个工位</h3><p>请准确填写个人信息，审核结果会发送到由学号生成的学生邮箱。</p></div>
                <StudentFormFields form={form} onChange={(patch) => setForm({ ...form, ...patch })} options={data} required adviserHint="请填写导师完整姓名，不完整或不准确可能导致审核不通过" />
                {formError && <p className="form-error"><CircleAlert size={16} />{formError}</p>}
                <button className="primary-action" disabled={submitting}>{submitting ? "正在提交…" : "提交申请"}<ArrowRight size={17} /></button>
              </form>
            )}
        </DetailDialog>
      )}
    </main>
  );
}

/** Every free seat across rooms, grouped by floor and room; a seat number opens the application. */
function VacancyList({ rooms, majorFilter, onMajorChange, onApply, onOpenRoom }: {
  rooms: Room[]; majorFilter: string; onMajorChange: (major: string) => void;
  onApply: (room: Room, item: LayoutItem) => void; onOpenRoom: (room: Room) => void;
}) {
  const majors = [...new Set(rooms.flatMap((room) => room.major_names ?? []))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const withSeats = rooms.filter((room) => !room.is_virtual && (!majorFilter || room.major_names?.includes(majorFilter)))
    .map((room) => ({ room, free: room.items.filter((item) => item.type === "seat" && item.seat?.display_state === "available") }))
    .filter((entry) => entry.free.length);
  const floors = groupRoomsByFloor(withSeats.map((entry) => entry.room));
  const total = withSeats.reduce((sum, entry) => sum + entry.free.length, 0);
  return (
    <section className="vacancy-board workspace-frame" aria-label="可申请的工位">
      <header className="vacancy-toolbar">
        <div className="vacancy-majors" role="group" aria-label="按教研中心筛选">
          <button aria-pressed={!majorFilter} onClick={() => onMajorChange("")}>全部</button>
          {majors.map((major) => <button key={major} aria-pressed={majorFilter === major} onClick={() => onMajorChange(major)}>{major}</button>)}
        </div>
        <span>{withSeats.length} 个房间 · {total} 个空位 · 点编号直接申请</span>
      </header>
      {!withSeats.length ? <div className="search-empty"><h3>没有空位</h3><p>{majorFilter ? `${majorFilter}的房间暂时没有可申请的工位。` : "暂时没有可申请的工位。"}</p></div> : floors.map((group) => (
        <div className="vacancy-floor" key={group.floor}>
          <h2>{group.floor}</h2>
          {group.rooms.map((room) => {
            const free = withSeats.find((entry) => entry.room.id === room.id)?.free ?? [];
            return (
              <div className="vacancy-room" key={room.id}>
                <div className="vacancy-room-name"><strong>{room.name}</strong><MajorTags names={room.major_names} compact /></div>
                <div className="vacancy-seats">{free.map((item) => <button key={item.id} aria-label={`申请 ${room.name} 工位 ${item.label}`} onClick={() => onApply(room, item)}>{item.label}</button>)}</div>
                <button className="text-action" onClick={() => onOpenRoom(room)}>平面图</button>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
