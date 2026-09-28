"use client";

import {
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  UserRoundCheck,
  UserRoundX,
  X,
} from "lucide-react";
import { FormEvent, Fragment, useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/app/lib/api";
import type { Bootstrap, Student } from "@/app/lib/types";

import { DetailDialog } from "../DetailDialog";
import { StudentProfile } from "../StudentProfile";
import { emptyStudentForm, StudentFormFields, type StudentFormValues } from "./StudentFormFields";

type StudentForm = StudentFormValues & { seat_id: string };

const blank: StudentForm = { ...emptyStudentForm, seat_id: "" };

export function AdminStudents({ active = true }: { active?: boolean }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [freeSeats, setFreeSeats] = useState<Array<{ id: string; label: string }>>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<Student | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);
  const [detailTab, setDetailTab] = useState("profile");
  const requestId = useRef(0);
  const [options, setOptions] = useState<Bootstrap | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [placement, setPlacement] = useState("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<StudentForm>(blank);
  const [editForm, setEditForm] = useState<StudentFormValues | null>(null);
  const [moveSeat, setMoveSeat] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ offset: String(page * 30), limit: "30", q: query, placement, incomplete_only: String(incompleteOnly) });
      const rows = await api<{ items: Student[]; total: number }>(`/api/admin/student-directory?${params}`);
      if (request !== requestId.current) return;
      setStudents(rows.items); setTotal(rows.total);
      if (page > 0 && page * 30 >= rows.total) setPage(Math.max(0, Math.ceil(rows.total / 30) - 1));
      setSelectedId((id) => rows.items.some((item) => item.id === id) ? id : null);
      setDetailVersion((version) => version + 1);
    } catch (caught) {
      if (request === requestId.current) setError(caught instanceof Error ? caught.message : "加载学生失败");
    } finally { if (request === requestId.current) setLoading(false); }
  }, [incompleteOnly, page, query, placement]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => { void load(); }, 180);
    return () => { clearTimeout(timer); requestId.current += 1; };
  }, [load, active]);
  useEffect(() => {
    const controller = new AbortController();
    if (!active) return;
    api<Bootstrap>("/api/admin/options", { signal: controller.signal }).then(setOptions).catch((caught) => { if (!controller.signal.aborted) setError(caught.message); });
    return () => controller.abort();
  }, [active]);
  useEffect(() => {
    if (!showCreate && !selectedId) return;
    const controller = new AbortController();
    api<Array<{ id: string; label: string }>>("/api/admin/available-seats", { signal: controller.signal }).then(setFreeSeats).catch((caught) => { if (!controller.signal.aborted) setError(caught.message); });
    return () => controller.abort();
  }, [showCreate, selectedId, detailVersion]);
  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    api<Student>(`/api/admin/students/${selectedId}`, { signal: controller.signal }).then(setDetail).catch((caught) => { if (!controller.signal.aborted) setError(caught.message); });
    return () => controller.abort();
  }, [selectedId, detailVersion]);
  const filtered = students;
  const selected = detail?.id === selectedId ? detail : students.find((student) => student.id === selectedId);

  const value = (text: string) => text.trim() || null;
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    setError("");
    try {
      await api("/api/admin/students", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          student_no: value(form.student_no),
          adviser: value(form.adviser),
          enrollment_year: form.enrollment_year ? Number(form.enrollment_year) : null,
          program_level: value(form.program_level),
          major_id: form.major_id ? Number(form.major_id) : null,
          seat_id: value(form.seat_id),
        }),
      });
      setMessage("学生已录入");
      setForm(blank);
      setShowCreate(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "录入失败");
    } finally { busyRef.current = false; setBusy(false); }
  };

  const beginEdit = () => {
    if (!selected) return;
    setEditForm({
      name: selected.name,
      student_no: selected.student_no ?? "",
      adviser: selected.adviser ?? "",
      enrollment_year: selected.enrollment_year ? String(selected.enrollment_year) : "",
      program_level: selected.program_level ?? "",
      major_id: selected.major_id ? String(selected.major_id) : "",
    });
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !editForm || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    setError("");
    try {
      await api(`/api/admin/students/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          student_no: value(editForm.student_no),
          adviser: value(editForm.adviser),
          enrollment_year: editForm.enrollment_year ? Number(editForm.enrollment_year) : null,
          program_level: value(editForm.program_level),
          major_id: editForm.major_id ? Number(editForm.major_id) : null,
        }),
      });
      setMessage("学生资料已更新");
      setEditForm(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新失败");
    } finally { busyRef.current = false; setBusy(false); }
  };

  const move = async () => {
    if (!selected || !moveSeat || busyRef.current) return;
    const target = freeSeats.find((seat) => seat.id === moveSeat)?.label ?? "所选工位";
    const original = selected.current_assignment
      ? `${selected.current_assignment.room_name} · ${selected.current_assignment.seat_code}`
      : "未分配";
    if (!confirm(`确认把 ${selected.name} 从“${original}”调整到“${target}”？`)) return;
    busyRef.current = true; setBusy(true);
    try {
      await api(`/api/admin/students/${selected.id}/move`, {
        method: "POST",
        body: JSON.stringify({ seat_id: moveSeat }),
      });
      setMessage("工位已更新");
      setMoveSeat("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "移动失败");
    } finally { busyRef.current = false; setBusy(false); }
  };

  const release = async () => {
    if (!selected || busyRef.current || !confirm(`释放 ${selected.name} 的当前工位？`)) return;
    busyRef.current = true; setBusy(true);
    try {
      await api(`/api/admin/students/${selected.id}/release`, { method: "POST" });
      setMessage("工位已释放");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "释放失败");
    } finally { busyRef.current = false; setBusy(false); }
  };

  return (
    <div className="admin-page">
      <header className="page-heading">
        <h1>学生名册</h1>
        <div className="heading-actions">
          <button className="secondary-action" disabled={loading} onClick={load}><RefreshCw size={16} className={loading ? "spin" : ""} />刷新</button>
          <button disabled={busy} className="primary-action compact" onClick={() => { setError(""); setShowCreate(true); }}><Plus size={16} />直接录入</button>
        </div>
      </header>
      {error && !showCreate && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}
      {message && <p className="success-banner"><UserRoundCheck size={16} />{message}</p>}

      <fieldset disabled={busy}>
      <div className="student-tools">
        <label className="search-field"><Search size={16} /><input aria-label="搜索学生" placeholder="搜索姓名、学号或导师" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} /></label>
        <select aria-label="工位分组" value={placement} onChange={(event) => { setPlacement(event.target.value); setPage(0); }}><option value="">全部工位分组</option><option value="physical">实际工位</option><option value="翔安">翔安</option><option value="未被分配">未被分配</option></select>
        <label className="check-control"><input type="checkbox" checked={incompleteOnly} onChange={(event) => { setIncompleteOnly(event.target.checked); setPage(0); }} />只看信息待补全</label>
      </div>

      <section className="seat-table-wrap student-table">
        <table className="data-table student-data-table">
          <thead><tr><th>学生</th><th>导师</th><th>教研中心</th><th>当前工位</th><th>资料</th><th /></tr></thead>
          <tbody>
            {!filtered.length && <tr><td colSpan={6} className="table-empty">{loading ? "正在加载学生…" : "没有匹配的学生"}</td></tr>}
            {filtered.map((student) => {
              const expanded = selectedId === student.id;
              return (
                <Fragment key={student.id}>
                  <tr
                    className={expanded ? "selected" : ""}
                    onClick={() => {
                      if (busy) return;
                      setSelectedId(expanded ? null : student.id);
                      setDetailTab("profile"); setDetail(null);
                      setEditForm(null);
                      setMoveSeat("");
                    }}
                  >
                    <td><strong>{student.name}</strong><small>{student.student_no || "无学号"}</small></td>
                    <td>{student.adviser || "—"}</td>
                    <td>{student.major || "—"}</td>
                    <td>{student.current_assignment ? `${student.current_assignment.room_name} · ${student.current_assignment.seat_code}` : "未分配"}</td>
                    <td>{student.is_complete ? <span className="state-label available"><i />完整</span> : <span className="state-label pending"><i />待补全</span>}</td>
                    <td><button className="row-expand" aria-label={expanded ? "收起学生信息" : "展开学生信息"} aria-expanded={expanded}>{expanded ? <ChevronUp /> : <ChevronDown />}</button></td>
                  </tr>
                  {expanded && selected && (
                    <tr className="student-expanded-row">
                      <td colSpan={6} onClick={(event) => event.stopPropagation()}>
                        <div className="student-detail-tabs" role="group" aria-label="学生详情">
                          {[['profile', '学生资料'], ['seat', '调整工位'], ['history', '分配历史']].map(([id, label]) => <button key={id} aria-pressed={detailTab === id} onClick={() => setDetailTab(id)}>{label}</button>)}
                        </div>
                        <div className="inline-student-detail">
                          <section className="student-profile-section" hidden={detailTab !== "profile"}>
                            <header>
                              <div><strong>{editForm ? `编辑 ${selected.name} 的资料` : "基本资料"}</strong></div>
                              <button className="detail-edit" onClick={() => editForm ? setEditForm(null) : beginEdit()}>{editForm ? <X size={15} /> : <Pencil size={15} />}{editForm ? "取消" : "修改资料"}</button>
                            </header>
                            {editForm ? (
                              <form className="edit-student-form" onSubmit={saveEdit}>
                                <StudentFormFields form={editForm} onChange={(patch) => setEditForm({ ...editForm, ...patch })} options={options} />
                                <button className="primary-action compact"><Save size={15} />保存资料</button>
                              </form>
                            ) : (
                              <StudentProfile person={selected} location={selected.current_assignment ? `${selected.current_assignment.room_name} · 工位 ${selected.current_assignment.seat_code}` : "暂未分配工位"} />
                            )}
                          </section>
                          <section className="move-panel" hidden={detailTab !== "seat"}>
                            <h3><ArrowRightLeft size={16} />修改工位</h3>
                            <select aria-label="目标工位" value={moveSeat} onChange={(event) => setMoveSeat(event.target.value)}><option value="">选择一个空闲工位</option>{freeSeats.map((seat) => <option key={seat.id} value={seat.id}>{seat.label}</option>)}</select>
                            <button disabled={!moveSeat} onClick={move}>确认移动</button>
                            {selected.current_assignment && <button className="danger-plain" onClick={release}><UserRoundX size={16} />释放当前工位</button>}
                          </section>
                          <section className="history-list" hidden={detailTab !== "history"}>
                            <h3>分配历史</h3>
                            {selected.history.length ? selected.history.map((row) => (
                              <div key={row.id}><span>{row.room} · {row.seat}</span><small>{new Date(row.started_at).toLocaleDateString("zh-CN")} — {row.ended_at ? new Date(row.ended_at).toLocaleDateString("zh-CN") : "现在"}</small></div>
                            )) : <p>{detail?.id === selectedId ? "暂无分配记录" : "正在加载分配历史…"}</p>}
                          </section>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </section>
      <div className="pagination"><span>{loading ? "更新中…" : `共 ${total} 名学生`}</span><button disabled={loading || page === 0} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {Math.max(1, Math.ceil(total / 30))}</span><button disabled={loading || (page + 1) * 30 >= total} onClick={() => setPage(page + 1)}>下一页</button></div>

      </fieldset>
      {showCreate && (
        <DetailDialog label="直接录入学生" wide onClose={() => { if (!busy) setShowCreate(false); }}>
          <form className="dialog-form" onSubmit={create} aria-busy={busy}>
            <div className="drawer-heading"><div><p>学生名册</p><h2>直接录入学生</h2></div></div>
            <p className="form-hint">除姓名外，其他信息可以稍后补全。</p>
            {error && <p className="form-error"><CircleAlert size={16} />{error}</p>}
            <fieldset disabled={busy}>
              <StudentFormFields form={form} onChange={(patch) => setForm({ ...form, ...patch })} options={options} />
              <label><span>直接分配工位</span><select value={form.seat_id} onChange={(event) => setForm({ ...form, seat_id: event.target.value })}><option value="">未被分配（虚拟工位）</option>{freeSeats.map((seat) => <option key={seat.id} value={seat.id}>{seat.label}</option>)}</select></label>
              <div className="form-actions"><button className="primary-action compact">{busy ? "正在保存…" : "保存学生"}</button><button type="button" className="secondary-action compact" onClick={() => setShowCreate(false)}>取消</button></div>
            </fieldset>
          </form>
        </DetailDialog>
      )}
    </div>
  );
}
