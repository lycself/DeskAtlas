"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRightLeft, Pencil, Search, UserPlus } from "lucide-react";
import { api } from "@/app/lib/api";
import type { Bootstrap, LayoutItem, Student } from "@/app/lib/types";
import { StudentProfile } from "../StudentProfile";
import { emptyStudentForm, StudentFormFields, type StudentFormValues } from "./StudentFormFields";

type Props = {
  item: LayoutItem | null; roomName: string; virtual?: boolean; version: number;
  moving: Student | null; target: LayoutItem | null;
  onMove: (student: Student | null) => void; onUpdated: () => Promise<void>;
  onDirty: (dirty: boolean) => void; onBusy: (busy: boolean) => void;
};

export function SeatStudentPanel({ item, roomName, virtual, version, moving, target, onMove, onUpdated, onDirty, onBusy }: Props) {
  const [student, setStudent] = useState<Student | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const panel = useRef<HTMLElement>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<StudentFormValues>(emptyStudentForm);
  const [options, setOptions] = useState<Bootstrap | null>(null);
  const [query, setQuery] = useState("");
  const [allStudents, setAllStudents] = useState(false);
  const [results, setResults] = useState<Student[]>([]);
  const [candidate, setCandidate] = useState<Student | null>(null);
  const [status, setStatus] = useState("active");
  const [note, setNote] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api<Bootstrap>("/api/admin/options", { signal: controller.signal }).then(setOptions).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setStudent(null); setPending(null); setEditing(false); setCreating(false); setCandidate(null); setQuery(""); setError("");
    setStatus(item?.seat?.admin_status ?? "active"); setNote(item?.seat?.note ?? "");
    if (!item?.seat) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    api<{ student: Student | null; pending_application_id: number | null }>(`/api/admin/seats/${item.seat.id}/context`, { signal: controller.signal })
      .then((data) => { setStudent(data.student); setPending(data.pending_application_id); })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [item?.id, item?.seat, version]);
  useEffect(() => {
    if (!item?.seat || student || loading || creating || moving) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, placement: allStudents ? "" : "未被分配", limit: "8" });
      api<{ items: Student[] }>(`/api/admin/student-directory?${params}`, { signal: controller.signal })
        .then((data) => setResults(data.items)).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, allStudents, item?.seat, student, loading, creating, moving]);
  useEffect(() => {
    if (loading || (moving ? !target : !item)) return;
    if (window.matchMedia("(max-width: 1050px)").matches) panel.current?.scrollIntoView({ block: "nearest" });
  }, [item, moving, target, loading]);

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); onBusy(true); setError("");
    try { await operation(); onDirty(false); await onUpdated(); }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败，请重试"); }
    finally { setBusy(false); onBusy(false); }
  };
  const startEdit = () => {
    if (!student) return;
    setForm({ name: student.name, student_no: student.student_no ?? "", adviser: student.adviser ?? "",
      enrollment_year: String(student.enrollment_year ?? ""), program_level: student.program_level ?? "", major_id: String(student.major_id ?? "") });
    setEditing(true);
  };
  const change = (patch: Partial<StudentFormValues>) => { setForm({ ...form, ...patch }); onDirty(true); };
  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    const data = { name: form.name.trim(), student_no: form.student_no.trim() || null, adviser: form.adviser.trim() || null,
      enrollment_year: form.enrollment_year ? Number(form.enrollment_year) : null, program_level: form.program_level || null,
      major_id: form.major_id ? Number(form.major_id) : null };
    void run(async () => {
      await api(creating ? "/api/admin/students" : `/api/admin/students/${student!.id}`, {
        method: creating ? "POST" : "PATCH", body: JSON.stringify(creating ? { ...data, seat_id: item!.seat!.id } : data),
      });
      setEditing(false); setCreating(false);
    });
  };
  const move = (person: Student, destination: string) => void run(async () => {
    await api(`/api/admin/students/${person.id}/move`, { method: "POST", body: JSON.stringify({ seat_id: destination }) });
    onMove(null); setCandidate(null);
  });

  return <aside ref={panel} className="seat-student-panel" aria-label="工位与学生操作">
    <header><div><span>{moving ? "移动工位" : virtual ? roomName : `${roomName} 房间`}</span><h3>{moving ? moving.name : item ? `${virtual ? "虚拟位置" : "工位"} ${item.label}` : virtual ? "选择一个虚拟位置" : "选择一个工位"}</h3></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <fieldset disabled={busy}>
      {moving ? <div className="seat-move-flow">
        <p>原位置：{moving.current_assignment ? `${moving.current_assignment.room_name} · ${moving.current_assignment.seat_code}` : "未被分配"}</p>
        <p>点击图上的空闲工位作为目标，也可先切换房间。</p>
        {target?.seat ? <div className="move-destination"><span>目标工位</span><strong>{roomName} · {target.label}</strong><button className="primary-action compact" onClick={() => move(moving, target.seat!.id)}>确认移动到这里</button></div> : <p className="form-hint">尚未选择目标工位</p>}
        <div className="panel-actions"><button onClick={() => move(moving, "virtual:翔安")}>移至翔安</button><button onClick={() => move(moving, "virtual:未被分配")}>移至未被分配</button><button onClick={() => onMove(null)}>取消移动</button></div>
      </div> : !item ? <p className="panel-empty">{virtual ? "点击虚拟位置查看和管理学生。" : "点击工位查看学生、修改资料或分配座位。调整桌椅位置请切换到“编辑布局”。"}</p>
        : !item.seat ? <p className="panel-empty">新工位需先保存布局，再分配学生。</p>
          : loading ? <p className="panel-empty" role="status">正在加载学生资料…</p>
            : editing || creating ? <form className="seat-profile-form" onSubmit={saveProfile}><h4>{creating ? "录入并分配学生" : "编辑学生资料"}</h4><StudentFormFields form={form} onChange={change} options={options} /><div className="form-actions"><button className="primary-action compact" type="submit">保存{creating ? "并分配" : "资料"}</button><button type="button" className="secondary-action compact" onClick={() => { setEditing(false); setCreating(false); onDirty(false); }}>取消</button></div></form>
              : student ? <>
                <StudentProfile person={student} compact />
                <div className="panel-actions"><button onClick={startEdit}><Pencil />编辑资料</button><button onClick={() => onMove(student)}><ArrowRightLeft />移动工位</button></div>
                {!virtual && <details className="panel-secondary"><summary>释放当前工位</summary><p>释放后，{student.name} 将移至“未被分配”，原工位恢复可用。</p><button className="danger-plain" onClick={() => void run(async () => { await api(`/api/admin/students/${student.id}/release`, { method: "POST" }); })}>确认释放</button></details>}
              </> : pending ? <p className="panel-empty">此工位有待审批申请，请到“申请审批”处理。</p>
                : item.seat.display_state === "available" ? <div className="seat-assign-flow">
                  <h4>分配学生</h4><label className="search-field"><Search size={16} /><input aria-label="搜索待分配学生" placeholder="姓名、学号或导师" value={query} onChange={(e) => { setQuery(e.target.value); setCandidate(null); }} /></label>
                  <label className="check-control"><input type="checkbox" checked={allStudents} onChange={(e) => { setAllStudents(e.target.checked); setCandidate(null); }} />包括已有工位的学生</label>
                  <div className="student-search-results">{results.map((person) => <button key={person.id} aria-pressed={candidate?.id === person.id} onClick={() => setCandidate(person)}><strong>{person.name}</strong><span>{person.student_no || "学号待补全"}</span><small>{person.current_assignment?.room_name ?? "未被分配"}</small></button>)}{!results.length && <p>没有匹配的学生</p>}</div>
                  {candidate && <div className="move-destination"><p>将 {candidate.name} 从 {candidate.current_assignment?.room_name ?? "未被分配"} 调整到 {roomName} · {item.label}。</p><button className="primary-action compact" onClick={() => move(candidate, item.seat!.id)}>确认分配</button></div>}
                  <button className="text-action" onClick={() => { setForm(emptyStudentForm); setCreating(true); }}><UserPlus />录入新学生</button>
                </div> : <p className="panel-empty">此工位当前不可分配，可在下方调整使用状态。</p>}
      {!moving && item?.seat && !loading && !virtual && !editing && !creating && <details className="panel-secondary"><summary>工位状态与备注</summary><form onSubmit={(event) => {
        event.preventDefault(); void run(async () => { await api(`/api/admin/seats/${item.seat!.id}/status`, { method: "PATCH", body: JSON.stringify({ status, note: note.trim() || null }) }); });
      }}><label><span>使用状态</span><select value={status} onChange={(e) => { setStatus(e.target.value); onDirty(true); }} disabled={!!student || !!pending}><option value="active">正常可用</option><option value="reserved">保留</option><option value="maintenance">维修</option><option value="disabled">停用</option></select></label><label><span>备注</span><textarea rows={3} value={note} onChange={(e) => { setNote(e.target.value); onDirty(true); }} /></label><button type="submit">保存状态与备注</button></form></details>}
    </fieldset>
    {busy && <p className="form-hint" role="status">正在保存…</p>}
  </aside>;
}
