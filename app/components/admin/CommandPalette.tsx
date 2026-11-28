"use client";

import { Armchair, DoorOpen, GraduationCap, Inbox, UserRound, Users, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CommandPalette, Highlight, type CommandEntry, type CommandGroup } from "@/app/components/CommandPalette";
import { api } from "@/app/lib/api";
import type { AdminJump, AdminSearchResults, SeatState } from "@/app/lib/types";

type Page = { id: string; label: string; icon: LucideIcon };

const seatStateLabel: Record<SeatState, string> = { available: "可申请", pending: "审核中", occupied: "已占用", unavailable: "不可使用" };

/** Admin search: the sections, plus students, advisers, rooms, seats and pending applications from the server. */
export function AdminCommandPalette({ pages, onNavigate, onJump, onClose }: {
  pages: Page[];
  onNavigate: (page: string) => void;
  onJump: (jump: AdminJump) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminSearchResults | null>(null);
  const [resultsFor, setResultsFor] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  const groups = useMemo<CommandGroup[]>(() => {
    const matchedPages = pages.filter((page) => !query || page.label.toLowerCase().includes(query.toLowerCase()));
    const found: CommandGroup[] = [{ label: query ? "页面" : "跳转到", entries: matchedPages.map((page) => ({
      key: `page-${page.id}`, icon: page.icon, title: <Highlight text={page.label} term={query} />, run: () => onNavigate(page.id),
    })) }];
    if (!results || !query) return found;
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
    const students: CommandEntry[] = results.students.map((student) => {
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
      run: () => onJump({ section: "overview", applicationId: application.id }),
    })) });
    return found;
  }, [pages, query, results, resultsFor, onNavigate, onJump]);

  const fresh = !query || resultsFor === query;
  return <CommandPalette
    label="全局搜索" placeholder="搜索学生、导师、房间、工位或申请"
    groups={groups} onQuery={setQuery} pending={loading || !fresh} error={error} onClose={onClose}
    empty={(text) => <>没有找到与“{text}”相关的结果。<br />查找工位时输入“房间号 工位号”，例如 301 12。</>}
    tip="工位：输入“房间号 工位号”，如 301 12"
  />;
}
