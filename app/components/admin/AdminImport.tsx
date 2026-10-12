"use client";

import { Check, CircleAlert, FileSpreadsheet, RotateCcw, Upload } from "lucide-react";
import { ChangeEvent, useEffect, useRef, useState } from "react";

import { confirmDialog } from "@/app/components/ConfirmDialog";
import { Select } from "@/app/components/Select";
import { api } from "@/app/lib/api";
import type { Bootstrap } from "@/app/lib/types";

type ImportRow = {
  source_row: number; room_name: string; seat_code: string; person_name: string; adviser?: string | null;
  enrollment_year?: number | null; program_level?: string | null; major_name?: string | null; note?: string | null;
  student_note?: string | null; seat_note?: string | null;
  kind: "student" | "empty" | "equipment"; warnings: string[]; confirmed?: boolean;
};
type Preview = { rows: ImportRow[]; summary: Record<string, number> };

export function AdminImport({ active = true }: { active?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [options, setOptions] = useState<Bootstrap | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    api<Bootstrap>("/api/admin/options", { signal: controller.signal }).then(setOptions).catch((caught) => { if (!controller.signal.aborted) setError(caught.message); });
    return () => controller.abort();
  }, [active]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setResult(null); setError(""); };
  const reset = () => { setFile(null); setPreview(null); setResult(null); setError(""); if (fileInput.current) fileInput.current.value = ""; };
  const inspect = async () => {
    if (!file) return; setBusy(true); setError("");
    const body = new FormData(); body.append("file", file);
    try { setPreview(await api<Preview>("/api/admin/import/preview", { method: "POST", body })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "解析失败"); }
    finally { setBusy(false); }
  };
  const update = (index: number, patch: Partial<ImportRow>) => setPreview((current) => current ? { ...current, rows: current.rows.map((row, i) => i === index ? { ...row, ...patch } : row) } : current);
  const commit = async () => {
    if (!preview) return;
    const unconfirmed = preview.rows.filter((row) => row.warnings.length && !row.confirmed).length;
    if (!await confirmDialog({ title: `确认导入 ${preview.rows.length} 行？`, body: `${unconfirmed ? `其中 ${unconfirmed} 行仍有提示且未人工确认。` : ""}系统会在一个事务中创建房间、工位和历史占用记录。`, confirmLabel: "导入" })) return;
    setBusy(true); setError("");
    try { setResult(await api<Record<string, number>>("/api/admin/import/commit", { method: "POST", body: JSON.stringify({ rows: preview.rows }) })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "导入失败"); }
    finally { setBusy(false); }
  };
  const programLevels = options?.program_levels ?? [];

  return <div className="admin-page">
    <header className="page-heading"><div><h1>数据导入</h1><p className="page-subtitle">把旧版 Excel 工位表一次性导入为房间、工位和占用记录。</p></div></header>
    {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}
    <section className="import-drop flat-section">
      <FileSpreadsheet size={34} />
      <div><h2>{file ? file.name : "选择 Excel 工位表"}</h2><p>支持 .xlsx，最大 20MB。原始文件不会被修改，导入前会先生成可编辑的预览。</p></div>
      <label className="secondary-action"><input ref={fileInput} type="file" accept=".xlsx" onChange={choose} /><Upload size={16} />选择文件</label>
      <button className="primary-action compact" disabled={!file || busy || !!preview} onClick={inspect}>{busy && !preview ? "正在解析…" : "生成导入预览"}</button>
    </section>
    {!preview && <section className="import-guide">
      <div>
        <h3>表格要求</h3>
        <ul>
          <li>每行一个工位，需要「房间」「座位号」「姓名或设备名」列，可选「导师」「年级」「培养层次」「教研中心」列。</li>
          <li>单元格颜色会被忽略；缺少学号和邮箱的占用者会标记为「信息待补全」，之后在学生名册里补齐。</li>
          <li>同一批文件重复导入不会覆盖导入后的管理操作。</li>
        </ul>
      </div>
      <div>
        <h3>最新安排的四份 Excel 不在这里导入</h3>
        <p>学生信息、教师名单、用房汇总表和布局图请使用命令行脚本同步，脚本会先备份数据库再写入：</p>
        <pre>.venv/bin/python scripts/import_latest_arrangement.py --apply</pre>
      </div>
    </section>}
    {preview && !result && <>
      <div className="import-summary"><span><strong>{preview.summary.total}</strong>总行数</span><span><strong>{preview.summary.students}</strong>学生</span><span><strong>{preview.summary.empty}</strong>空位</span><span><strong>{preview.summary.equipment}</strong>设备</span><span className={preview.summary.review ? "warn" : ""}><strong>{preview.summary.review}</strong>需要检查</span></div>
      <section className="seat-table-wrap import-table"><table className="data-table sticky-first-col"><thead><tr><th>源行</th><th>房间</th><th>座位</th><th>类型</th><th>姓名/设备</th><th>导师</th><th>年级</th><th>层次</th><th>教研中心</th><th>学生备注</th><th>工位备注</th><th>提示</th></tr></thead><tbody>{preview.rows.map((row, index) => <tr key={`${row.source_row}-${index}`} className={row.warnings.length && !row.confirmed ? "warning-row" : ""}><td>{row.source_row}</td><td><input aria-label="房间" value={row.room_name} onChange={(e) => update(index, { room_name: e.target.value })} /></td><td><input aria-label="座位" value={row.seat_code} onChange={(e) => update(index, { seat_code: e.target.value })} /></td><td><Select aria-label="类型" compact value={row.kind} onChange={(value) => update(index, { kind: value as ImportRow["kind"] })} options={[{ value: "student", label: "学生" }, { value: "empty", label: "空位" }, { value: "equipment", label: "设备" }]} /></td><td><input aria-label="姓名或设备" value={row.person_name} onChange={(e) => update(index, { person_name: e.target.value })} /></td><td><input aria-label="导师" value={row.adviser ?? ""} onChange={(e) => update(index, { adviser: e.target.value || null })} /></td><td><input aria-label="年级" type="number" value={row.enrollment_year ?? ""} onChange={(e) => update(index, { enrollment_year: e.target.value ? Number(e.target.value) : null })} /></td><td><Select aria-label="培养层次" compact value={row.program_level ?? ""} onChange={(value) => update(index, { program_level: value || null })} options={[{ value: "", label: "待补全" }, ...programLevels.map((level) => ({ value: level, label: level }))]} /></td><td><input aria-label="教研中心" value={row.major_name ?? ""} onChange={(e) => update(index, { major_name: e.target.value || null })} /></td><td><textarea aria-label="学生备注" rows={2} value={row.student_note ?? ""} onChange={(e) => update(index, { student_note: e.target.value || null })} /></td><td><textarea aria-label="工位备注" rows={2} value={row.seat_note ?? ""} onChange={(e) => update(index, { seat_note: e.target.value || null })} /></td><td>{row.warnings.length ? <><span>{row.warnings.join("；")}</span><label className="confirm-warning"><input type="checkbox" checked={Boolean(row.confirmed)} onChange={(e) => update(index, { confirmed: e.target.checked })} />已人工确认</label></> : <Check size={15} />}</td></tr>)}</tbody></table></section>
      <div className="commit-line"><p>确认预览后，系统将在一个事务中创建房间、工位和历史占用记录。</p><div className="form-actions"><button className="secondary-action compact" disabled={busy} onClick={reset}><RotateCcw size={15} />重新选择文件</button><button className="primary-action compact" disabled={busy} onClick={commit}><Check size={16} />{busy ? "正在导入…" : "确认并导入"}</button></div></div>
    </>}
    {result && <div className="success-report"><Check /><h2>导入完成</h2><p>新增房间 {result.created_rooms ?? 0}，工位 {result.created_seats ?? 0}，学生 {result.created_students ?? 0}，分配 {result.created_assignments ?? 0}；跳过 {result.skipped ?? 0}，仍待补全/确认 {result.unresolved ?? 0}。</p><button className="secondary-action compact" onClick={reset}><RotateCcw size={15} />导入另一个文件</button></div>}
  </div>;
}
