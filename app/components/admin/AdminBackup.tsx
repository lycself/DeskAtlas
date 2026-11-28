"use client";

import { CircleAlert, Copy, Download, FileSpreadsheet, HardDriveDownload, KeyRound, RefreshCw, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";

import { confirmDialog, noticeDialog } from "@/app/components/ConfirmDialog";
import { Notice } from "@/app/components/Notice";
import { FilePicker } from "../FilePicker";
import { api } from "@/app/lib/api";

type SetupStatus = { configured: boolean; packaged: boolean; database: string; data_dir?: string | null; version: string };
type BackupEntry = { name: string; size: number; created_at: string };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AdminBackup({ active }: { active: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [items, setItems] = useState<BackupEntry[]>([]);
  const [directory, setDirectory] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  // The password fields stay closed until 修改密码, like the other forms over saved settings.
  const [changingPassword, setChangingPassword] = useState(false);
  const passwordForm = useRef<HTMLFormElement>(null);
  const passwordButton = useRef<HTMLButtonElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);


  const load = async (signal?: AbortSignal) => {
    const results = await Promise.allSettled([
      api<SetupStatus>("/api/setup/status", { signal }).then(setStatus),
      api<{ items: BackupEntry[]; directory: string }>("/api/admin/backup", { signal }).then((data) => { setItems(data.items); setDirectory(data.directory); }),
    ]);
    if (signal?.aborted) return;
    if (results.some((result) => result.status === "rejected")) setError("备份信息加载失败，请刷新重试。");
  };
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [active]);

  const run = async (label: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(""); setMessage("");
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败，请重试"); }
    finally { busyRef.current = false; setBusy(""); }
  };

  const createBackup = () => void run("create", async () => {
    const created = await api<{ name: string }>("/api/admin/backup", { method: "POST" });
    await load();
    setMessage(`已在备份目录生成 ${created.name}`);
  });
  const remove = async (name: string) => {
    if (!await confirmDialog({ title: `删除备份 ${name}？`, body: "此操作不可撤销。", confirmLabel: "删除", danger: true })) return;
    void run(`delete-${name}`, async () => {
      await api(`/api/admin/backup/file/${encodeURIComponent(name)}`, { method: "DELETE" });
      await load();
      setMessage("备份已删除");
    });
  };
  const restore = async (event: FormEvent) => {
    event.preventDefault();
    if (!restoreFile) { setError("请选择备份包"); return; }
    if (!await confirmDialog({ title: "用备份包恢复数据？", body: "恢复会用备份包里的数据完全替换当前的房间、工位、学生和邮件设置，本机管理员账号保持不变。当前数据会先自动留一份副本。", confirmLabel: "恢复", danger: true })) return;
    void run("restore", async () => {
      const body = new FormData();
      body.append("file", restoreFile);
      await api("/api/admin/backup/restore", { method: "POST", body });
      await noticeDialog("数据已恢复", "请使用本机现有的管理员账号重新登录。");
      router.replace("/admin/login");
    });
  };
  const changePassword = (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmation) { setError("两次输入的新密码不一致"); return; }
    void run("password", async () => {
      await api("/api/admin/password", { method: "POST", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
      setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setChangingPassword(false);
      setMessage("管理员密码已更新，下次登录请使用新密码。");
    });
  };
  const cancelPassword = () => { setCurrentPassword(""); setNewPassword(""); setConfirmation(""); setChangingPassword(false); };
  const passwordOpened = useRef(false);
  useEffect(() => {
    // Opening puts the caret in 当前密码; closing hands focus back to 修改密码.
    if (changingPassword) passwordForm.current?.querySelector("input")?.focus();
    else if (passwordOpened.current && (document.activeElement === document.body || !document.activeElement)) passwordButton.current?.focus();
    passwordOpened.current = changingPassword;
  }, [changingPassword]);

  const copyPath = async (label: string, path: string) => {
    // navigator.clipboard is missing on the plain-http intranet page and may also refuse; then copy through a hidden field.
    const viaField = () => {
      const field = document.createElement("textarea");
      field.value = path; field.setAttribute("readonly", ""); field.style.position = "fixed"; field.style.opacity = "0";
      document.body.appendChild(field); field.select();
      const copied = document.execCommand("copy");
      field.remove();
      return copied;
    };
    let copied = false;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(path); copied = true; } } catch { /* fall through */ }
    if (!copied) copied = viaField();
    if (copied) setMessage(`已复制${label}`); else setError(`复制失败，请手动选择${label}`);
  };
  const pathRow = (label: string, path: string) => <div>
    <dt>{label}</dt>
    <dd><code title={path}>{path}</code><button type="button" className="icon-button compact-icon" aria-label={`复制${label}`} title={`复制${label}`} onClick={() => void copyPath(label, path)}><Copy size={15} /></button></dd>
  </div>;

  // One column, top to bottom: back up, what is backed up where, restore, then the password.
  return <div className="backup-page">
    {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}<Notice message={message} onClearMessage={() => setMessage("")} />
    <section className="flat-section backup-section">
      <header><div><h2>备份与导出</h2><p>备份包包含全部数据、上传文件和邮件配置密钥。换电脑导入后设置本机管理员账号。</p></div><button className="icon-button" aria-label="刷新备份列表" title="刷新备份列表" disabled={!!busy} onClick={() => void run("refresh", () => load())}><RefreshCw size={16} /></button></header>
      <div className="backup-actions">
        <a className="primary-action compact" aria-label="下载备份包" href="/api/admin/backup/export" download><Download size={15} />下载备份</a>
        <button className="secondary-action compact" aria-label="备份到本机目录" disabled={!!busy} onClick={createBackup}><HardDriveDownload size={15} />{busy === "create" ? "备份中…" : "本机备份"}</button>
        <a className="secondary-action compact" aria-label="导出 Excel 报表" href="/api/admin/export/excel" download><FileSpreadsheet size={15} />导出报表</a>
      </div>
      <p className="form-hint">报表含学生名册、实际工位分配和房间汇总，可在 Excel 中筛选和打印。</p>
      {status && <dl className="fact-rows">
        <div><dt>版本</dt><dd>{status.version}{status.packaged ? "（桌面版）" : ""}</dd></div>
        <div><dt>数据库</dt><dd>{status.database === "sqlite" ? "SQLite 文件" : "PostgreSQL"}</dd></div>
        {status.data_dir && pathRow("数据目录", status.data_dir)}
        {directory && pathRow("备份目录", directory)}
      </dl>}
      <h3 className="backup-list-title">本机备份{items.length ? ` · ${items.length} 份` : ""}</h3>
      {!items.length ? <p className="backup-empty">还没有备份。桌面版每天自动备份一次，也可以点上面的「本机备份」。</p> : <>
        <div className="seat-table-wrap backup-desktop">
          <table className="data-table backup-table">
            <thead><tr><th>备份</th><th>时间</th><th>大小</th><th /></tr></thead>
            <tbody>
              {items.map((item) => <tr key={item.name}>
                <td><code>{item.name}</code></td>
                <td>{new Date(item.created_at).toLocaleString("zh-CN")}</td>
                <td>{formatSize(item.size)}</td>
                <td><div className="row-actions"><a className="row-action" href={`/api/admin/backup/file/${encodeURIComponent(item.name)}`} download>下载</a><button className="row-action danger" disabled={!!busy} onClick={() => remove(item.name)}><Trash2 size={13} />删除</button></div></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="backup-mobile-list">{items.map((item) => <article className="backup-record" key={item.name}><code>{item.name}</code><div className="backup-record-footer"><span>{new Date(item.created_at).toLocaleDateString("zh-CN")} · {formatSize(item.size)}</span><div className="row-actions"><a className="row-action" href={`/api/admin/backup/file/${encodeURIComponent(item.name)}`} download>下载</a><button className="row-action danger" disabled={!!busy} onClick={() => remove(item.name)}><Trash2 size={13} />删除</button></div></div></article>)}</div>
      </>}
    </section>
    <section className="flat-section restore-section">
      <header><div><h2>从备份包恢复</h2><p>把另一台电脑的数据搬到这里，或回退到早先的备份。恢复会替换当前全部数据。</p></div><Upload /></header>
      <form className="restore-form" onSubmit={restore}>
        <FilePicker file={restoreFile} onChange={setRestoreFile} accept=".zip" maxMB={2048} disabled={!!busy} label="选择备份包（.zip）" />
        <button className="danger-action compact" disabled={!!busy || !restoreFile}>{busy === "restore" ? "正在恢复…" : "恢复并替换当前数据"}</button>
      </form>
    </section>
    <section className="flat-section password-section">
      <header><div><h2>管理员密码</h2><p>修改后立即生效，需要用新密码重新登录。</p></div><KeyRound /></header>
      {changingPassword ? <form ref={passwordForm} className="password-form" onSubmit={changePassword}
        onKeyDown={(event) => { if (event.key === "Escape" && !event.nativeEvent.isComposing && busy !== "password") { event.preventDefault(); cancelPassword(); } }}>
        <label><span>当前密码</span><input type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label><span>新密码（至少 12 个字符）</span><input type="password" autoComplete="new-password" required minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label>
        <label><span>再次输入新密码</span><input type="password" autoComplete="new-password" required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        <div className="editable-actions">
          <button className="primary-action compact" disabled={!!busy}>{busy === "password" ? "正在保存…" : "更新密码"}</button>
          <button type="button" className="secondary-action compact" disabled={busy === "password"} onClick={cancelPassword}>取消</button>
        </div>
      </form> : <>
        <dl className="fact-rows"><div><dt>登录密码</dt><dd>已设置</dd></div></dl>
        <div className="editable-actions password-open"><button ref={passwordButton} type="button" className="secondary-action compact" disabled={!!busy} onClick={() => setChangingPassword(true)}><KeyRound size={15} />修改密码</button></div>
      </>}
    </section>
  </div>;
}
