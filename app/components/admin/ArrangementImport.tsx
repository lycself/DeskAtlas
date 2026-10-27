"use client";
import { Check, FileSpreadsheet, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { FilePicker } from "../FilePicker";
import { Select } from "../Select";
import { confirmDialog } from "../ConfirmDialog";
import { api } from "@/app/lib/api";

type Role = "roster" | "floorplan" | "directory" | "teachers";
const roles: Array<{ id: Role; title: string; hint: string }> = [
  { id: "directory", title: "学生信息表", hint: "学号、姓名、导师姓名、年级、培养层次" },
  { id: "teachers", title: "教师名单", hint: "姓名、职称、中心职务、教研中心（前四列）" },
  { id: "roster", title: "用房汇总表", hint: "每行一个工位，保留原用房汇总表头" },
  { id: "floorplan", title: "房间布局图", hint: "使用现有最新安排的 Excel 布局格式" },
];
type Preview = { changes: { current_students: number; new_rooms: string[]; archived_rooms: string[]; pending_applications: number }; preview_id: string; summary: Record<string, number>; rooms: Array<{ name: string; seats: number; missing: unknown[]; duplicates: unknown[]; extra: unknown[] }>; assignment_conflicts: Array<{ student_no: string; name: string; seats: string[] }>; identity_warnings: Array<{ source_row: number; name: string; reason: string }> };
export function ArrangementImport() {
  const [files, setFiles] = useState<Partial<Record<Role, File>>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ backup: string; result: Record<string, unknown> } | null>(null);
  const reset = () => { setPreview(null); setChoices({}); setAcknowledged(false); setResult(null); setError(""); };
  const inspect = async () => {
    setBusy(true); setError("");
    const body = new FormData();
    for (const { id } of roles) if (files[id]) body.append(id, files[id]);
    try { setPreview(await api<Preview>("/api/admin/import/arrangement/preview", { method: "POST", body })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "解析失败"); }
    finally { setBusy(false); }
  };
  const commit = async () => {
    if (!preview || busy) return;
    if (!await confirmDialog({ title: "同步最新安排？", body: `将按此批文件更新学生、教师、房间和布局，结束旧分配并保留历史。未出现在新名单中的旧记录会归档。写入前会自动生成完整备份；任一写入失败会整体回滚。`, confirmLabel: "备份并同步", danger: true })) return;
    setBusy(true); setError("");
    try { setResult(await api("/api/admin/import/arrangement/commit", { method: "POST", body: JSON.stringify({ preview_id: preview.preview_id, choices, acknowledged }) })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "同步失败"); }
    finally { setBusy(false); }
  };
  const resolvedCount = Object.values(choices).filter((choice) => choice !== "unassigned").length;
  return <section className="arrangement-import" aria-busy={busy}>
    <ol className="import-steps" aria-label="同步流程"><li className={!preview ? "current" : ""}>1 选择四份文件</li><li className={preview && !result ? "current" : ""}>2 检查与确认</li><li className={result ? "current" : ""}>3 备份并同步</li></ol>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!preview && <><div className="arrangement-files">{roles.map(({ id, title, hint }) => <section key={id}><h2><FileSpreadsheet size={18} />{title}</h2><p className="muted">{hint}</p><FilePicker label={`选择${title}`} file={files[id] ?? null} disabled={busy} onChange={(file) => { setFiles((current) => { const next = { ...current }; if (file) next[id] = file; else delete next[id]; return next; }); setError(file && file.size > 20 * 1024 * 1024 ? "文件不能超过 20MB" : ""); }} /></section>)}</div><div className="commit-line"><p><ShieldCheck size={17} />原文件不会修改。预览有效期一小时，同步前请处理待审批申请。</p><button className="primary-action" disabled={busy || roles.some(({ id }) => !files[id] || files[id]!.size > 20 * 1024 * 1024)} onClick={inspect}>{busy ? "正在核对四份文件…" : "校验并生成预览"}</button></div></>}
    {preview && !result && <><div className="import-summary">{[["directory_students", "学生名册"], ["teachers", "教师"], ["matched_seated_students", "已匹配工位"], ["unassigned_students", "未分配学生"]].map(([id, label]) => <span key={id}><strong>{(preview.summary[id] ?? 0) + (id === "matched_seated_students" ? resolvedCount : id === "unassigned_students" ? -resolvedCount : 0)}</strong>{label}</span>)}</div>
      <div className="import-review-section"><h2>变更范围</h2><p>当前在册 {preview.changes.current_students} 人；学生信息表包含 {preview.summary.directory_students} 人，另有 {preview.identity_warnings.length} 条工位使用记录待核对。未出现在本批四份文件中的旧记录将归档。</p><p>新增房间：{preview.changes.new_rooms.join("、") || "无"}</p><p>归档房间：{preview.changes.archived_rooms.join("、") || "无"}</p>{preview.changes.pending_applications > 0 && <p className="form-error">还有 {preview.changes.pending_applications} 份待审批申请，请先处理再重新预览。</p>}</div>
      <p className="form-hint">本次将以四份文件为准：更新 {preview.rooms.length} 个实体房间及其布局，归档旧名单中不再出现的记录，并保留分配历史。未匹配身份的用房记录保留为资料待补全。</p>
      {!!preview.assignment_conflicts.length && <section className="import-review-section"><h2>重复安排 · {preview.assignment_conflicts.length} 项</h2><p>每位学生只能保留一个工位，请逐项选择。</p>{preview.assignment_conflicts.map((item) => <label key={item.student_no}><span>{item.name} · {item.student_no}</span><Select required searchable aria-label={`${item.name} 的重复安排`} value={choices[item.student_no] ?? ""} onChange={(value) => setChoices({ ...choices, [item.student_no]: value })} options={[...item.seats.map((seat) => ({ value: seat, label: seat })), { value: "unassigned", label: "暂不分配，保留待核对工位" }]} /></label>)}</section>}
      <details className="import-review-section"><summary>身份待核对 · {preview.identity_warnings.length} 条</summary>{preview.identity_warnings.length ? preview.identity_warnings.map((item, index) => <p key={index}>第 {item.source_row} 行 · {item.name}：{item.reason}</p>) : <p>所有占用人员均已匹配学生名册。</p>}</details>
      <details className="import-review-section"><summary>房间与布局 · {preview.rooms.length} 间</summary><div className="room-preview-list">{preview.rooms.map((room) => <div key={room.name}><strong>{room.name}</strong><span>{room.seats} 条工位记录</span><small>{room.missing.length || room.duplicates.length || room.extra.length ? `待核对：缺少 ${room.missing.length} / 重复 ${room.duplicates.length} / 多余 ${room.extra.length}` : "布局已匹配"}</small></div>)}</div></details>
      <label className="check-control"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />我已检查变更、重复安排与待核对记录，确认按新名单同步。</label>
      <div className="form-actions"><button className="secondary-action" disabled={busy} onClick={reset}>重新选择文件</button><button className="primary-action" disabled={busy || preview.changes.pending_applications > 0 || !acknowledged || preview.assignment_conflicts.some((item) => !choices[item.student_no])} onClick={commit}>{busy ? "正在备份并同步…" : "备份并同步安排"}</button></div></>}
    {result && <div className="success-report"><Check /><h2>{result.result.already_imported ? "这批安排已经同步过" : "最新安排已同步"}</h2><p>{result.result.already_imported ? "没有重复写入，现有管理记录保持原样。" : "学生、教师、工位与布局已在同一事务中更新。"}</p><p>导入前备份：<a href={`/api/admin/backup/file/${encodeURIComponent(result.backup)}`} download>{result.backup}</a></p><div className="form-actions"><a className="secondary-action" href="#rooms">查看房间与工位</a><button className="secondary-action" onClick={reset}>导入另一批文件</button></div></div>}
  </section>;
}
