"use client";

import { ChevronDown, CircleAlert, MailCheck, PencilLine, Plus, RefreshCw, Send, SlidersHorizontal } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { AdminBackup } from "./AdminBackup";
import { AdminTeachers } from "./AdminTeachers";
import { EditableForm } from "@/app/components/EditableForm";

import { Notice } from "@/app/components/Notice";
import { Select } from "@/app/components/Select";
import { RecordPagination } from "@/app/components/RecordPagination";
import { actionLabel, auditChanges, targetLabels } from "@/app/lib/audit-display";
import { api } from "@/app/lib/api";
import type { Major } from "@/app/lib/types";

type Smtp = { host?: string; port?: number; security?: string; username?: string; sender_name?: string; sender_email?: string; has_password?: boolean; is_configured: boolean };
type Delivery = { id: number; recipient: string; subject: string; status: string; error?: string | null; attempt_count: number; created_at: string };
type Audit = { target_name?: string; display_before?: unknown; display_after?: unknown; id: number; action: string; target_type: string; target_id?: string | null; before_data?: unknown; after_data?: unknown; created_at: string };

const tabs: Array<[string, string]> = [
  ["majors", "教研中心选项"],
  ["teachers", "教研组教师"],
  ["smtp", "邮箱设置"],
  ["backup", "备份与账号"],
  ["logs", "邮件与操作记录"],
];

export function AdminSettings({ active = true }: { active?: boolean }) {
  const [majors, setMajors] = useState<Major[]>([]);
  // The one centre name being edited; every other row reads as text until its 编辑 is pressed.
  const [editingMajor, setEditingMajor] = useState<{ id: number; name: string } | null>(null);
  const [newMajor, setNewMajor] = useState("");
  const [smtp, setSmtp] = useState<Smtp>({ is_configured: false });
  const [smtpPassword, setSmtpPassword] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [auditState, setAuditState] = useState<"loading" | "ready" | "error">("loading");
  const [audit, setAudit] = useState<Audit[]>([]);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditTarget, setAuditTarget] = useState("");
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [auditPage, setAuditPage] = useState(1);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [smtpLoaded, setSmtpLoaded] = useState(false);
  // SMTP reads as saved values until 编辑; a background refresh never overwrites an edit in progress.
  const [smtpEditing, setSmtpEditing] = useState(false);
  const smtpEditingRef = useRef(false);
  const savedSmtp = useRef<Smtp>({ is_configured: false });
  const tabStrip = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState("majors");
  useEffect(() => {
    const strip = tabStrip.current;
    if (!strip) return;
    const center = () => {
      const selected = strip.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (selected) strip.scrollTo({ left: selected.offsetLeft - (strip.clientWidth - selected.offsetWidth) / 2 });
    };
    center();
    const observer = new ResizeObserver(center);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [tab]);
  const editSmtp = (on: boolean) => { smtpEditingRef.current = on; setSmtpEditing(on); };
  const cancelSmtp = () => { setSmtp(savedSmtp.current); setSmtpPassword(""); editSmtp(false); };

  const load = async (signal?: AbortSignal) => {
    setAuditState("loading");
    const results = await Promise.allSettled([
      api<Major[]>("/api/admin/majors", { signal }).then((rows) => { setMajors(rows); setEditingMajor(null); }),
      api<Delivery[]>("/api/admin/email-deliveries", { signal }).then(setDeliveries),
      api<Audit[]>("/api/admin/audit", { signal }).then((rows) => { setAudit(rows); setAuditState("ready"); }).catch((caught) => { if (!signal?.aborted) setAuditState("error"); throw caught; }),
      api<Smtp>("/api/admin/smtp", { signal }).then((config) => { savedSmtp.current = config; if (!smtpEditingRef.current) setSmtp(config); setSmtpLoaded(true); }),
    ]);
    if (signal?.aborted) return;
    const errors = results.flatMap((result, index) => result.status === "rejected" ? [`${["教研中心", "邮件记录", "操作日志", "SMTP 配置"][index]}：${result.reason instanceof Error ? result.reason.message : "加载失败"}`] : []);
    if (errors.length) setError(errors.join("；"));
  };
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [active]);
  useEffect(() => {
    const syncTab = () => { const value = location.hash.split("/")[1]; if (tabs.some(([id]) => id === value)) setTab(value); };
    syncTab(); window.addEventListener("hashchange", syncTab);
    return () => window.removeEventListener("hashchange", syncTab);
  }, []);
  const run = async (label: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(""); setMessage("");
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败，请重试"); }
    finally { busyRef.current = false; setBusy(""); }
  };

  const addMajor = (event: FormEvent) => {
    event.preventDefault(); if (!newMajor.trim()) return;
    void run("major", async () => {
      const created = await api<Major>("/api/admin/majors", { method: "POST", body: JSON.stringify({ name: newMajor.trim(), sort_order: majors.length + 1 }) });
      setMajors((rows) => [...rows, created]); setNewMajor(""); setMessage("教研中心已添加");
    });
  };
  const updateMajor = (major: Major, patch: Partial<Major>) => void run("major", async () => {
    const updated = await api<Major>(`/api/admin/majors/${major.id}`, { method: "PATCH", body: JSON.stringify(patch) });
    setMajors((rows) => rows.map((row) => row.id === updated.id ? updated : row));
    if (patch.name !== undefined) setEditingMajor(null);
    setMessage("教研中心设置已更新");
  });
  const saveSmtp = (event: FormEvent) => {
    event.preventDefault();
    void run("save", async () => {
      const saved = await api<Smtp>("/api/admin/smtp", { method: "PUT", body: JSON.stringify({
        host: smtp.host?.trim(), port: Number(smtp.port ?? 587), security: smtp.security ?? "starttls", username: smtp.username?.trim() ?? "", password: smtpPassword || null,
        sender_name: smtp.sender_name?.trim() || "DeskAtlas", sender_email: smtp.sender_email?.trim(),
      }) });
      savedSmtp.current = saved; setSmtp(saved); setSmtpPassword(""); editSmtp(false); setMessage("SMTP 配置已保存，可以发送测试邮件。");
    });
  };
  const showDeliveryResult = (result: { status: string; error?: string }) => {
    if (result.status === "sent") setMessage("邮件已发送");
    else setError(`邮件发送失败：${result.error || "请检查 SMTP 配置"}`);
  };
  const refreshDeliveries = async () => setDeliveries(await api<Delivery[]>("/api/admin/email-deliveries"));
  const test = (event: FormEvent) => {
    event.preventDefault();
    if (smtpEditing || !smtp.is_configured) { setError("请先保存 SMTP 配置，再发送测试邮件。"); return; }
    void run("test", async () => {
      showDeliveryResult(await api<{ status: string; error?: string }>("/api/admin/smtp/test", { method: "POST", body: JSON.stringify({ recipient: testRecipient.trim() }) }));
      await refreshDeliveries();
    });
  };
  const retry = (id: number) => void run(`retry-${id}`, async () => {
    showDeliveryResult(await api<{ status: string; error?: string }>(`/api/admin/email-deliveries/${id}/retry`, { method: "POST" }));
    await refreshDeliveries();
  });
  const auditTargets = useMemo(() => [...new Set(audit.map((row) => row.target_type))].sort(), [audit]);
  const filteredAudit = audit.filter((row) => (!auditQuery || `${actionLabel(row.action)} ${row.target_name ?? ""} ${row.action}`.toLowerCase().includes(auditQuery.trim().toLowerCase())) && (!auditTarget || row.target_type === auditTarget));

  const currentDeliveryPage = Math.min(deliveryPage, Math.max(1, Math.ceil(deliveries.length / 5)));
  const currentAuditPage = Math.min(auditPage, Math.max(1, Math.ceil(filteredAudit.length / 10)));
  const pageDeliveries = deliveries.slice((currentDeliveryPage - 1) * 5, currentDeliveryPage * 5);
  const pageAudit = filteredAudit.slice((currentAuditPage - 1) * 10, currentAuditPage * 10);

  return <div className="admin-page">
    <header className="page-heading"><h1>系统设置</h1><button className="secondary-action" disabled={!!busy} onClick={() => void run("refresh", () => load())}><RefreshCw size={16} />刷新</button></header>
    {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}<Notice message={message} onClearMessage={() => setMessage("")} />
    <div ref={tabStrip} className="section-tabs" role="group" aria-label="设置分类">{tabs.map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => { setTab(id); history.replaceState(null, "", `#settings/${id}`); }}>{label}</button>)}</div>
    <AdminTeachers majors={majors} active={active && tab === "teachers"} />
    <div hidden={tab !== "backup"}><AdminBackup active={active && tab === "backup"} /></div>
    <div className="settings-grid">
      <section className="flat-section major-settings" hidden={tab !== "majors"}>
        <header><div><h2>教研中心选项</h2><p>点「编辑」修改名称；停用后不再出现在新申请中，历史数据不受影响。</p></div><SlidersHorizontal /></header>
        <form className="inline-create" onSubmit={addMajor}><input aria-label="新增教研中心名称" value={newMajor} onChange={(e) => setNewMajor(e.target.value)} placeholder="新增教研中心名称" /><button disabled={!!busy || !newMajor.trim()}><Plus size={15} />添加</button></form>
        <div className="setting-rows">{majors.map((major) => {
          const editing = editingMajor?.id === major.id ? editingMajor : null;
          const cancel = () => setEditingMajor(null);
          return <div key={major.id} className={major.is_active ? "" : "inactive"}>
            {editing ? <form className="major-name-edit" onSubmit={(e) => { e.preventDefault(); if (editing.name.trim() && editing.name.trim() !== major.name) updateMajor(major, { name: editing.name.trim() }); else cancel(); }}>
              <input autoFocus aria-label={`教研中心名称：${major.name}`} maxLength={80} value={editing.name} onChange={(e) => setEditingMajor({ id: major.id, name: e.target.value })} onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === "Escape") { e.preventDefault(); cancel(); } }} />
              <button className="primary-action compact" disabled={!!busy || !editing.name.trim()}>保存</button>
              <button type="button" className="secondary-action compact" disabled={!!busy} onClick={cancel}>取消</button>
            </form> : <>
              <span className="major-name">{major.name}</span>
              <button type="button" className="secondary-action compact" disabled={!!busy || !!editingMajor} aria-label={`编辑 ${major.name}`} onClick={() => setEditingMajor({ id: major.id, name: major.name })}><PencilLine size={15} />编辑</button>
            </>}
            <label className="switch" title={major.is_active ? "已启用，点击停用" : "已停用，点击启用"}><input type="checkbox" aria-label={`${major.is_active ? "停用" : "启用"} ${major.name}`} disabled={!!busy} checked={!!major.is_active} onChange={(e) => updateMajor(major, { is_active: e.target.checked })} /><i /></label>
          </div>;
        })}</div>
      </section>
      <section className="flat-section smtp-settings" hidden={tab !== "smtp"}><header><div><h2>SMTP 邮件</h2><p>密码加密保存，审批结果不会因邮件失败而回滚。</p></div><MailCheck /></header><EditableForm className="smtp-form" editing={smtpEditing} busy={busy === "save"} canEdit={smtpLoaded && !busy} onEdit={() => editSmtp(true)} onCancel={cancelSmtp} onSubmit={saveSmtp} saveLabel="保存 SMTP 配置"><div className="field-grid two"><label><span>服务器</span><input required placeholder="例如 smtp.xmu.edu.cn" value={smtp.host ?? ""} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} /></label><label><span>端口</span><input required type="number" min={1} max={65535} value={smtp.port ?? 587} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} /></label></div><div className="field-grid two"><label><span>加密方式</span><Select value={smtp.security ?? "starttls"} onChange={(value) => setSmtp({ ...smtp, security: value })} options={[{ value: "starttls", label: "STARTTLS" }, { value: "ssl", label: "SSL/TLS" }, { value: "none", label: "不加密" }]} /></label><label><span>用户名</span><input placeholder="通常是完整邮箱地址" value={smtp.username ?? ""} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} /></label></div><label><span>密码或授权码</span><input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} placeholder={smtpEditing ? smtp.has_password ? "已配置；留空表示不修改" : "请输入密码或授权码" : smtp.has_password ? "已配置" : "未配置"} /></label><div className="field-grid two"><label><span>发件人名称</span><input required value={smtp.sender_name ?? "DeskAtlas"} onChange={(e) => setSmtp({ ...smtp, sender_name: e.target.value })} /></label><label><span>发件邮箱</span><input required type="email" placeholder="例如 deskatlas@xmu.edu.cn" value={smtp.sender_email ?? ""} onChange={(e) => setSmtp({ ...smtp, sender_email: e.target.value })} /></label></div></EditableForm><form className="smtp-test" onSubmit={test}><input required type="email" aria-label="接收测试邮件的地址" placeholder="接收测试邮件的地址" value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)} /><button disabled={!!busy || !smtpLoaded || !smtp.is_configured || smtpEditing || !testRecipient}><Send size={15} />{busy === "test" ? "正在发送…" : "发送测试"}</button></form><p className="form-hint">测试使用已保存的配置。发送可能需要十几秒，请等待结果。</p></section>
    </div>
    <section id="mail-history" tabIndex={-1} className="flat-section log-section history-section" hidden={tab !== "logs"}><header><div><h2>邮件发送记录</h2><p>最近 100 条；失败项目可直接重试。</p></div></header>
      <div className="seat-table-wrap delivery-desktop" role="region" aria-label="邮件发送记录列表" tabIndex={0}><table className="data-table delivery-table"><colgroup><col className="delivery-time-col" /><col className="delivery-recipient-col" /><col /><col className="delivery-status-col" /><col className="delivery-attempt-col" /><col className="delivery-action-col" /></colgroup><thead><tr><th>时间</th><th>收件人</th><th>主题</th><th>状态</th><th>尝试</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{!deliveries.length && <tr><td colSpan={6} className="table-empty">还没有发送过邮件。</td></tr>}{pageDeliveries.map((row) => <tr key={row.id}><td><time className="delivery-time" dateTime={row.created_at}><span>{new Date(row.created_at).toLocaleDateString("zh-CN")}</span><span>{new Date(row.created_at).toLocaleTimeString("zh-CN")}</span></time></td><td className="delivery-recipient">{row.recipient}</td><td>{row.subject}</td><td><span className={`state-label ${row.status === "sent" ? "available" : "pending"}`}><i />{row.status === "sent" ? "已发送" : row.status === "pending" ? "等待发送" : "失败"}</span>{row.error && <p className="delivery-error">{row.error}</p>}</td><td>{row.attempt_count}</td><td>{row.status !== "sent" && <button className="row-action" disabled={!!busy} onClick={() => retry(row.id)}>{busy === `retry-${row.id}` ? "发送中…" : "重试"}</button>}</td></tr>)}</tbody></table></div>
      <div className="delivery-mobile-list" role="region" aria-label="邮件发送记录列表" tabIndex={0}>{!deliveries.length && <p className="muted">还没有发送过邮件。</p>}{pageDeliveries.map((row) => <article className="delivery-record" key={row.id}><header><span className={`state-label ${row.status === "sent" ? "available" : "pending"}`}><i />{row.status === "sent" ? "已发送" : row.status === "pending" ? "等待发送" : "失败"}</span><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>{row.status !== "sent" && <button className="row-action" disabled={!!busy} onClick={() => retry(row.id)}>{busy === `retry-${row.id}` ? "发送中…" : "重试"}</button>}</header><p className="delivery-recipient">{row.recipient}</p><p className="delivery-subject">{row.subject}</p>{row.error && <p className="delivery-error">{row.error}</p>}<span className="delivery-attempts">已尝试 {row.attempt_count} 次</span></article>)}</div>
      <RecordPagination label="邮件记录" total={deliveries.length} page={currentDeliveryPage} pageSize={5} onChange={setDeliveryPage} regionId="mail-history" />
    </section>
    <section id="audit-history" tabIndex={-1} className="flat-section log-section history-section" hidden={tab !== "logs"}><header><div><h2>操作日志</h2><p>系统保留最近的管理员操作和变更摘要。</p></div><div className="audit-filters"><input aria-label="筛选操作" placeholder="搜索操作或对象名称" value={auditQuery} onChange={(e) => { setAuditQuery(e.target.value); setAuditPage(1); }} /><Select aria-label="筛选对象" compact value={auditTarget} onChange={(value) => { setAuditTarget(value); setAuditPage(1); }} options={[{ value: "", label: "全部对象" }, ...auditTargets.map((target) => ({ value: target, label: targetLabels[target] ?? "系统记录" }))]} /></div></header><div className="audit-list">{!filteredAudit.length && <div className="search-empty" role="status"><h3>{auditState === "loading" ? "正在加载操作记录…" : auditState === "error" ? "操作记录暂时无法加载" : audit.length ? "没有匹配的操作记录" : "暂无操作记录"}</h3><p>{auditState === "error" ? "请检查连接后点击刷新重试。" : "搜索范围为最近 300 条记录，可按操作名称和对象筛选。"}</p>{(auditQuery || auditTarget) && <button className="secondary-action" onClick={() => { setAuditQuery(""); setAuditTarget(""); setAuditPage(1); }}>清空筛选</button>}</div>}{pageAudit.map((row) => <details className="audit-entry" key={row.id}><summary><time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString("zh-CN")}</time><strong>{actionLabel(row.action)}</strong><span className="audit-target">{targetLabels[row.target_type] ?? "系统记录"}{row.target_name ? ` · ${row.target_name}` : ""}</span><span className="audit-disclosure">查看变更<ChevronDown aria-hidden="true" /></span></summary><div className="audit-detail"><dl className="audit-changes">{auditChanges(row.display_before ?? row.before_data, row.display_after ?? row.after_data).map((change) => <div key={change.key}><dt>{change.label}</dt><dd><span>{change.before}</span><span aria-hidden="true"> → </span><strong>{change.after}</strong></dd></div>)}</dl><details className="technical-details"><summary>技术详情</summary><pre>{JSON.stringify({ action: row.action, target: row.target_id, before: row.before_data, after: row.after_data }, null, 2)}</pre></details></div></details>)}</div><RecordPagination label="操作日志" total={filteredAudit.length} page={currentAuditPage} pageSize={10} onChange={setAuditPage} regionId="audit-history" /></section>
  </div>;
}
