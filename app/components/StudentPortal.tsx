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
import Link from "next/link";
import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";

import { api } from "@/app/lib/api";
import { getFloorLabel, groupRoomsByFloor, sortRooms } from "@/app/lib/rooms";
import type { Bootstrap, LayoutItem, Room, SeatState } from "@/app/lib/types";
import { Brand } from "./Brand";
import { SeatMap } from "./SeatMap";
import { ThemeToggle } from "./ThemeToggle";

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

function RoomPicker({ rooms, selected, onSelect }: { rooms: Room[]; selected?: Room; onSelect: (room: Room) => void }) {
  const groups = groupRoomsByFloor(rooms);
  const selectedFloor = selected ? getFloorLabel(selected) : groups[0]?.floor;
  const floorRooms = groups.find((group) => group.floor === selectedFloor)?.rooms ?? [];

  return (
    <div className="room-picker" aria-label="先选择楼层，再选择教室">
      <section className="picker-row">
        <h2><span>1</span>选择楼层</h2>
        <div className="floor-strip" role="list" aria-label="楼层列表">
          {groups.map((group) => (
            <button
              type="button"
              role="listitem"
              className={`floor-tab ${selectedFloor === group.floor ? "active" : ""}`}
              key={group.floor}
              onClick={() => onSelect(group.rooms[0])}
            >
              <strong>{group.floor}</strong>
              <small>{group.rooms.length} 个教室</small>
            </button>
          ))}
        </div>
      </section>
      <section className="picker-row room-picker-row">
        <h2><span>2</span>选择教室</h2>
        <div className="room-strip" role="list" aria-label={`${selectedFloor ?? "当前楼层"}教室列表`}>
          {floorRooms.map((room) => (
            <button
              type="button"
              role="listitem"
              className={`room-tab ${selected?.id === room.id ? "active" : ""}`}
              key={room.id}
              onClick={() => onSelect(room)}
            >
              <span>{room.name}</span>
              <small>{room.seat_counts.available ?? 0} 个空位</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

export function StudentPortal() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<number | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [selectedItem, setSelectedItem] = useState<LayoutItem | null>(null);
  const [expandedListItemId, setExpandedListItemId] = useState<string | null>(null);
  const [topbarScrolled, setTopbarScrolled] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<ApplicationForm>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [submitted, setSubmitted] = useState(false);

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

  useEffect(() => {
    const updateTopbar = () => setTopbarScrolled(window.scrollY > 24);
    updateTopbar();
    window.addEventListener("scroll", updateTopbar, { passive: true });
    return () => window.removeEventListener("scroll", updateTopbar);
  }, []);

  const selectedRoom = data?.rooms.find((room) => room.id === selectedRoomId);
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
      <header className={`topbar ${topbarScrolled ? "is-scrolled" : ""}`}>
        <Brand />
        <nav className="public-navigation" aria-label="主导航">
          <a href="#workspace">工位地图</a>
        </nav>
        <div className="topbar-actions">
          <span className="privacy-note"><LockKeyhole size={14} /> 校内访问</span>
          <ThemeToggle />
          <Link className="text-link" href="/admin/login">管理入口 <ArrowRight size={15} /></Link>
        </div>
      </header>

      <section className="hero-line">
        <div>
          <h1>工位查询与申请</h1>
        </div>
        {data && data.rooms.length > 0 && (
          <div className="hero-metrics" aria-label="工位概况">
            <span><strong>{data.rooms.length}</strong> 个房间</span>
            <span><strong>{data.rooms.reduce((sum, room) => sum + (room.seat_counts.available ?? 0), 0)}</strong> 个空位</span>
          </div>
        )}
      </section>

      {loading ? (
        <div className="central-message"><RefreshCw className="spin" /> 正在读取空间信息…</div>
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
          <RoomPicker rooms={data.rooms} selected={selectedRoom} onSelect={(room) => { setSelectedRoomId(room.id); setSelectedItem(null); setExpandedListItemId(null); }} />
          {selectedRoom && (
            <section className="workspace-frame" id="workspace">
              <div className="workspace-toolbar glass-surface">
                <div>
                  <strong>{selectedRoom.name}</strong>
                  <span>{[selectedRoom.building, getFloorLabel(selectedRoom)].filter(Boolean).join(" · ")}</span>
                </div>
                <label className="search-field">
                  <Search size={16} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、导师或座位" />
                </label>
                <div className="segmented-control" aria-label="视图切换">
                  <button className={view === "map" ? "active" : ""} onClick={() => setView("map")}><LayoutGrid size={16} /> 平面图</button>
                  <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}><List size={16} /> 列表</button>
                </div>
              </div>

              <div className="legend-line">
                {(Object.keys(labels) as SeatState[]).map((state) => (
                  <span key={state}><i className={`state-dot ${state}`} />{labels[state]}</span>
                ))}
              </div>

              {view === "map" ? (
                <SeatMap room={selectedRoom} selectedId={selectedItem?.id} onSelect={openSeat} />
              ) : (
                <div className="seat-table-wrap">
                  <table className="data-table public-seat-table">
                    <thead><tr><th>工位</th><th>状态</th><th>使用人</th><th>导师</th><th>专业</th><th /></tr></thead>
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
                              <td><span className={`state-label ${item.seat!.display_state}`}><i />{labels[item.seat!.display_state]}</span></td>
                              <td>{occupant?.name ?? "—"}</td>
                              <td>{occupant?.adviser ?? "—"}</td>
                              <td>{occupant?.major ?? "—"}</td>
                              <td className="row-chevron" aria-hidden>{expanded ? <ChevronUp /> : <ChevronDown />}</td>
                            </tr>
                            {expanded && (
                              <tr className="public-seat-expanded-row">
                                <td colSpan={6}>
                                  {occupant ? (
                                    <div className="inline-seat-detail">
                                      <div className="inline-seat-heading"><span className={`state-icon ${item.seat!.display_state}`}>{item.label}</span><div><small>{selectedRoom.name}</small><strong>{occupant.name}</strong></div></div>
                                      <dl>
                                        <div><dt>导师</dt><dd>{occupant.adviser || "未填写"}</dd></div>
                                        <div><dt>年级</dt><dd>{occupant.enrollment_year || "未填写"}</dd></div>
                                        <div><dt>培养层次</dt><dd>{occupant.program_level || "未填写"}</dd></div>
                                        <div><dt>专业</dt><dd>{occupant.major || "未填写"}</dd></div>
                                      </dl>
                                    </div>
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
        </>
      )}

      {selectedItem?.seat && (
        <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setSelectedItem(null)}>
          <aside className="detail-drawer glass-surface">
            <button className="drawer-close" onClick={() => setSelectedItem(null)} aria-label="关闭"><X /></button>
            <div className="drawer-heading">
              <span className={`state-icon ${selectedItem.seat.display_state}`}>{selectedItem.label}</span>
              <div><p>{selectedRoom?.name}</p><h2>工位 {selectedItem.label}</h2></div>
            </div>
            {selectedItem.seat.display_state === "occupied" && selectedItem.seat.occupant ? (
              <div className="occupant-sheet">
                <dl>
                  <div><dt>使用人</dt><dd>{selectedItem.seat.occupant.name}</dd></div>
                  <div><dt>导师</dt><dd>{selectedItem.seat.occupant.adviser || "未填写"}</dd></div>
                  <div><dt>年级</dt><dd>{selectedItem.seat.occupant.enrollment_year || "未填写"}</dd></div>
                  <div><dt>培养层次</dt><dd>{selectedItem.seat.occupant.program_level || "未填写"}</dd></div>
                  <div><dt>专业</dt><dd>{selectedItem.seat.occupant.major || "未填写"}</dd></div>
                </dl>
              </div>
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
                <label><span>学生邮箱</span><input required type="email" pattern=".+@stu\.xmu\.edu" placeholder="name@stu.xmu.edu" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
                <div className="field-grid three">
                  <label><span>年级</span><div className="select-wrap"><select required value={form.enrollment_year} onChange={(e) => setForm({ ...form, enrollment_year: e.target.value })}>{data?.years.map((year) => <option key={year}>{year}</option>)}</select><ChevronDown /></div></label>
                  <label><span>培养层次</span><div className="select-wrap"><select required value={form.program_level} onChange={(e) => setForm({ ...form, program_level: e.target.value })}>{data?.program_levels.map((level) => <option key={level}>{level}</option>)}</select><ChevronDown /></div></label>
                  <label><span>专业</span><div className="select-wrap"><select required value={form.major_id} onChange={(e) => setForm({ ...form, major_id: e.target.value })}>{data?.majors.map((major) => <option key={major.id} value={major.id}>{major.name}</option>)}</select><ChevronDown /></div></label>
                </div>
                {formError && <p className="form-error"><CircleAlert size={16} />{formError}</p>}
                <button className="primary-action" disabled={submitting}>{submitting ? "正在提交…" : "提交申请"}<ArrowRight size={17} /></button>
              </form>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
