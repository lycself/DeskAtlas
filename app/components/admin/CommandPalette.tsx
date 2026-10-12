"use client";

import { Armchair, CircleAlert, DoorOpen, GraduationCap, Inbox, RefreshCw, Search, UserRound, Users, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useModalLayer } from "@/app/hooks/useModalLayer";
import { api } from "@/app/lib/api";
import type { AdminJump, AdminSearchResults, SeatState } from "@/app/lib/types";

type Page = { id: string; label: string; icon: LucideIcon };
type Entry = { key: string; icon: LucideIcon; title: ReactNode; meta?: ReactNode; badge?: ReactNode; run: () => void; index?: number };
type Group = { label: string; entries: Entry[] };

const seatStateLabel: Record<SeatState, string> = { available: "可申请", pending: "审核中", occupied: "已占用", unavailable: "不可使用" };

function Highlight({ text, term }: { text: string; term: string }) {
  const index = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
  if (index < 0) return <>{text}</>;
  return <>{text.slice(0, index)}<mark>{text.slice(index, index + term.length)}</mark>{text.slice(index + term.length)}</>;
}

export function CommandPalette({ pages, onNavigate, onJump, onClose }: {
  pages: Page[];
  onNavigate: (page: string) => void;
  onJump: (jump: AdminJump) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  // Pinyin composition fires input events for every keystroke; search only once the characters are committed.
  const [term, setTerm] = useState("");
  const composing = useRef(false);
  const [results, setResults] = useState<AdminSearchResults | null>(null);
  const [resultsFor, setResultsFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);
  // Enter pressed before the latest keystroke's results arrived opens the first fresh result instead of a stale one.
  const enterWhenReady = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useModalLayer(panel, onClose, { focusPanel: false });

  const query = term.trim();
  useEffect(() => {
    if (!query) { setResults(null); setResultsFor(""); setLoading(false); setError(""); return; }
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      api<AdminSearchResults>(`/api/admin/search?${new URLSearchParams({ q: query })}`, { signal: controller.signal })
        .then((next) => { setResults(next); setResultsFor(query); setError(""); })
        .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "搜索失败"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 140);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query]);

  const groups = useMemo<Group[]>(() => {
    const matchedPages = pages.filter((page) => !query || page.label.toLowerCase().includes(query.toLowerCase()));
    const found: Group[] = [{ label: query ? "页面" : "跳转到", entries: matchedPages.map((page) => ({
      key: `page-${page.id}`, icon: page.icon, title: <Highlight text={page.label} term={query} />, run: () => onNavigate(page.id),
    })) }];
    if (results && query) {
      const hit = resultsFor;
      found.push({ label: "工位", entries: results.seats.map((seat) => ({
        key: `seat-${seat.id}`, icon: Armchair,
        title: `${seat.room_name} · ${seat.code} 号工位`,
        meta: seat.occupant ? `使用人：${seat.occupant}` : undefined,
        badge: <span className={`state-label ${seat.display_state}`}><i />{seatStateLabel[seat.display_state]}</span>,
        run: () => onJump({ section: "rooms", roomId: seat.room_id, seatId: seat.id }),
      })) });
      found.push({ label: "房间", entries: results.rooms.map((room) => {
        const total = Object.values(room.seat_counts).reduce((sum, count) => sum + (count ?? 0), 0);
        return {
          key: `room-${room.id}`, icon: DoorOpen,
          title: <Highlight text={room.name} term={hit} />,
          meta: <Highlight text={[room.floor, room.major_names.join("、")].filter(Boolean).join(" · ")} term={hit} />,
          badge: <small>{room.is_virtual ? `${room.seat_counts.occupied ?? 0} 人` : `${room.seat_counts.available ?? 0} 空闲 / ${total} 工位`}</small>,
          run: () => onJump({ section: "rooms", roomId: room.id }),
        };
      }) });
      found.push({ label: "导师", entries: results.advisers.map((adviser) => ({
        key: `adviser-${adviser.name}`, icon: GraduationCap,
        title: <Highlight text={adviser.name} term={hit} />,
        meta: "在学生名册中查看该导师的学生",
        badge: <small>{adviser.count} 名学生</small>,
        run: () => onJump({ section: "students", query: adviser.name }),
      })) });
      const students: Entry[] = results.students.map((student) => {
        const seat = student.current_assignment;
        return {
          key: `student-${student.id}`, icon: UserRound,
          title: <><Highlight text={student.name} term={hit} />{!student.is_complete && <em className="draft-flag command-flag">待补全</em>}</>,
          meta: <Highlight text={[student.student_no || "无学号", student.adviser && `导师 ${student.adviser}`, student.major].filter(Boolean).join(" · ")} term={hit} />,
          badge: <small>{seat ? seat.seat_code === "虚拟工位" ? seat.room_name : `${seat.room_name} · ${seat.seat_code}` : "未分配"}</small>,
          run: () => onJump(seat
            ? { section: "rooms", roomId: seat.room_id, seatId: seat.seat_id }
            : { section: "students", query: student.student_no || student.name, studentId: student.id }),
        };
      });
      if (results.student_total > results.students.length) students.push({
        key: "students-all", icon: Users,
        title: `在学生名册中查看全部 ${results.student_total} 位匹配学生`,
        run: () => onJump({ section: "students", query: hit }),
      });
      found.push({ label: "学生", entries: students });
      found.push({ label: "待审批申请", entries: results.applications.map((application) => ({
        key: `application-${application.id}`, icon: Inbox,
        title: <Highlight text={application.name} term={hit} />,
        meta: <><Highlight text={application.student_no} term={hit} /> · 申请 {application.room_name} · {application.seat_code} 号</>,
        badge: <span className="state-label pending"><i />待审批</span>,
        run: () => onJump({ section: "applications", applicationId: application.id }),
      })) });
    }
    const shown = found.filter((group) => group.entries.length);
    shown.flatMap((group) => group.entries).forEach((entry, index) => { entry.index = index; });
    return shown;
  }, [pages, query, results, resultsFor, onNavigate, onJump]);

  const entries = useMemo(() => groups.flatMap((group) => group.entries), [groups]);
  useEffect(() => {
    setActive(0);
    if (enterWhenReady.current && resultsFor === query) { enterWhenReady.current = false; entries[0]?.run(); }
  }, [entries, resultsFor, query]);
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, entries]);

  const settle = (value: string) => { setText(value); if (!composing.current) { setTerm(value); enterWhenReady.current = false; } };
  const fresh = !query || resultsFor === query;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || composing.current) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!entries.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + entries.length) % entries.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (fresh || error) entries[active]?.run();
      else enterWhenReady.current = true;
    } else if (event.key === "Tab") {
      // The input is the only focus stop; options are reached with the arrow keys.
      event.preventDefault();
    }
  };

  const waiting = !!query && (loading || (!fresh && !error));
  const empty = !!query && !waiting && !error && entries.length === 0;

  return (
    <div className="command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="全局搜索" ref={panel}>
        <label className="command-input">
          {waiting ? <RefreshCw className="spin" aria-hidden="true" /> : <Search aria-hidden="true" />}
          <input
            autoFocus role="combobox" aria-expanded="true" aria-controls="command-results" aria-autocomplete="list"
            aria-activedescendant={entries[active] ? `command-option-${active}` : undefined}
            aria-label="搜索学生、导师、房间、工位或申请" placeholder="搜索学生、导师、房间、工位或申请" maxLength={80}
            value={text} onChange={(event) => settle(event.target.value)} onKeyDown={onKeyDown}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={(event) => { composing.current = false; settle(event.currentTarget.value); }}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="command-results" id="command-results" role="listbox" aria-label="搜索结果" ref={list}>
          {error && <p className="command-note error"><CircleAlert size={16} />{error}</p>}
          {empty && <p className="command-note">没有找到与“{query}”相关的结果。<br />查找工位时输入“房间号 工位号”，例如 301 12。</p>}
          {groups.map((group) => <div key={group.label} role="group" aria-label={group.label}>
            <div className="command-group-label" aria-hidden="true">{group.label}</div>
            {group.entries.map((entry) => {
              const position = entry.index ?? 0;
              const Icon = entry.icon;
              return <div
                key={entry.key} id={`command-option-${position}`} role="option" aria-selected={position === active} data-active={position === active}
                className="command-option" onMouseMove={() => { if (active !== position) setActive(position); }}
                onMouseDown={(event) => event.preventDefault()} onClick={entry.run}
              >
                <Icon aria-hidden="true" />
                <span className="command-option-text"><strong>{entry.title}</strong>{entry.meta && <small>{entry.meta}</small>}</span>
                {entry.badge && <span className="command-option-badge">{entry.badge}</span>}
              </div>;
            })}
          </div>)}
        </div>
        <footer className="command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd>选择</span><span><kbd>↵</kbd>打开</span>
          <span className="command-footer-tip">工位：输入“房间号 工位号”，如 301 12</span>
        </footer>
      </div>
    </div>
  );
}
