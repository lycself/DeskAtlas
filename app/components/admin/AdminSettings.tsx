"use client";

import { Check, CircleAlert, MailCheck, Plus, RefreshCw, Send, SlidersHorizontal } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { AdminTeachers } from "./AdminTeachers";

import { api } from "@/app/lib/api";
import type { Major } from "@/app/lib/types";

type Smtp = { host?: string; port?: number; security?: string; username?: string; sender_name?: string; sender_email?: string; has_password?: boolean; is_configured: boolean };
type Delivery = { id: number; recipient: string; subject: string; status: string; error?: string | null; attempt_count: number; created_at: string };
type Audit = { id: number; action: string; target_type: string; target_id?: string | null; before_data?: unknown; after_data?: unknown; created_at: string };

export function AdminSettings({ active = true }: { active?: boolean }) {
  const [majors, setMajors] = useState<Major[]>([]);
  const [newMajor, setNewMajor] = useState("");
  const [smtp, setSmtp] = useState<Smtp>({ is_configured: false });
  const [smtpPassword, setSmtpPassword] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditTarget, setAuditTarget] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const busyRef = useRef(false);
  const [smtpLoaded, setSmtpLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [tab, setTab] = useState("smtp");
  const markDirty = () => { dirtyRef.current = true; setDirty(true); };

  const load = async (signal?: AbortSignal) => {
    const results = await Promise.allSettled([
      api<Major[]>("/api/admin/majors", { signal }).then(setMajors),
      api<Delivery[]>("/api/admin/email-deliveries", { signal }).then(setDeliveries),
      api<Audit[]>("/api/admin/audit", { signal }).then(setAudit),
      api<Smtp>("/api/admin/smtp", { signal }).then((config) => { if (!dirtyRef.current) setSmtp(config); setSmtpLoaded(true); }),
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
    setMajors((rows) => rows.map((row) => row.id === updated.id ? updated : row)); setMessage("教研中心设置已更新");
  });
  const saveSmtp = (event: FormEvent) => {
    event.preventDefault();
    void run("save", async () => {
      const saved = await api<Smtp>("/api/admin/smtp", { method: "PUT", body: JSON.stringify({
        host: smtp.host?.trim(), port: Number(smtp.port ?? 587), security: smtp.security ?? "starttls", username: smtp.username?.trim() ?? "", password: smtpPassword || null,
        sender_name: smtp.sender_name?.trim() || "DeskAtlas", sender_email: smtp.sender_email?.trim(),
      }) });
      setSmtp(saved); setSmtpPassword(""); dirtyRef.current = false; setDirty(false); setMessage("SMTP 配置已保存，可以发送测试邮件。");
    });
  };
  const showDeliveryResult = (result: { status: string; error?: string }) => {
    if (result.status === "sent") setMessage("邮件已发送");
    else setError(`邮件发送失败：${result.error || "请检查 SMTP 配置"}`);
  };
  const refreshDeliveries = async () => setDeliveries(await api<Delivery[]>("/api/admin/email-deliveries"));
  const test = (event: FormEvent) => {
    event.preventDefault();
    if (dirty || !smtp.is_configured) { setError("请先保存 SMTP 配置，再发送测试邮件。"); return; }
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
  const filteredAudit = audit.filter((row) => (!auditQuery || row.action.toLowerCase().includes(auditQuery.toLowerCase())) && (!auditTarget || row.target_type === auditTarget));

  return <div className="admin-page">
    <header className="page-heading"><h1>教研中心与设置</h1><button className="secondary-action" disabled={!!busy} onClick={() => void run("refresh", () => load())}><RefreshCw size={16} />刷新</button></header>
    {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}{message && <p className="success-banner"><Check size={16} />{message}</p>}
    <div className="section-tabs" role="group" aria-label="设置分类">{[["smtp", "邮箱设置"], ["majors", "教研中心选项"], ["teachers", "教研组教师"], ["logs", "邮件与操作记录"]].map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    <AdminTeachers majors={majors} active={active && tab === "teachers"} />
    <div className="settings-grid">
      <section className="flat-section major-settings" hidden={tab !== "majors"}><header><div><h2>教研中心选项</h2><p>停用后不再出现在新申请中，历史数据不受影响。</p></div><SlidersHorizontal /></header><form className="inline-create" onSubmit={addMajor}><input value={newMajor} onChange={(e) => setNewMajor(e.target.value)} placeholder="新增教研中心名称" /><button><Plus size={15} />添加</button></form><div className="setting-rows">{majors.map((major) => <div key={major.id}><input value={major.name} onChange={(e) => setMajors((rows) => rows.map((row) => row.id === major.id ? { ...row, name: e.target.value } : row))} /><button disabled={!!busy || !major.name.trim()} onClick={() => updateMajor(major, { name: major.name.trim() })}>保存</button><label className="switch"><input type="checkbox" disabled={!!busy} checked={!!major.is_active} onChange={(e) => updateMajor(major, { is_active: e.target.checked })} /><i /></label><span>{major.is_active ? "启用" : "停用"}</span></div>)}</div></section>
      <section className="flat-section smtp-settings" hidden={tab !== "smtp"}><header><div><h2>SMTP 邮件</h2><p>密码加密保存，审批结果不会因邮件失败而回滚。</p></div><MailCheck /></header><form onSubmit={saveSmtp} onChange={markDirty}><fieldset disabled={!!busy || !smtpLoaded}><div className="field-grid two"><label><span>服务器</span><input required value={smtp.host ?? ""} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} /></label><label><span>端口</span><input required type="number" min={1} max={65535} value={smtp.port ?? 587} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} /></label></div><div className="field-grid two"><label><span>加密方式</span><select value={smtp.security ?? "starttls"} onChange={(e) => setSmtp({ ...smtp, security: e.target.value })}><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">不加密</option></select></label><label><span>用户名</span><input value={smtp.username ?? ""} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} /></label></div><label><span>密码或授权码</span><input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} placeholder={smtp.has_password ? "已配置；留空表示不修改" : "请输入密码或授权码"} /></label><div className="field-grid two"><label><span>发件人名称</span><input required value={smtp.sender_name ?? "DeskAtlas"} onChange={(e) => setSmtp({ ...smtp, sender_name: e.target.value })} /></label><label><span>发件邮箱</span><input required type="email" value={smtp.sender_email ?? ""} onChange={(e) => setSmtp({ ...smtp, sender_email: e.target.value })} /></label></div><button className="primary-action compact">{busy === "save" ? "正在保存…" : "保存 SMTP 配置"}</button>{dirty && <p className="form-hint">有未保存的更改</p>}</fieldset></form><form className="smtp-test" onSubmit={test}><input required type="email" aria-label="接收测试邮件的地址" placeholder="接收测试邮件的地址" value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)} /><button disabled={!!busy || !smtpLoaded || !smtp.is_configured || dirty || !testRecipient}><Send size={15} />{busy === "test" ? "正在发送…" : "发送测试"}</button></form><p className="form-hint">测试使用已保存的配置。发送可能需要十几秒，请等待结果。</p></section>
    </div>
    <section className="flat-section log-section" hidden={tab !== "logs"}><header><div><h2>邮件发送记录</h2><p>最近 100 条；失败项目可直接重试。</p></div></header><div className="seat-table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>收件人</th><th>主题</th><th>状态</th><th>尝试</th><th /></tr></thead><tbody>{deliveries.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString("zh-CN")}</td><td>{row.recipient}</td><td>{row.subject}</td><td><span className={`state-label ${row.status === "sent" ? "available" : "pending"}`}><i />{row.status === "sent" ? "已发送" : row.status === "pending" ? "等待发送" : "失败"}</span>{row.error && <small>{row.error}</small>}</td><td>{row.attempt_count}</td><td>{row.status !== "sent" && <button className="row-action" disabled={!!busy} onClick={() => retry(row.id)}>{busy === `retry-${row.id}` ? "发送中…" : "重试"}</button>}</td></tr>)}</tbody></table></div></section>
    <section className="flat-section log-section" hidden={tab !== "logs"}><header><div><h2>操作日志</h2><p>系统保留最近的管理员操作和变更摘要。</p></div><div className="audit-filters"><input aria-label="筛选操作" placeholder="筛选操作" value={auditQuery} onChange={(e) => setAuditQuery(e.target.value)} /><select aria-label="筛选对象" value={auditTarget} onChange={(e) => setAuditTarget(e.target.value)}><option value="">全部对象</option>{auditTargets.map((target) => <option key={target}>{target}</option>)}</select></div></header><div className="audit-list">{filteredAudit.map((row) => <div key={row.id}><time>{new Date(row.created_at).toLocaleString("zh-CN")}</time><strong>{row.action}</strong><span>{row.target_type}{row.target_id ? ` #${row.target_id}` : ""}</span><details><summary>查看变更</summary><pre>{JSON.stringify({ before: row.before_data, after: row.after_data }, null, 2)}</pre></details></div>)}</div></section>
  </div>;
}
