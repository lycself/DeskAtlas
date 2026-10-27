"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Notice } from "@/app/components/Notice";
import { Select } from "@/app/components/Select";
import { api } from "@/app/lib/api";
import type { Major } from "@/app/lib/types";

type Teacher = { id: number; name: string; title: string | null; role: string | null; major_id: number; is_active: boolean };
type Draft = Omit<Teacher, "id">;
const empty: Draft = { name: "", title: "", role: "", major_id: 0, is_active: true };

export function AdminTeachers({ majors, active }: { majors: Major[]; active: boolean }) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [draft, setDraft] = useState<Draft>(empty);
  const [editing, setEditing] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const form = useRef<HTMLFormElement>(null);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    api<Teacher[]>("/api/admin/teachers", { signal: controller.signal }).then(setTeachers)
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active]);
  useEffect(() => {
    if (showForm) { form.current?.scrollIntoView({ block: "nearest" }); form.current?.querySelector("input")?.focus({ preventScroll: true }); }
  }, [showForm, editing]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const saved = await api<Teacher>(editing ? `/api/admin/teachers/${editing}` : "/api/admin/teachers", {
        method: editing ? "PUT" : "POST", body: JSON.stringify(draft),
      });
      setTeachers((rows) => editing ? rows.map((row) => row.id === editing ? saved : row) : [...rows, saved]);
      setDraft(empty); setEditing(null); setShowForm(false); setMessage("教师资料已保存");
    } catch (e) { setError(e instanceof Error ? e.message : "保存失败"); }
    finally { setBusy(false); }
  };

  const edit = (t: Teacher) => { setEditing(t.id); setShowForm(true); setDraft({ name: t.name, title: t.title, role: t.role, major_id: t.major_id, is_active: t.is_active }); setMessage(""); };
  const rows = teachers.filter((t) => (!filter || String(t.major_id) === filter) && t.name.includes(query.trim()));
  return <section className="flat-section teacher-settings" hidden={!active}>
    <header><div><h2>教研组教师</h2><p>维护教师所属教研中心、职称和中心职务。停用教师会保留历史资料。</p></div><button className="secondary-action compact" disabled={busy || showForm} onClick={() => { setEditing(null); setDraft(empty); setShowForm(true); setMessage(""); }}><Plus size={16} />添加教师</button></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    <Notice message={message} onClearMessage={() => setMessage("")} />
    {showForm && <form ref={form} onSubmit={save}>
      <fieldset disabled={busy}>
        <h3>{editing ? "编辑教师" : "添加教师"}</h3>
        <div className="field-grid two">
          <label><span>姓名</span><input required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
          <label><span>教研中心</span><Select required value={draft.major_id ? String(draft.major_id) : ""} onChange={(value) => setDraft({ ...draft, major_id: Number(value) })} placeholder="请选择教研中心" options={majors.map((m) => ({ value: String(m.id), label: `${m.name}${m.is_active ? "" : "（已停用）"}` }))} /></label>
          <label><span>职称</span><input maxLength={80} value={draft.title ?? ""} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
          <label><span>中心职务</span><input maxLength={120} value={draft.role ?? ""} onChange={(e) => setDraft({ ...draft, role: e.target.value })} /></label>
        </div>
        <label className="check-control"><input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />启用教师</label>
        <div className="form-actions">
          <button className="primary-action compact" disabled={!draft.name.trim() || !draft.major_id}>{busy ? "保存中…" : "保存教师"}</button>
          <button type="button" className="secondary-action compact" onClick={() => { setEditing(null); setDraft(empty); setShowForm(false); }}>取消</button>
        </div>
      </fieldset>
    </form>}
    <div className="student-tools">
      <label><span>筛选教研中心</span><Select value={filter} onChange={setFilter} options={[{ value: "", label: "全部教研中心" }, ...majors.map((m) => ({ value: String(m.id), label: m.name }))]} /></label>
      <label><span>搜索教师姓名</span><input aria-label="搜索教师姓名" placeholder="搜索教师姓名" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
      <span>{loading ? "正在加载…" : `${rows.length} 位教师`}</span>
    </div>
    <div className="seat-table-wrap teacher-desktop"><table className="data-table sticky-first-col"><thead><tr><th>教师</th><th>教研中心</th><th>职称</th><th>中心职务</th><th>状态</th><th /></tr></thead>
      <tbody>{rows.map((t) => <tr key={t.id}><td>{t.name}</td><td>{majors.find((m) => m.id === t.major_id)?.name}</td><td>{t.title || "—"}</td><td>{t.role || "—"}</td><td>{t.is_active ? "启用" : "停用"}</td><td><button className="row-action" disabled={busy} onClick={() => edit(t)}>编辑</button></td></tr>)}
        {!rows.length && <tr><td colSpan={6} className="table-empty">{loading ? "正在加载教师…" : "暂无匹配的教师"}</td></tr>}
      </tbody></table></div>
    <div className="teacher-mobile-list">{rows.map((t) => <article key={t.id}><header><div><strong>{t.name}</strong><span className="muted">{t.is_active ? "启用中" : "已停用"}</span></div><button className="secondary-action compact" disabled={busy} onClick={() => edit(t)} aria-label={`编辑 ${t.name}`}>编辑</button></header><p>{majors.find((m) => m.id === t.major_id)?.name} · {t.title || "未填写职称"}</p>{t.role && <p className="muted">{t.role}</p>}</article>)}{!rows.length && <p className="table-empty">{loading ? "正在加载教师…" : "暂无匹配的教师，请调整搜索或教研中心。"}</p>}</div>
  </section>;
}
