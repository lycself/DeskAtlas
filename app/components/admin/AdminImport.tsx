"use client";

import { Check, CircleAlert, FileSpreadsheet, Upload } from "lucide-react";
import { ChangeEvent, useState } from "react";

import { api } from "@/app/lib/api";

type ImportRow = {
  source_row: number; room_name: string; seat_code: string; person_name: string; adviser?: string | null;
  enrollment_year?: number | null; program_level?: string | null; major_name?: string | null; note?: string | null;
  kind: "student" | "empty" | "equipment"; warnings: string[]; confirmed?: boolean;
};
type Preview = { rows: ImportRow[]; summary: Record<string, number> };

export function AdminImport() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, number> | null>(null);

  const choose = (event: ChangeEvent<HTMLInputElement>) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setResult(null); };
  const inspect = async () => {
    if (!file) return; setBusy(true); setError("");
    const body = new FormData(); body.append("file", file);
    try { setPreview(await api<Preview>("/api/admin/import/preview", { method: "POST", body })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "解析失败"); }
    finally { setBusy(false); }
  };
  const update = (index: number, patch: Partial<ImportRow>) => setPreview((current) => current ? { ...current, rows: current.rows.map((row, i) => i === index ? { ...row, ...patch } : row) } : current);
  const commit = async () => {
    if (!preview) return; setBusy(true); setError("");
    try { setResult(await api<Record<string, number>>("/api/admin/import/commit", { method: "POST", body: JSON.stringify({ rows: preview.rows }) })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "导入失败"); }
    finally { setBusy(false); }
  };

  return <div className="admin-page">
    <header className="page-heading"><h1>数据导入</h1></header>
    {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}
    <section className="import-drop flat-section"><FileSpreadsheet size={34} /><div><h2>{file ? file.name : "选择 Excel 工位表"}</h2><p>支持 .xlsx，最大 20MB。原始文件不会被修改。</p></div><label className="secondary-action"><input type="file" accept=".xlsx" onChange={choose} /><Upload size={16} />选择文件</label><button className="primary-action compact" disabled={!file || busy} onClick={inspect}>{busy ? "正在解析…" : "生成导入预览"}</button></section>
    {preview && <>
      <div className="import-summary"><span><strong>{preview.summary.total}</strong>总行数</span><span><strong>{preview.summary.students}</strong>学生</span><span><strong>{preview.summary.empty}</strong>空位</span><span><strong>{preview.summary.equipment}</strong>设备</span><span className={preview.summary.review ? "warn" : ""}><strong>{preview.summary.review}</strong>需要检查</span></div>
      <section className="seat-table-wrap import-table"><table className="data-table"><thead><tr><th>源行</th><th>房间</th><th>座位</th><th>类型</th><th>姓名/设备</th><th>导师</th><th>年级</th><th>层次</th><th>专业</th><th>提示</th></tr></thead><tbody>{preview.rows.map((row, index) => <tr key={`${row.source_row}-${index}`} className={row.warnings.length && !row.confirmed ? "warning-row" : ""}><td>{row.source_row}</td><td><input value={row.room_name} onChange={(e) => update(index, { room_name: e.target.value })} /></td><td><input value={row.seat_code} onChange={(e) => update(index, { seat_code: e.target.value })} /></td><td><select value={row.kind} onChange={(e) => update(index, { kind: e.target.value as ImportRow["kind"] })}><option value="student">学生</option><option value="empty">空位</option><option value="equipment">设备</option></select></td><td><input value={row.person_name} onChange={(e) => update(index, { person_name: e.target.value })} /></td><td><input value={row.adviser ?? ""} onChange={(e) => update(index, { adviser: e.target.value || null })} /></td><td><input type="number" value={row.enrollment_year ?? ""} onChange={(e) => update(index, { enrollment_year: e.target.value ? Number(e.target.value) : null })} /></td><td><select value={row.program_level ?? ""} onChange={(e) => update(index, { program_level: e.target.value || null })}><option value="">待补全</option><option>硕士</option><option>博士</option></select></td><td><input value={row.major_name ?? ""} onChange={(e) => update(index, { major_name: e.target.value || null })} /></td><td>{row.warnings.length ? <><span>{row.warnings.join("；")}</span><label className="confirm-warning"><input type="checkbox" checked={Boolean(row.confirmed)} onChange={(e) => update(index, { confirmed: e.target.checked })} />已人工确认</label></> : <Check size={15} />}</td></tr>)}</tbody></table></section>
      {!result ? <div className="commit-line"><p>确认预览后，系统将在一个事务中创建房间、工位和历史占用记录。</p><button className="primary-action compact" disabled={busy} onClick={commit}><Check size={16} />确认并导入</button></div> : <div className="success-report"><Check /><h2>导入完成</h2><p>新增房间 {result.created_rooms ?? 0}，工位 {result.created_seats ?? 0}，学生 {result.created_students ?? 0}，分配 {result.created_assignments ?? 0}；跳过 {result.skipped ?? 0}，仍待补全/确认 {result.unresolved ?? 0}。</p></div>}
    </>}
  </div>;
}
