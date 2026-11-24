"use client";

// The administrator's home page: everything that needs a decision, handled in place. Pending
// applications, emails that did not go out, students with missing details, unpublished rooms.
import { Check, CircleAlert, FileClock, Inbox, Mail, RefreshCw, TriangleAlert, UserRoundPen } from "lucide-react";
import { FormEvent, useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";

import { toast } from "@/app/components/Notice";
import { api } from "@/app/lib/api";
import type { AdminJump, Application, Bootstrap, Room, Student } from "@/app/lib/types";
import { ApplicationReviewPanel } from "./ApplicationReviewPanel";
import { applicationChecks, type Teacher } from "./application-checks";
import { StudentFormFields, type StudentFormValues } from "./StudentFormFields";

type Delivery = { id: number; recipient: string; subject: string; status: string; error?: string | null; attempt_count: number; last_attempt_at?: string | null; created_at: string };
type Totals = Record<string, number>;
type TodoData = {
  applications: Application[]; incomplete: { total: number; items: Student[] }; failedMail: Delivery[];
  drafts: Room[]; rooms: Room[]; totals: Totals; options: Bootstrap; teachers: Teacher[];
};
type Navigate = (section: "students" | "rooms") => void;

function missingFields(student: Student): string[] {
  return [
    !student.student_no && "学号", !student.adviser && "导师", !student.enrollment_year && "年级",
    !student.program_level && "培养层次", !student.major_id && "教研中心",
  ].filter(Boolean) as string[];
}

function useTodoData(active: boolean) {
  const [data, setData] = useState<TodoData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [applications, incomplete, deliveries, rooms, overview, options, teachers] = await Promise.all([
        api<Application[]>("/api/admin/applications?application_status=pending"),
        api<{ total: number; items: Student[] }>("/api/admin/student-directory?incomplete_only=true&limit=8"),
        api<Delivery[]>("/api/admin/email-deliveries"),
        api<Room[]>("/api/admin/rooms"),
        api<{ totals: Totals }>("/api/admin/overview"),
        api<Bootstrap>("/api/admin/options"),
        api<Teacher[]>("/api/admin/teachers"),
      ]);
      setData({
        applications, incomplete, rooms, options, teachers, totals: overview.totals,
        failedMail: deliveries.filter((row) => row.status === "failed"),
        drafts: rooms.filter((room) => !room.is_virtual && (room.has_draft || !room.is_published)),
      });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "加载待办失败"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (active) void load(); }, [active, load]);
  return { data, error, loading, load };
}

function Facts({ totals }: { totals: Totals }) {
  return <p className="todo-facts">{totals.rooms} 间房 · {totals.seats} 个工位 · {totals.available} 个空位 · {totals.occupied} 人在位</p>;
}

async function retryMail(id: number, reload: () => void) {
  try { await api(`/api/admin/email-deliveries/${id}/retry`, { method: "POST" }); toast("邮件已重新发送"); }
  catch (caught) { toast(caught instanceof Error ? caught.message : "重试失败", "error"); }
  reload();
}

function summary(data: TodoData): string {
  return [
    data.applications.length && `${data.applications.length} 份申请`, data.failedMail.length && `${data.failedMail.length} 封邮件未发出`,
    data.incomplete.total && `${data.incomplete.total} 人资料待补全`, data.drafts.length && `${data.drafts.length} 个房间未发布`,
  ].filter(Boolean).join(" · ");
}

function Heading({ data, loading, onRefresh }: { data: TodoData; loading: boolean; onRefresh: () => void }) {
  return (
    <header className="page-heading">
      <div className="todo-title"><h1>待办</h1><span>{summary(data)}</span></div>
      <button className="secondary-action" disabled={loading} onClick={onRefresh}><RefreshCw size={16} className={loading ? "spin" : ""} />刷新</button>
    </header>
  );
}

type Pick = { kind: "application" | "mail" | "student" | "draft"; id: number };

export function AdminInbox({ active, jump, onNavigate, onJump }: {
  active: boolean; jump: Extract<AdminJump, { section: "overview" }> | null; onNavigate: Navigate; onJump: (target: AdminJump) => void;
}) {
  const { data, error, loading, load } = useTodoData(active);
  const [picked, setPicked] = useState<Pick | null>(null);
  // A search result opens its application; the list may predate it, so reload if it is missing.
  const openJump = useEffectEvent((applicationId: number) => {
    setPicked({ kind: "application", id: applicationId });
    if (data && !data.applications.some((entry) => entry.id === applicationId)) void load();
  });
  useEffect(() => { if (jump) openJump(jump.applicationId); }, [jump]);
  const items = useMemo<Pick[]>(() => data ? [
    ...data.applications.map((entry) => ({ kind: "application" as const, id: entry.id })),
    ...data.failedMail.map((entry) => ({ kind: "mail" as const, id: entry.id })),
    ...data.incomplete.items.map((entry) => ({ kind: "student" as const, id: entry.id })),
    ...data.drafts.map((entry) => ({ kind: "draft" as const, id: entry.id })),
  ] : [], [data]);
  useEffect(() => {
    if (!items.length) { setPicked(null); return; }
    setPicked((current) => current && items.some((item) => item.kind === current.kind && item.id === current.id) ? current : items[0]);
  }, [items]);
  if (!data) return <div className="admin-page">{error ? <div className="central-message error"><CircleAlert />{error}</div> : <div className="central-message"><RefreshCw className="spin" />正在加载待办…</div>}</div>;
  const is = (kind: Pick["kind"], id: number) => picked?.kind === kind && picked.id === id;
  const application = picked?.kind === "application" ? data.applications.find((entry) => entry.id === picked.id) : undefined;
  const mail = picked?.kind === "mail" ? data.failedMail.find((entry) => entry.id === picked.id) : undefined;
  const student = picked?.kind === "student" ? data.incomplete.items.find((entry) => entry.id === picked.id) : undefined;
  const draft = picked?.kind === "draft" ? data.drafts.find((entry) => entry.id === picked.id) : undefined;

  return (
    <div className="admin-page todo-page">
      <Heading data={data} loading={loading} onRefresh={load} />
      {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}
      {!items.length ? <div className="empty-state admin-empty"><Check /><h2>没有需要处理的事</h2><p>新的申请、发送失败的邮件和待补全的资料会出现在这里。</p></div> : (
        <div className="inbox-layout">
          <nav className="inbox-list" aria-label="待办事项">
            {data.applications.length > 0 && <h2><Inbox size={14} />申请<span>{data.applications.length}</span></h2>}
            {data.applications.map((entry) => {
              const room = data.rooms.find((candidate) => candidate.id === entry.seat.room_id);
              const warn = applicationChecks(entry, entry.original_data, data.options, data.teachers, room, data.applications).some((check) => !check.ok);
              return <button key={`a${entry.id}`} aria-pressed={is("application", entry.id)} onClick={() => setPicked({ kind: "application", id: entry.id })}>
                <strong>{String(entry.original_data.name)}</strong><span>{entry.seat.room_name} · 工位 {entry.seat.code}</span>{warn && <TriangleAlert className="inbox-warn" size={14} aria-label="有需要留意的核对项" />}
              </button>;
            })}
            {data.failedMail.length > 0 && <h2><Mail size={14} />邮件发送失败<span>{data.failedMail.length}</span></h2>}
            {data.failedMail.map((entry) => <button key={`m${entry.id}`} aria-pressed={is("mail", entry.id)} onClick={() => setPicked({ kind: "mail", id: entry.id })}><strong>{entry.recipient.split("@")[0]}</strong><span>{entry.subject}</span></button>)}
            {data.incomplete.total > 0 && <h2><UserRoundPen size={14} />资料待补全<span>{data.incomplete.total}</span></h2>}
            {data.incomplete.items.map((entry) => <button key={`s${entry.id}`} aria-pressed={is("student", entry.id)} onClick={() => setPicked({ kind: "student", id: entry.id })}><strong>{entry.name}</strong><span>缺 {missingFields(entry).join("、")}</span></button>)}
            {data.incomplete.total > data.incomplete.items.length && <button className="inbox-more" onClick={() => onNavigate("students")}>在名册中查看其余 {data.incomplete.total - data.incomplete.items.length} 人</button>}
            {data.drafts.length > 0 && <h2><FileClock size={14} />布局未发布<span>{data.drafts.length}</span></h2>}
            {data.drafts.map((entry) => <button key={`d${entry.id}`} aria-pressed={is("draft", entry.id)} onClick={() => setPicked({ kind: "draft", id: entry.id })}><strong>{entry.name}</strong><span>{entry.is_published ? "有未发布的草稿" : "尚未发布"}</span></button>)}
          </nav>
          <div className="inbox-detail">
            {application && <ApplicationReviewPanel application={application} options={data.options} rooms={data.rooms} teachers={data.teachers} pending={data.applications} onReviewed={load} />}
            {mail && <section className="review-panel">
              <header className="review-panel-head"><div><h2>{mail.subject}</h2><p>发给 {mail.recipient} · 已尝试 {mail.attempt_count} 次</p></div></header>
              <ul className="review-checks"><li className="warn"><TriangleAlert size={15} /><span>{mail.error || "发送失败"}<small>检查“系统设置 → 邮箱设置”后重试。</small></span></li></ul>
              <div className="review-panel-actions"><button className="primary-action" onClick={() => retryMail(mail.id, load)}>重新发送</button></div>
            </section>}
            {student && <StudentQuickFix key={student.id} student={student} options={data.options} onSaved={load} onOpen={() => onJump({ section: "students", query: student.name, studentId: student.id })} />}
            {draft && <section className="review-panel">
              <header className="review-panel-head"><div><h2>房间 {draft.name}</h2><p>{draft.is_published ? "有已保存但未发布的布局草稿，学生端仍显示旧布局。" : "这个房间还没有发布，学生端看不到。"}</p></div></header>
              <div className="review-panel-actions"><button className="primary-action" onClick={() => onJump({ section: "rooms", roomId: draft.id })}>打开房间</button></div>
            </section>}
          </div>
        </div>
      )}
      <Facts totals={data.totals} />
    </div>
  );
}

function StudentQuickFix({ student, options, onSaved, onOpen }: { student: Student; options: Bootstrap; onSaved: () => void; onOpen: () => void }) {
  const [form, setForm] = useState<StudentFormValues>({
    name: student.name, student_no: student.student_no ?? "", adviser: student.adviser ?? "", enrollment_year: student.enrollment_year ? String(student.enrollment_year) : "",
    program_level: student.program_level ?? "", major_id: student.major_id ? String(student.major_id) : "", note: student.note ?? "",
  });
  const [busy, setBusy] = useState(false);
  const value = (text: string) => text.trim() || null;
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      await api(`/api/admin/students/${student.id}`, { method: "PATCH", body: JSON.stringify({
        name: form.name.trim(), student_no: value(form.student_no), adviser: value(form.adviser),
        enrollment_year: form.enrollment_year ? Number(form.enrollment_year) : null, program_level: value(form.program_level),
        major_id: form.major_id ? Number(form.major_id) : null, note: value(form.note),
      }) });
      toast(`${form.name} 的资料已保存`); onSaved();
    } catch (caught) { toast(caught instanceof Error ? caught.message : "保存失败", "error"); }
    finally { setBusy(false); }
  };
  return (
    <form className="review-panel" onSubmit={save}>
      <header className="review-panel-head"><div><h2>{student.name}<small>{student.student_no || "无学号"}</small></h2><p>{student.current_assignment ? `${student.current_assignment.room_name} · 工位 ${student.current_assignment.seat_code}` : "未分配工位"} · 缺 {missingFields(student).join("、")}</p></div>
        <button type="button" className="text-action" onClick={onOpen}>在名册中打开</button></header>
      <div className="review-panel-edit"><StudentFormFields form={form} onChange={(patch) => setForm({ ...form, ...patch })} options={options} /></div>
      <div className="review-panel-actions"><button className="primary-action" disabled={busy}>保存并处理下一个</button></div>
    </form>
  );
}
