"use client";

// Reviews one application read-only: the facts, what the checks found, then approve or reject.
// Editing the applicant's details is a deliberate extra step.
import { Check, CircleAlert, MapPin, Pencil, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { toast } from "@/app/components/Notice";
import { Select } from "@/app/components/Select";
import { api } from "@/app/lib/api";
import type { Application, Bootstrap, Room } from "@/app/lib/types";
import { RoomPlan } from "../RoomPlan";
import { applicationChecks, type Teacher } from "./application-checks";
import { DerivedEmail, studentEmail } from "./StudentFormFields";

type ReviewData = { name: string; student_no: string; adviser: string; email: string; enrollment_year: string; program_level: string; major_id: string };

function formFrom(application: Application): ReviewData {
  const data = application.reviewed_data ?? application.original_data;
  return {
    name: String(data.name ?? ""), student_no: String(data.student_no ?? application.student_no), adviser: String(data.adviser ?? ""),
    email: String(data.email ?? ""), enrollment_year: String(data.enrollment_year ?? ""), program_level: String(data.program_level ?? "硕士"), major_id: String(data.major_id ?? ""),
  };
}

export function ApplicationReviewPanel({ application, options, rooms, teachers, pending, onReviewed }: {
  application: Application; options: Bootstrap | null; rooms: Room[]; teachers: Teacher[]; pending: Application[];
  onReviewed: () => void;
}) {
  const [form, setForm] = useState<ReviewData>(() => formFrom(application));
  const [editing, setEditing] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setForm(formFrom(application)); setEditing(false); setRejecting(false); setReason(""); setError(""); setShowMap(false); }, [application]);

  const room = rooms.find((entry) => entry.id === application.seat.room_id);
  const majorName = (id: string) => options?.majors.find((major) => String(major.id) === id)?.name ?? "—";
  const checks = useMemo(() => applicationChecks(application, form, options, teachers, room, pending), [application, form, options, teachers, room, pending]);
  const warnings = checks.filter((check) => !check.ok).length;
  const changed = (key: keyof ReviewData) => String(application.original_data[key] ?? "") !== form[key];
  const seat = `${application.seat.room_name} · 工位 ${application.seat.code}`;

  const review = async (action: "approve" | "reject") => {
    setBusy(true); setError("");
    try {
      const response = await api<{ email_status: string }>(`/api/admin/applications/${application.id}/review`, {
        method: "POST",
        body: JSON.stringify({ action, data: { ...form, enrollment_year: Number(form.enrollment_year), major_id: Number(form.major_id) }, rejection_reason: reason }),
      });
      const mail = response.email_status === "sent" ? "通知邮件已发送。" : "通知邮件未发出，可在待办里重试。";
      toast(action === "approve" ? `已同意 ${form.name}，${seat} 已分配。${mail}` : `已拒绝 ${form.name} 的申请。${mail}`, response.email_status === "sent" ? "success" : "error");
      onReviewed();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "审批失败");
    } finally { setBusy(false); }
  };

  return (
    <section className="review-panel" aria-label={`${form.name} 的申请`}>
      <header className="review-panel-head">
        <div>
          <h2>{form.name}<small>{form.student_no}</small></h2>
          <p>申请 <strong>{seat}</strong> · {new Date(application.submitted_at).toLocaleDateString("zh-CN")} 提交</p>
        </div>
        <button className="text-action" onClick={() => setShowMap(!showMap)}><MapPin size={15} />{showMap ? "收起平面图" : "在平面图中查看"}</button>
      </header>

      {showMap && room && <div className="review-panel-map"><RoomPlan room={room} onSelect={() => undefined} selectedId={application.seat.id} /></div>}

      {editing ? (
        <div className="review-panel-edit">
          <div className="field-grid two">
            <label><span>姓名</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label><span>学号</span><input value={form.student_no} onChange={(e) => setForm({ ...form, student_no: e.target.value, email: studentEmail(e.target.value) })} /></label>
          </div>
          <label><span>导师全名</span><input value={form.adviser} onChange={(e) => setForm({ ...form, adviser: e.target.value })} /></label>
          <div className="field-grid three">
            <label><span>年级</span><Select value={form.enrollment_year} onChange={(value) => setForm({ ...form, enrollment_year: value })} options={(options?.years ?? []).map((year) => ({ value: String(year), label: String(year) }))} /></label>
            <label><span>培养层次</span><Select value={form.program_level} onChange={(value) => setForm({ ...form, program_level: value })} options={(options?.program_levels ?? []).map((level) => ({ value: level, label: level }))} /></label>
            <label><span>教研中心</span><Select value={form.major_id} onChange={(value) => setForm({ ...form, major_id: value })} options={(options?.majors ?? []).map((major) => ({ value: String(major.id), label: major.name }))} /></label>
          </div>
          <DerivedEmail studentNo={form.student_no} />
          <div><button className="secondary-action compact" onClick={() => setEditing(false)}>完成修改</button></div>
        </div>
      ) : (
        <dl className="review-facts">
          <div><dt>导师</dt><dd>{form.adviser || "—"}{changed("adviser") && <small>已改，原为 {String(application.original_data.adviser ?? "空")}</small>}</dd></div>
          <div><dt>教研中心</dt><dd>{majorName(form.major_id)}{changed("major_id") && <small>已改</small>}</dd></div>
          <div><dt>年级</dt><dd>{form.enrollment_year || "—"}</dd></div>
          <div><dt>培养层次</dt><dd>{form.program_level || "—"}</dd></div>
          <div className="wide"><dt>邮箱</dt><dd>{studentEmail(form.student_no)}</dd></div>
        </dl>
      )}

      <ul className="review-checks" aria-label="自动核对">
        {checks.map((check) => (
          <li key={check.text} className={check.ok ? "ok" : "warn"}>
            {check.ok ? <Check size={15} /> : <TriangleAlert size={15} />}
            <span>{check.text}{check.hint && <small>{check.hint}</small>}</span>
          </li>
        ))}
      </ul>

      {error && <p className="form-error"><CircleAlert size={16} />{error}</p>}

      {rejecting ? (
        <div className="review-reject">
          <label><span>拒绝原因（会写进通知邮件，可留空）</span><textarea rows={3} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：导师姓名有误，请核对后重新申请" /></label>
          <div className="review-panel-actions">
            <button className="danger-action solid" disabled={busy} onClick={() => review("reject")}><X size={16} />确认拒绝</button>
            <button className="secondary-action" disabled={busy} onClick={() => setRejecting(false)}>取消</button>
          </div>
        </div>
      ) : (
        <div className="review-panel-actions">
          <button className="primary-action" disabled={busy} onClick={() => review("approve")}><Check size={16} />{warnings ? "仍然同意并分配" : "同意并分配"}</button>
          <button className="danger-action" disabled={busy} onClick={() => setRejecting(true)}>拒绝…</button>
          {!editing && <button className="secondary-action" disabled={busy} onClick={() => setEditing(true)}><Pencil size={15} />修改资料</button>}
        </div>
      )}
    </section>
  );
}
