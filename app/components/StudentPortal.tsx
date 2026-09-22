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
  Search,
  X,
} from "lucide-react";
import { FormEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";

import { api } from "@/app/lib/api";
import { getFloorLabel, groupRoomsByFloor, sortRooms } from "@/app/lib/rooms";
import type { Bootstrap, LayoutItem, Room, SeatState } from "@/app/lib/types";
import { StudentProfile } from "./StudentProfile";
import { DetailDialog } from "./DetailDialog";
import { RoomPlan } from "./RoomPlan";
import { PublicHeader } from "./PublicHeader";
import { MajorTags } from "./MajorTags";

const labels: Record<SeatState, string> = {
  available: "可申请",
  pending: "审核中",
  occupied: "已占用",
  unavailable: "不可使用",
};

type ApplicationForm = {
  name: string;
  student_no: string;
  adviser: string;
  email: string;
  enrollment_year: string;
  program_level: string;
  major_id: string;
};

const emptyForm: ApplicationForm = {
  name: "",
  student_no: "",
  adviser: "",
  email: "",
  enrollment_year: "",
  program_level: "硕士",
  major_id: "",
};

function RoomPicker({ rooms, allRooms, selected, onSelect, majorFilter, onMajorChange }: {
  rooms: Room[]; allRooms: Room[]; selected?: Room; onSelect: (room: Room) => void;
  majorFilter: string; onMajorChange: (major: string) => void;
}) {
  const groups = groupRoomsByFloor(rooms);
  const selectedFloor = selected ? getFloorLabel(selected) : groups[0]?.floor;
  const floorRooms = groups.find((group) => group.floor === selectedFloor)?.rooms ?? [];

  return (
    <aside className="room-picker" aria-label="选择房间">
      <div className="directory-heading"><Building2 size={17} /><strong>房间列表</strong><span>{rooms.length}</span></div>
      <label className="major-filter"><span>所属教研中心</span><select aria-label="所属教研中心" value={majorFilter} onChange={(event) => onMajorChange(event.target.value)}>
        <option value="">全部教研中心</option>
        {[...new Set(allRooms.flatMap((room) => room.major_names ?? []))].sort((a, b) => a.localeCompare(b, "zh-CN")).map((major) => <option key={major} value={major}>{major}（{allRooms.filter((room) => room.major_names?.includes(major)).length}）</option>)}
      </select></label>
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
              onClick={() => onSelect(group.rooms[0])}
            >
              <strong>{group.floor === "虚拟工位" ? "虚拟" : group.floor}</strong>
            </button>
          ))}
        </div>
      </section>
      <section className="picker-row room-picker-row">
        <h2>房间 <small>{floorRooms.length} 间</small></h2>
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
              <small className={room.seat_counts.available ? "has-vacancy" : ""}><i />{room.is_virtual ? `${room.items.length} 人` : room.seat_counts.available ? `${room.seat_counts.available} 空位` : "暂无空位"}</small>
            </button>
          ))}
        </div>
      </section>
      <div className="directory-footnote"><span className="state-dot available" />房间下方标注可申请工位数</div>
    </aside>
  );
}

export function StudentPortal() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedItem, setSelectedItem] = useState<LayoutItem | null>(null);
  const [expandedListItemId, setExpandedListItemId] = useState<string | null>(null);
  const [majorFilter, setMajorFilter] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<ApplicationForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const profileCard = useRef<HTMLElement>(null);
  useEffect(() => {
    if (selectedItem?.seat?.occupant && view === "map" && window.matchMedia("(max-width: 1050px)").matches) profileCard.current?.scrollIntoView({ block: "nearest" });
  }, [selectedItem, view]);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const next = await api<Bootstrap>("/api/public/bootstrap");
      const ordered = { ...next, rooms: sortRooms(next.rooms) };
      setData(ordered);
      setSelectedRoomId((current) => (ordered.rooms.some((room) => room.id === current) ? current : ordered.rooms[0]?.id ?? null));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "无法连接 DeskAtlas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selectedRoom = data?.rooms.find((room) => room.id === selectedRoomId);
  const filteredRooms = (data?.rooms ?? []).filter((room) => !majorFilter || room.major_names?.includes(majorFilter));
  const changeMajor = (major: string) => {
    setMajorFilter(major);
    if (major && !selectedRoom?.major_names?.includes(major)) {
      setSelectedRoomId(data?.rooms.find((room) => room.major_names?.includes(major))?.id ?? null);
    }
    setSelectedItem(null);
    setExpandedListItemId(null);
    setQuery("");
  };
  const seats = useMemo(
    () =>
      (selectedRoom?.items ?? [])
        .filter((item) => item.type === "seat" && item.seat)
        .filter((item) => {
          if (!query.trim()) return true;
          const text = `${item.label} ${item.seat?.occupant?.name ?? ""} ${item.seat?.occupant?.adviser ?? ""} ${item.seat?.occupant?.major ?? ""}`;
          return text.toLowerCase().includes(query.trim().toLowerCase());
        }),
    [query, selectedRoom],
  );

  const openSeat = (item: LayoutItem | null) => {
    setSelectedItem(item);
    setFormError("");
    setSubmitted(false);
    if (item?.seat?.display_state === "available") {
      setForm({ ...emptyForm, enrollment_year: String(data?.years.at(-2) ?? data?.years.at(-1) ?? ""), major_id: String(data?.majors[0]?.id ?? "") });
    }
  };

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
      <PublicHeader />

      <section className="hero-line">
        <div>
          <h1>工位查询与申请</h1>
        </div>
        {data && data.rooms.length > 0 && (
          <div className="hero-metrics" aria-label="工位概况">
            <span><strong>{data.rooms.filter((room) => !room.is_virtual).length}</strong> 个房间</span>
            <span><strong>{data.rooms.filter((room) => !room.is_virtual).reduce((sum, room) => sum + room.items.filter((item) => item.type === "seat").length, 0)}</strong> 个工位</span>
            <span className="vacancy-metric"><strong>{data.rooms.reduce((sum, room) => sum + (room.seat_counts.available ?? 0), 0)}</strong> 可申请</span>
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
        <div className="public-workspace">
          <RoomPicker rooms={filteredRooms} allRooms={data.rooms} selected={selectedRoom} majorFilter={majorFilter} onMajorChange={changeMajor} onSelect={(room) => { setSelectedRoomId(room.id); setSelectedItem(null); setExpandedListItemId(null); setQuery(""); }} />
          {selectedRoom && (
            <section className="workspace-frame" id="workspace">
              <div className="room-heading">
                <div className="room-heading-title"><span className="room-number">{selectedRoom.name}</span><div><h2>{selectedRoom.is_virtual ? "虚拟工位" : "研究生办公室"}</h2>{!selectedRoom.is_virtual && <div className="room-major-tags" aria-label="房间所属教研中心"><MajorTags names={selectedRoom.major_names} /></div>}<p>{[selectedRoom.building, getFloorLabel(selectedRoom)].filter(Boolean).join(" · ")}<span> / </span>{selectedRoom.items.filter((item) => item.type === "seat").length} {selectedRoom.is_virtual ? "人" : "个工位"}</p></div></div>
                <div className="room-availability"><i />{selectedRoom.is_virtual ? "人员暂存分组" : `${selectedRoom.seat_counts.available ?? 0} 个工位可申请`}</div>
              </div>
              <div className="workspace-toolbar">
                <label className="search-field">
                  <Search size={16} />
                  <input aria-label="搜索当前房间工位" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、导师或座位号" />
                  {query && <button aria-label="清空搜索" onClick={() => setQuery("")}><X size={14} /></button>}
                </label>
                <div className="segmented-control" aria-label="视图切换">
                  <button disabled={selectedRoom.is_virtual} className={view === "map" && !selectedRoom.is_virtual ? "active" : ""} onClick={() => setView("map")}><LayoutGrid size={16} /> 平面图</button>
                  <button className={view === "list" || selectedRoom.is_virtual ? "active" : ""} onClick={() => setView("list")}><List size={16} /> 列表</button>
                </div>
              </div>

              <div className="legend-line" hidden={selectedRoom.is_virtual}>
                {(Object.keys(labels) as SeatState[]).map((state) => (
                  <span key={state}><i className={`state-dot ${state}`} />{labels[state]}<b>{selectedRoom.seat_counts[state] ?? 0}</b></span>
                ))}
              </div>

              {view === "map" && !selectedRoom.is_virtual ? (
                <div className={`public-plan-layout ${selectedItem?.seat?.occupant ? "has-selection" : ""}`}>
                  <RoomPlan key={selectedRoom.id} room={selectedRoom} query={query} onSelect={openSeat} selectedId={selectedItem?.id} />
                  {selectedItem?.seat?.occupant && <aside ref={profileCard} className="public-student-card" aria-label="所选学生资料">
                    <header><span>{selectedRoom.name} · 工位 {selectedItem.label}</span><button aria-label="收起学生资料" onClick={() => setSelectedItem(null)}><X size={16} /></button></header>
                    <StudentProfile person={selectedItem.seat.occupant} compact />
                  </aside>}
                </div>
              ) : (
                <div className="seat-table-wrap">
                  <table className="data-table public-seat-table">
                    <thead><tr><th>工位</th><th>状态</th><th>使用人</th><th>导师</th><th>教研中心</th><th /></tr></thead>
                    <tbody>
                      {seats.map((item) => {
                        const expanded = expandedListItemId === item.id;
                        const occupant = item.seat!.occupant;
                        return (
                          <Fragment key={item.id}>
                            <tr
                              className={`public-seat-row ${expanded ? "selected" : ""}`}
                              tabIndex={0}
                              aria-expanded={expanded}
                              onClick={() => setExpandedListItemId(expanded ? null : item.id)}
                              onKeyDown={(event) => {
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
        </div>
      )}

      {selectedItem?.seat && !selectedItem.seat.occupant && (
        <DetailDialog label={`${selectedRoom?.name} · 工位 ${selectedItem.label}`} onClose={() => setSelectedItem(null)} wide={selectedItem.seat.display_state === "available"}>
            <div className={`drawer-heading ${selectedItem.seat.occupant ? "seat-context-heading" : ""}`}>
              <span className={`state-icon ${selectedItem.seat.display_state}`}>{selectedItem.label}</span>
              <div><p>{selectedRoom?.name}</p><h2>工位 {selectedItem.label}</h2></div>
            </div>
            {selectedItem.seat.display_state === "occupied" && selectedItem.seat.occupant ? (
              <StudentProfile person={selectedItem.seat.occupant} location={`${selectedRoom?.name} · 工位 ${selectedItem.label}`} />
            ) : selectedItem.seat.display_state === "pending" ? (
              <div className="drawer-message"><CircleAlert /><h3>申请正在审核</h3><p>该工位已被临时锁定，暂时不能提交新的申请。</p></div>
            ) : selectedItem.seat.display_state === "unavailable" ? (
              <div className="drawer-message"><LockKeyhole /><h3>工位暂不可用</h3><p>{selectedItem.seat.note || "管理员暂时关闭了这个工位。"}</p></div>
            ) : submitted ? (
              <div className="drawer-message success"><Check /><h3>申请已经提交</h3><p>管理员处理后会通过你的学生邮箱发送结果，请留意邮件。</p></div>
            ) : (
              <form className="application-form" onSubmit={submitApplication}>
                <div className="form-intro"><h3>申请这个工位</h3><p>请准确填写个人信息。导师姓名不完整可能导致审核不通过。</p></div>
                <div className="field-grid two">
                  <label><span>姓名</span><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
                  <label><span>学号</span><input required value={form.student_no} onChange={(e) => setForm({ ...form, student_no: e.target.value })} /></label>
                </div>
                <label><span>导师全名</span><input required placeholder="请填写导师完整姓名" value={form.adviser} onChange={(e) => setForm({ ...form, adviser: e.target.value })} /><small>信息不完整或不准确可能导致审核不通过</small></label>
                <label><span>学生邮箱</span><input readOnly aria-label="学生邮箱（根据学号自动生成）" placeholder="根据学号自动生成" value={form.student_no.trim() ? `${form.student_no.trim()}@stu.xmu.edu.cn` : ""} /></label>
                <div className="field-grid three">
                  <label><span>年级</span><div className="select-wrap"><select required value={form.enrollment_year} onChange={(e) => setForm({ ...form, enrollment_year: e.target.value })}>{data?.years.map((year) => <option key={year}>{year}</option>)}</select><ChevronDown /></div></label>
                  <label><span>培养层次</span><div className="select-wrap"><select required value={form.program_level} onChange={(e) => setForm({ ...form, program_level: e.target.value })}>{data?.program_levels.map((level) => <option key={level}>{level}</option>)}</select><ChevronDown /></div></label>
                  <label><span>教研中心</span><div className="select-wrap"><select required value={form.major_id} onChange={(e) => setForm({ ...form, major_id: e.target.value })}>{data?.majors.map((major) => <option key={major.id} value={major.id}>{major.name}</option>)}</select><ChevronDown /></div></label>
                </div>
                {formError && <p className="form-error"><CircleAlert size={16} />{formError}</p>}
                <button className="primary-action" disabled={submitting}>{submitting ? "正在提交…" : "提交申请"}<ArrowRight size={17} /></button>
              </form>
            )}
        </DetailDialog>
      )}
    </main>
  );
}
