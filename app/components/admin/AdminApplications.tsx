"use client";

import { Check, CircleAlert, Inbox, Mail, RefreshCw, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "@/app/lib/api";
import type { Application, Bootstrap, Room } from "@/app/lib/types";
import { RoomPlan } from "../RoomPlan";
import { DerivedEmail } from "./StudentFormFields";

type ReviewData = {
  name: string;
  student_no: string;
  adviser: string;
  email: string;
  enrollment_year: string;
  program_level: string;
  major_id: string;
};

export function AdminApplications({ active = true }: { active?: boolean }) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [options, setOptions] = useState<Bootstrap | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [form, setForm] = useState<ReviewData | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");

  const load = async () => {
    setError("");
    try {
      const [apps, roomRows, bootstrap] = await Promise.all([
        api<Application[]>("/api/admin/applications?application_status=pending"),
        api<Room[]>("/api/admin/rooms"),
        api<Bootstrap>("/api/admin/options"),
      ]);
      setApplications(apps);
      setRooms(roomRows);
      setOptions(bootstrap);
      setSelectedId((current) => (apps.some((item) => item.id === current) ? current : apps[0]?.id ?? null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载申请失败");
    }
  };

  useEffect(() => { if (active) void load(); }, [active]);
  const selected = applications.find((item) => item.id === selectedId);
  useEffect(() => {
    if (!selected) return setForm(null);
    const data = selected.reviewed_data ?? selected.original_data;
    setForm({
      name: String(data.name ?? ""), student_no: String(data.student_no ?? selected.student_no), adviser: String(data.adviser ?? ""),
      email: String(data.email ?? ""), enrollment_year: String(data.enrollment_year ?? ""), program_level: String(data.program_level ?? "硕士"), major_id: String(data.major_id ?? ""),
    });
    setReason(selected.rejection_reason ?? "");
    setResult("");
  }, [selected]);

  const selectedRoom = useMemo(() => rooms.find((room) => room.id === selected?.seat.room_id), [rooms, selected]);
  const originalHint = (key: string, current: string, format?: (value: string) => string | undefined) => {
    if (!selected) return null;
    const original = String(selected.original_data[key] ?? "");
    if (original === String(current)) return null;
    return <small className="original-value">原始：{format?.(original) ?? (original || "空")}</small>;
  };
  const review = async (action: "approve" | "reject") => {
    if (!selected || !form) return;
    const seat = `${selected.seat.room_name} · 工位 ${selected.seat.code}`;
    const question = action === "approve"
      ? `同意 ${form.name} 的申请，并把 ${seat} 分配给该学生？结果会通过邮件通知。`
      : `拒绝 ${form.name} 对 ${seat} 的申请？${reason.trim() ? "拒绝原因会随邮件发送给学生。" : "没有填写拒绝原因，邮件中将不包含原因。"}`;
    if (!window.confirm(question)) return;
    setBusy(true); setError(""); setResult("");
    try {
      const response = await api<{ status: string; email_status: string }>(`/api/admin/applications/${selected.id}/review`, {
        method: "POST",
        body: JSON.stringify({
          action,
          data: { ...form, enrollment_year: Number(form.enrollment_year), major_id: Number(form.major_id) },
          rejection_reason: reason,
        }),
      });
      setResult(`${action === "approve" ? "已通过" : "已拒绝"}，邮件${response.email_status === "sent" ? "已发送" : "发送失败，可在设置中重试"}`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审批失败");
    } finally { setBusy(false); }
  };

  return (
    <div className="admin-page">
      <header className="page-heading"><h1>申请审批</h1><button className="secondary-action" onClick={load}><RefreshCw size={16} />刷新</button></header>
      {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}
      {result && <p className="success-banner"><Mail size={16} />{result}</p>}
      {!applications.length ? (
        <div className="empty-state admin-empty"><Inbox /><h2>没有待审批申请</h2><p>新的学生申请会出现在这里。</p></div>
      ) : (
        <div className="review-layout">
          <section className="review-list flat-section">
            <header><h2>等待处理</h2><span>{applications.length}</span></header>
            {applications.map((item) => (
              <button key={item.id} className={selectedId === item.id ? "active" : ""} aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}>
                <span className="review-avatar">{String(item.original_data.name ?? "?").slice(0, 1)}</span>
                <span><strong>{String(item.original_data.name)}</strong><small>{item.seat.room_name} · {item.seat.code} 号</small></span>
                <time>{new Date(item.submitted_at).toLocaleDateString("zh-CN")}</time>
              </button>
            ))}
          </section>
          {selected && form && (
            <section className="review-detail">
              {/* The same SVG plan students and the room workbench use, so the seat looks identical everywhere. */}
              {selectedRoom && <div className="review-map"><RoomPlan room={selectedRoom} query="" onSelect={() => undefined} selectedId={selected.seat.id} /></div>}
              <form className="review-form" onSubmit={(event: FormEvent) => event.preventDefault()}>
                <header><div><p>申请位置</p><h2>{selected.seat.room_name} · 工位 {selected.seat.code}</h2></div><span className="state-label pending"><i />审核中</span></header>
                <div className="field-grid two">
                  <label><span>姓名</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />{originalHint("name", form.name)}</label>
                  <label><span>学号</span><input value={form.student_no} onChange={(e) => setForm({ ...form, student_no: e.target.value })} />{originalHint("student_no", form.student_no)}</label>
                </div>
                <label><span>导师全名</span><input value={form.adviser} onChange={(e) => setForm({ ...form, adviser: e.target.value })} />{originalHint("adviser", form.adviser)}</label>
                <div className="field-grid three">
                  <label><span>年级</span><select value={form.enrollment_year} onChange={(e) => setForm({ ...form, enrollment_year: e.target.value })}>{options?.years.map((year) => <option key={year}>{year}</option>)}</select>{originalHint("enrollment_year", form.enrollment_year)}</label>
                  <label><span>培养层次</span><select value={form.program_level} onChange={(e) => setForm({ ...form, program_level: e.target.value })}>{options?.program_levels.map((level) => <option key={level}>{level}</option>)}</select>{originalHint("program_level", form.program_level)}</label>
                  <label><span>教研中心</span><select value={form.major_id} onChange={(e) => setForm({ ...form, major_id: e.target.value })}>{options?.majors.map((major) => <option key={major.id} value={major.id}>{major.name}</option>)}</select>{originalHint("major_id", form.major_id, (value) => options?.majors.find((major) => String(major.id) === value)?.name)}</label>
                </div>
                <DerivedEmail studentNo={form.student_no} />
                <label><span>拒绝原因（可留空）</span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="填写后会随结果邮件发送给学生" /></label>
                <div className="review-actions"><button type="button" className="danger-action" disabled={busy} onClick={() => review("reject")}><X size={17} />拒绝</button><button type="button" className="primary-action" disabled={busy} onClick={() => review("approve")}><Check size={17} />同意并分配</button></div>
              </form>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
