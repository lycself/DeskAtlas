"use client";

import { Check, CircleAlert, MailCheck, Plus, RefreshCw, Send, SlidersHorizontal } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { api } from "@/app/lib/api";
import type { Major } from "@/app/lib/types";

type Smtp = { host?: string; port?: number; security?: string; username?: string; sender_name?: string; sender_email?: string; has_password?: boolean; is_configured: boolean };
type Delivery = { id: number; recipient: string; subject: string; status: string; error?: string | null; attempt_count: number; created_at: string };
type Audit = { id: number; action: string; target_type: string; target_id?: string | null; before_data?: unknown; after_data?: unknown; created_at: string };

export function AdminSettings() {
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

  const load = async () => {
    setError("");
    try {
      const [majorRows, smtpConfig, deliveryRows, auditRows] = await Promise.all([
        api<Major[]>("/api/admin/majors"), api<Smtp>("/api/admin/smtp"), api<Delivery[]>("/api/admin/email-deliveries"), api<Audit[]>("/api/admin/audit"),
      ]);
      setMajors(majorRows); setSmtp(smtpConfig); setDeliveries(deliveryRows); setAudit(auditRows);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "加载设置失败"); }
  };
  useEffect(() => { void load(); }, []);

  const addMajor = async (event: FormEvent) => {
    event.preventDefault(); if (!newMajor.trim()) return;
    try { await api("/api/admin/majors", { method: "POST", body: JSON.stringify({ name: newMajor, sort_order: majors.length + 1 }) }); setNewMajor(""); setMessage("专业已添加"); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "添加失败"); }
  };
  const updateMajor = async (major: Major, patch: Partial<Major>) => {
    try { await api(`/api/admin/majors/${major.id}`, { method: "PATCH", body: JSON.stringify(patch) }); setMessage("专业设置已更新"); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "更新失败"); }
  };
  const saveSmtp = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    try {
      await api("/api/admin/smtp", { method: "PUT", body: JSON.stringify({
        host: smtp.host, port: Number(smtp.port ?? 587), security: smtp.security ?? "starttls", username: smtp.username ?? "", password: smtpPassword || null,
        sender_name: smtp.sender_name ?? "DeskAtlas", sender_email: smtp.sender_email,
      }) });
      setSmtpPassword(""); setMessage("SMTP 配置已安全保存"); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "SMTP 保存失败"); }
  };
  const test = async () => {
    try { const result = await api<{ status: string; error?: string }>("/api/admin/smtp/test", { method: "POST", body: JSON.stringify({ recipient: testRecipient }) }); setMessage(result.status === "sent" ? "测试邮件已发送" : `测试发送失败：${result.error}`); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "测试失败"); }
  };
  const retry = async (id: number) => { try { await api(`/api/admin/email-deliveries/${id}/retry`, { method: "POST" }); setMessage("已重新尝试发送"); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "重试失败"); } };
  const auditTargets = useMemo(() => [...new Set(audit.map((row) => row.target_type))].sort(), [audit]);
  const filteredAudit = audit.filter((row) => (!auditQuery || row.action.toLowerCase().includes(auditQuery.toLowerCase())) && (!auditTarget || row.target_type === auditTarget));

  return <div className="admin-page">
    <header className="page-heading"><h1>专业、邮件与日志</h1><button className="secondary-action" onClick={load}><RefreshCw size={16} />刷新</button></header>
    {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}{message && <p className="success-banner"><Check size={16} />{message}</p>}
    <div className="settings-grid">
      <section className="flat-section major-settings"><header><div><h2>专业选项</h2><p>停用后不再出现在新申请中，历史数据不受影响。</p></div><SlidersHorizontal /></header><form className="inline-create" onSubmit={addMajor}><input value={newMajor} onChange={(e) => setNewMajor(e.target.value)} placeholder="新增专业名称" /><button><Plus size={15} />添加</button></form><div className="setting-rows">{majors.map((major) => <div key={major.id}><input value={major.name} onChange={(e) => setMajors((rows) => rows.map((row) => row.id === major.id ? { ...row, name: e.target.value } : row))} onBlur={() => updateMajor(major, { name: majors.find((row) => row.id === major.id)?.name })} /><label className="switch"><input type="checkbox" checked={major.is_active} onChange={(e) => updateMajor(major, { is_active: e.target.checked })} /><i /></label><span>{major.is_active ? "启用" : "停用"}</span></div>)}</div></section>
      <section className="flat-section smtp-settings"><header><div><h2>SMTP 邮件</h2><p>密码加密保存，审批结果不会因邮件失败而回滚。</p></div><MailCheck /></header><form onSubmit={saveSmtp}><div className="field-grid two"><label><span>服务器</span><input required value={smtp.host ?? ""} onChange={(e) => setSmtp({ ...smtp, host: e.target.value })} /></label><label><span>端口</span><input required type="number" value={smtp.port ?? 587} onChange={(e) => setSmtp({ ...smtp, port: Number(e.target.value) })} /></label></div><div className="field-grid two"><label><span>加密方式</span><select value={smtp.security ?? "starttls"} onChange={(e) => setSmtp({ ...smtp, security: e.target.value })}><option value="starttls">STARTTLS</option><option value="ssl">SSL/TLS</option><option value="none">不加密</option></select></label><label><span>用户名</span><input value={smtp.username ?? ""} onChange={(e) => setSmtp({ ...smtp, username: e.target.value })} /></label></div><label><span>密码或授权码</span><input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} placeholder={smtp.has_password ? "已配置；留空表示不修改" : "请输入密码或授权码"} /></label><div className="field-grid two"><label><span>发件人名称</span><input required value={smtp.sender_name ?? "DeskAtlas"} onChange={(e) => setSmtp({ ...smtp, sender_name: e.target.value })} /></label><label><span>发件邮箱</span><input required type="email" value={smtp.sender_email ?? ""} onChange={(e) => setSmtp({ ...smtp, sender_email: e.target.value })} /></label></div><button className="primary-action compact">保存 SMTP 配置</button></form><div className="smtp-test"><input type="email" placeholder="接收测试邮件的地址" value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)} /><button disabled={!testRecipient} onClick={test}><Send size={15} />发送测试</button></div></section>
    </div>
    <section className="flat-section log-section"><header><div><h2>邮件发送记录</h2><p>最近 100 条；失败项目可直接重试。</p></div></header><div className="seat-table-wrap"><table className="data-table"><thead><tr><th>时间</th><th>收件人</th><th>主题</th><th>状态</th><th>尝试</th><th /></tr></thead><tbody>{deliveries.map((row) => <tr key={row.id}><td>{new Date(row.created_at).toLocaleString("zh-CN")}</td><td>{row.recipient}</td><td>{row.subject}</td><td><span className={`state-label ${row.status === "sent" ? "available" : "pending"}`}><i />{row.status === "sent" ? "已发送" : "失败"}</span>{row.error && <small>{row.error}</small>}</td><td>{row.attempt_count}</td><td>{row.status !== "sent" && <button className="row-action" onClick={() => retry(row.id)}>重试</button>}</td></tr>)}</tbody></table></div></section>
    <section className="flat-section log-section"><header><div><h2>操作日志</h2><p>系统保留最近的管理员操作和变更摘要。</p></div><div className="audit-filters"><input aria-label="筛选操作" placeholder="筛选操作" value={auditQuery} onChange={(e) => setAuditQuery(e.target.value)} /><select aria-label="筛选对象" value={auditTarget} onChange={(e) => setAuditTarget(e.target.value)}><option value="">全部对象</option>{auditTargets.map((target) => <option key={target}>{target}</option>)}</select></div></header><div className="audit-list">{filteredAudit.map((row) => <div key={row.id}><time>{new Date(row.created_at).toLocaleString("zh-CN")}</time><strong>{row.action}</strong><span>{row.target_type}{row.target_id ? ` #${row.target_id}` : ""}</span><details><summary>查看变更</summary><pre>{JSON.stringify({ before: row.before_data, after: row.after_data }, null, 2)}</pre></details></div>)}</div></section>
  </div>;
}
