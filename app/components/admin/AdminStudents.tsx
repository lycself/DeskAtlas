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
import { FormEvent, Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/app/lib/api";
import { getFloorLabel, sortRooms } from "@/app/lib/rooms";
import type { Bootstrap, Room, Student } from "@/app/lib/types";

type StudentForm = {
  name: string;
  student_no: string;
  adviser: string;
  email: string;
  enrollment_year: string;
  program_level: string;
  major_id: string;
  seat_id: string;
};
type EditStudentForm = Omit<StudentForm, "seat_id">;

const blank: StudentForm = {
  name: "",
  student_no: "",
  adviser: "",
  email: "",
  enrollment_year: "",
  program_level: "",
  major_id: "",
  seat_id: "",
};

export function AdminStudents() {
  const [students, setStudents] = useState<Student[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [options, setOptions] = useState<Bootstrap | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<StudentForm>(blank);
  const [editForm, setEditForm] = useState<EditStudentForm | null>(null);
  const [moveSeat, setMoveSeat] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [studentRows, roomRows, bootstrap] = await Promise.all([
        api<Student[]>(`/api/admin/students${incompleteOnly ? "?incomplete_only=true" : ""}`),
        api<Room[]>("/api/admin/rooms"),
        api<Bootstrap>("/api/public/bootstrap"),
      ]);
      setStudents(studentRows);
      setRooms(sortRooms(roomRows));
      setOptions(bootstrap);
      setSelectedId((id) => (studentRows.some((item) => item.id === id) ? id : null));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载学生失败");
    }
  }, [incompleteOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = students.filter((student) =>
    `${student.name} ${student.student_no ?? ""} ${student.adviser ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected = students.find((student) => student.id === selectedId);
  const freeSeats = useMemo(
    () => rooms.flatMap((room) =>
      room.items
        .filter((item) => item.type === "seat" && item.seat?.display_state === "available")
        .map((item) => ({ id: item.id, label: `${getFloorLabel(room)} · ${room.name} · ${item.label}` })),
    ),
    [rooms],
  );

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const value = (text: string) => text.trim() || null;
    try {
      await api("/api/admin/students", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          student_no: value(form.student_no),
          adviser: value(form.adviser),
          email: value(form.email),
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
    }
  };

  const beginEdit = () => {
    if (!selected) return;
    setEditForm({
      name: selected.name,
      student_no: selected.student_no ?? "",
      adviser: selected.adviser ?? "",
      email: selected.email ?? "",
      enrollment_year: selected.enrollment_year ? String(selected.enrollment_year) : "",
      program_level: selected.program_level ?? "",
      major_id: selected.major_id ? String(selected.major_id) : "",
    });
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !editForm) return;
    setError("");
    const value = (text: string) => text.trim() || null;
    try {
      await api(`/api/admin/students/${selected.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: editForm.name.trim(),
          student_no: value(editForm.student_no),
          adviser: value(editForm.adviser),
          email: value(editForm.email),
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
    }
  };

  const move = async () => {
    if (!selected || !moveSeat) return;
    const target = freeSeats.find((seat) => seat.id === moveSeat)?.label ?? "所选工位";
    const original = selected.current_assignment
      ? `${selected.current_assignment.room_name} · ${selected.current_assignment.seat_code}`
      : "未分配";
    if (!confirm(`确认把 ${selected.name} 从“${original}”调整到“${target}”？`)) return;
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
    }
  };

  const release = async () => {
    if (!selected || !confirm(`释放 ${selected.name} 的当前工位？`)) return;
    try {
      await api(`/api/admin/students/${selected.id}/release`, { method: "POST" });
      setMessage("工位已释放");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "释放失败");
    }
  };

  return (
    <div className="admin-page">
      <header className="page-heading">
        <h1>学生与工位</h1>
        <button className="primary-action compact" onClick={() => setShowCreate(true)}><Plus size={16} />直接录入</button>
      </header>
      {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}
      {message && <p className="success-banner"><UserRoundCheck size={16} />{message}</p>}

      <div className="student-tools">
        <label className="search-field"><Search size={16} /><input placeholder="搜索姓名、学号或导师" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label className="check-control"><input type="checkbox" checked={incompleteOnly} onChange={(event) => setIncompleteOnly(event.target.checked)} />只看信息待补全</label>
        <button onClick={load}><RefreshCw size={15} />刷新</button>
      </div>

      <section className="seat-table-wrap student-table">
        <table className="data-table student-data-table">
          <thead><tr><th>学生</th><th>导师</th><th>专业</th><th>当前工位</th><th>资料</th><th /></tr></thead>
          <tbody>
            {filtered.map((student) => {
              const expanded = selectedId === student.id;
              return (
                <Fragment key={student.id}>
                  <tr
                    className={expanded ? "selected" : ""}
                    onClick={() => {
                      setSelectedId(expanded ? null : student.id);
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
                        <div className="inline-student-detail">
                          <section className="student-profile-section">
                            <header>
                              <span className="review-avatar large">{selected.name.slice(0, 1)}</span>
                              <div><h2>{selected.name}</h2><p>{selected.student_no || "尚未补录学号"}</p></div>
                              <button className="detail-edit" onClick={() => editForm ? setEditForm(null) : beginEdit()}>{editForm ? <X size={15} /> : <Pencil size={15} />}{editForm ? "取消" : "修改资料"}</button>
                            </header>
                            {editForm ? (
                              <form className="edit-student-form" onSubmit={saveEdit}>
                                <div className="field-grid two">
                                  <label><span>姓名</span><input required value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} /></label>
                                  <label><span>学号</span><input value={editForm.student_no} onChange={(event) => setEditForm({ ...editForm, student_no: event.target.value })} /></label>
                                  <label><span>导师全名</span><input value={editForm.adviser} onChange={(event) => setEditForm({ ...editForm, adviser: event.target.value })} /></label>
                                  <label><span>学生邮箱</span><input type="email" placeholder="name@stu.xmu.edu" value={editForm.email} onChange={(event) => setEditForm({ ...editForm, email: event.target.value })} /></label>
                                  <label><span>年级</span><select value={editForm.enrollment_year} onChange={(event) => setEditForm({ ...editForm, enrollment_year: event.target.value })}><option value="">待补全</option>{options?.years.map((year) => <option key={year}>{year}</option>)}</select></label>
                                  <label><span>培养层次</span><select value={editForm.program_level} onChange={(event) => setEditForm({ ...editForm, program_level: event.target.value })}><option value="">待补全</option>{options?.program_levels.map((level) => <option key={level}>{level}</option>)}</select></label>
                                </div>
                                <label><span>专业</span><select value={editForm.major_id} onChange={(event) => setEditForm({ ...editForm, major_id: event.target.value })}><option value="">待补全</option>{options?.majors.map((major) => <option key={major.id} value={major.id}>{major.name}</option>)}</select></label>
                                <button className="primary-action compact"><Save size={15} />保存资料</button>
                              </form>
                            ) : (
                              <dl>
                                <div><dt>导师</dt><dd>{selected.adviser || "未填写"}</dd></div>
                                <div><dt>年级</dt><dd>{selected.enrollment_year || "未填写"}</dd></div>
                                <div><dt>培养层次</dt><dd>{selected.program_level || "未填写"}</dd></div>
                                <div><dt>专业</dt><dd>{selected.major || "未填写"}</dd></div>
                                <div><dt>邮箱</dt><dd>{selected.email || "未填写"}</dd></div>
                              </dl>
                            )}
                          </section>
                          <section className="move-panel">
                            <h3><ArrowRightLeft size={16} />修改工位</h3>
                            <select value={moveSeat} onChange={(event) => setMoveSeat(event.target.value)}><option value="">选择一个空闲工位</option>{freeSeats.map((seat) => <option key={seat.id} value={seat.id}>{seat.label}</option>)}</select>
                            <button disabled={!moveSeat} onClick={move}>确认移动</button>
                            {selected.current_assignment && <button className="danger-plain" onClick={release}><UserRoundX size={16} />释放当前工位</button>}
                          </section>
                          <section className="history-list">
                            <h3>分配历史</h3>
                            {selected.history.length ? selected.history.map((row) => (
                              <div key={row.id}><span>{row.room} · {row.seat}</span><small>{new Date(row.started_at).toLocaleDateString("zh-CN")} — {row.ended_at ? new Date(row.ended_at).toLocaleDateString("zh-CN") : "现在"}</small></div>
                            )) : <p>暂无分配记录</p>}
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

      {showCreate && (
        <div className="modal-backdrop">
          <form className="modal-panel glass-surface" onSubmit={create}>
            <header><h2>直接录入学生</h2><button type="button" aria-label="关闭" onClick={() => setShowCreate(false)}>×</button></header>
            <p>除姓名外，其他信息可以稍后补全。</p>
            <div className="field-grid two">
              <label><span>姓名</span><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label><span>学号</span><input value={form.student_no} onChange={(event) => setForm({ ...form, student_no: event.target.value })} /></label>
            </div>
            <label><span>导师全名</span><input value={form.adviser} onChange={(event) => setForm({ ...form, adviser: event.target.value })} /></label>
            <label><span>学生邮箱</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <div className="field-grid three">
              <label><span>年级</span><select value={form.enrollment_year} onChange={(event) => setForm({ ...form, enrollment_year: event.target.value })}><option value="">待补全</option>{options?.years.map((year) => <option key={year}>{year}</option>)}</select></label>
              <label><span>培养层次</span><select value={form.program_level} onChange={(event) => setForm({ ...form, program_level: event.target.value })}><option value="">待补全</option>{options?.program_levels.map((level) => <option key={level}>{level}</option>)}</select></label>
              <label><span>专业</span><select value={form.major_id} onChange={(event) => setForm({ ...form, major_id: event.target.value })}><option value="">待补全</option>{options?.majors.map((major) => <option key={major.id} value={major.id}>{major.name}</option>)}</select></label>
            </div>
            <label><span>直接分配工位</span><select value={form.seat_id} onChange={(event) => setForm({ ...form, seat_id: event.target.value })}><option value="">暂不分配</option>{freeSeats.map((seat) => <option key={seat.id} value={seat.id}>{seat.label}</option>)}</select></label>
            <button className="primary-action">保存学生</button>
          </form>
        </div>
      )}
    </div>
  );
}
