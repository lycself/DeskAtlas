"use client";

import { Archive, Check, CircleAlert, Copy, ExternalLink, FolderOpen, LockKeyhole, RefreshCw, ScrollText, Users } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

import { confirmDialog } from "@/app/components/ConfirmDialog";
import { EditableForm } from "@/app/components/EditableForm";
import { api } from "@/app/lib/api";
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

type Address = { address: string; primary: boolean };
type UpdateInfo = { status: string; latest?: string | null; notes?: string | null; error?: string | null; checked_at?: string | null };
type PanelSettings = {
  port: number; public_address: string; autostart: boolean; prevent_sleep: boolean; auto_backup: boolean; backup_keep: number; update_url: string; update_token_configured: boolean;
  https_enabled: boolean; https_domain: string; alidns_key_id: string; alidns_secret_configured: boolean;
};
type HttpsInfo = { supported: boolean; active: boolean; status: string; domain: string; error?: string | null; certificate_expires?: string | null; certificate_valid: boolean };
type SettingsChanges = Partial<PanelSettings> & { update_token?: string; alidns_secret?: string };
type PanelState = {
  available: boolean;
  version: string;
  addresses: Address[];
  running?: boolean;
  platform?: string;
  server_error?: string | null;
  port?: number;
  display_url?: string;
  settings?: PanelSettings;
  supports?: { autostart: boolean; prevent_sleep: boolean; open: boolean };
  data_dir?: string;
  backup_dir?: string;
  last_backup?: string | null;
  update?: UpdateInfo;
  https?: HttpsInfo;
};

const updateLabels: Record<string, string> = {
  idle: "尚未检查更新",
  checking: "正在检查…",
  latest: "已是最新版本",
  available: "发现新版本",
  downloading: "正在下载更新…",
  ready: "更新已下载，等待安装",
  error: "检查更新失败",
  unsigned: "非官方更新源需要签名的更新清单",
};

export function PanelApp() {
  const [state, setState] = useState<PanelState | null>(null);
  const [form, setForm] = useState<PanelSettings | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [updateToken, setUpdateToken] = useState("");
  const [clearUpdateToken, setClearUpdateToken] = useState(false);
  const [alidnsSecret, setAlidnsSecret] = useState("");
  const busyRef = useRef(false);
  // Text settings read as saved values until 编辑; while one form is being edited, refreshes leave the values alone.
  const [editing, setEditingState] = useState<"" | "https" | "settings">("");
  const editingRef = useRef<"" | "https" | "settings">("");
  const setEditing = (next: "" | "https" | "settings") => { editingRef.current = next; setEditingState(next); };

  const refresh = useCallback(async () => {
    try {
      const next = await api<PanelState>("/api/panel/state");
      setState(next);
      if (next.settings && !editingRef.current) setForm(next.settings);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法连接本机服务");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const run = async (label: string, action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError(""); setMessage("");
    try { await action(); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); }
    finally { busyRef.current = false; setBusy(""); }
  };

  const saveSettings = (changes: SettingsChanges, label = "save") => run(label, async () => {
    const result = await api<{ restarting?: boolean; url?: string; message?: string }>("/api/panel/settings", { method: "PUT", body: JSON.stringify(changes) });
    if (label === "save" || label === "https-save") setEditing("");
    if (changes.update_token !== undefined) { setUpdateToken(""); setClearUpdateToken(false); }
    if (changes.alidns_secret !== undefined) setAlidnsSecret("");
    if (result.restarting && result.url) {
      setMessage(`端口已修改，正在用新地址重新打开面板…`);
      window.setTimeout(() => window.location.replace(`${result.url}/panel`), 1800);
      return;
    }
    setMessage(result.message ?? "设置已保存");
  });

  const cancelEdit = () => {
    if (state?.settings) setForm(state.settings);
    setAlidnsSecret(""); setUpdateToken(""); setClearUpdateToken(false); setEditing("");
  };

  const submitForm = (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    void saveSettings({ port: form.port, public_address: form.public_address.trim(), backup_keep: form.backup_keep, update_url: form.update_url.trim(),
      ...(clearUpdateToken ? { update_token: "" } : updateToken.trim() ? { update_token: updateToken.trim() } : {}),
    });
  };

  const toggle = (key: "autostart" | "prevent_sleep" | "auto_backup", value: boolean) => {
    setForm((current) => current ? { ...current, [key]: value } : current);
    void saveSettings({ [key]: value } as Partial<PanelSettings>, key);
  };

  const httpsFields = (current: PanelSettings): SettingsChanges => ({
    https_domain: current.https_domain.trim(), alidns_key_id: current.alidns_key_id.trim(),
    ...(alidnsSecret.trim() ? { alidns_secret: alidnsSecret.trim() } : {}),
  });

  const toggleHttps = async (enabled: boolean) => {
    if (!form) return;
    const domain = form.https_domain.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (enabled && !await confirmDialog({
      title: "启用 HTTPS 域名访问？",
      body: `启用后学生通过 https://${domain || "你的域名"} 访问，原来的 http://IP:端口 地址会停止服务。请先确认域名已解析到这台电脑。`,
      confirmLabel: "启用",
    })) return;
    void saveSettings({ ...httpsFields(form), https_enabled: enabled }, "https");
  };

  const submitHttps = (event: FormEvent) => {
    event.preventDefault();
    if (form) void saveSettings(httpsFields(form), "https-save");
  };

  const open = (target: string) => run(`open-${target}`, async () => { await api(`/api/panel/open?target=${target}`, { method: "POST" }); });
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setMessage(`已复制 ${text}`); }
    catch { setError("复制失败，请手动选择地址"); }
  };

  const displayUrl = state?.display_url ?? (state?.addresses[0] ? `http://${state.addresses[0].address}:${state.port ?? 8080}` : "");
  const statusClass = !state ? "" : state.server_error ? "down" : state.update?.status === "available" || state.update?.status === "ready" ? "update" : "";
  const https = state?.https;
  const httpsStatus = !https || !form?.https_enabled ? null
    : https.certificate_valid && https.active ? { tone: "ok", text: `已启用，证书有效期至 ${new Date(https.certificate_expires ?? "").toLocaleDateString("zh-CN")}，到期前自动续期。` }
    : https.error ? { tone: "error", text: https.error }
    : https.active ? { tone: "pending", text: "正在申请证书，通常一两分钟内完成…" }
    : { tone: "error", text: "HTTPS 设置不完整，请检查下面的字段。" };
  const statusText = !state ? "正在连接…" : state.server_error ? "服务异常" : state.available ? "服务运行中" : "开发模式";

  return (
    <main className="panel-shell">
      <header className="panel-header">
        <Brand compact href="/panel" />
        <div className="panel-header-actions">
          <span className={`panel-status ${statusClass}`}><i />{statusText}</span>
          <ThemeToggle />
        </div>
      </header>
      {error && <p className="form-error"><CircleAlert size={16} />{error}</p>}
      {message && <p className="success-banner"><Check size={16} />{message}</p>}
      {state && !state.available && <p className="panel-notice">当前由开发服务器运行，没有托盘程序。桌面版会在这里显示设置和更新。</p>}
      {state?.server_error && <p className="form-error"><CircleAlert size={16} />{state.server_error}</p>}

      <section className="panel-card card-surface">
        <h2>学生访问地址</h2>
        <p>把下面的地址发给学生，或让他们扫码打开工位地图。电脑联网方式改变时地址会自动更新。</p>
        {!https?.active && state?.addresses.length === 0 && <p className="panel-notice">没有检测到局域网地址，请确认电脑已连接校园网。</p>}
        {https?.active && displayUrl && <div className="panel-address-row primary">
          <span>{displayUrl}<em>HTTPS</em></span>
          <button className="icon-button" aria-label="复制地址" title="复制地址" onClick={() => void copy(displayUrl)}><Copy size={15} /></button>
        </div>}
        {!https?.active && state?.addresses.map((item) => {
          const url = `http://${item.address}:${state.port ?? form?.port ?? 8080}`;
          return <div key={item.address} className={`panel-address-row ${item.primary ? "primary" : ""}`}>
            <span>{url}{item.primary && <em>推荐</em>}</span>
            <button className="icon-button" aria-label="复制地址" title="复制地址" onClick={() => void copy(url)}><Copy size={15} /></button>
          </div>;
        })}
        {displayUrl && <div className="panel-qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/panel/qr.svg?text=${encodeURIComponent(displayUrl)}`} alt="访问二维码" />
          <div>
            <strong>{displayUrl}</strong>
            <small>{https?.active ? "二维码对应 HTTPS 域名。" : "二维码对应“对外显示地址”。留空则使用推荐地址。"}</small>
          </div>
        </div>}
        {state?.platform === "win32" && https?.active && <p className="panel-notice">学生打不开地址？第一次启用 HTTPS 时，Windows 会询问是否允许 caddy 访问网络，请选择“允许访问”。也请确认域名的 A 记录指向这台电脑的 IP。</p>}
        {state?.platform === "win32" && !https?.active && <p className="panel-notice">学生打不开地址？DeskAtlas 第一次运行时，Windows 会询问是否允许它访问网络，请选择“允许访问”（专用和公用网络都勾选）。如果当时点了取消，可在“Windows 安全中心 → 防火墙和网络保护 → 允许应用通过防火墙”中勾选 DeskAtlas。</p>}
        <div className="panel-buttons">
          <button disabled={!state?.available || !!busy} onClick={() => void open("public")}><Users size={15} />打开学生端</button>
          <button disabled={!state?.available || !!busy} onClick={() => void open("admin")}><ExternalLink size={15} />打开管理端</button>
        </div>
      </section>

      {form && https?.supported && <section className="panel-card card-surface">
        <h2>HTTPS 域名访问</h2>
        <label className="panel-toggle">
          <div><strong>通过 HTTPS 域名访问</strong><small>用阿里云 DNS 验证自动申请并续期证书，电脑不需要能从校外访问。</small></div>
          <span className="switch"><input type="checkbox" disabled={!!busy} checked={form.https_enabled} onChange={(event) => void toggleHttps(event.target.checked)} /><i /></span>
        </label>
        {httpsStatus && <p className={`panel-https-status ${httpsStatus.tone}`}>{httpsStatus.tone === "ok" ? <LockKeyhole size={15} /> : httpsStatus.tone === "error" ? <CircleAlert size={15} /> : <RefreshCw size={15} />}{httpsStatus.text}</p>}
        <EditableForm className="panel-form" editing={editing === "https"} busy={busy === "https-save"} canEdit={!!state?.available && !editing && !busy}
          onEdit={() => setEditing("https")} onCancel={cancelEdit} onSubmit={submitHttps} saveLabel="保存 HTTPS 设置">
          <label className="panel-field"><span>域名</span><input placeholder="例如 physdesk.cn" autoComplete="off" spellCheck={false} maxLength={260} value={form.https_domain} onChange={(event) => setForm({ ...form, https_domain: event.target.value })} /></label>
          <div className="panel-inline">
            <label className="panel-field"><span>阿里云 AccessKey ID</span><input autoComplete="off" spellCheck={false} maxLength={128} placeholder="以 LTAI 开头" value={form.alidns_key_id} onChange={(event) => setForm({ ...form, alidns_key_id: event.target.value })} /></label>
            <label className="panel-field"><span>AccessKey Secret</span><input type="password" autoComplete="off" maxLength={128} placeholder={editing === "https" ? form.alidns_secret_configured ? "已配置，留空保留" : "" : form.alidns_secret_configured ? "已配置" : "未配置"} value={alidnsSecret} onChange={(event) => setAlidnsSecret(event.target.value)} /></label>
          </div>
          <p className="panel-notice">先在阿里云“云解析 DNS”把域名的 A 记录指向这台电脑的 IP{state?.addresses[0] ? `（${state.addresses[0].address}）` : ""}。AccessKey 只需授予 AliyunDNSFullAccess 权限，Secret 加密保存在本机。</p>
        </EditableForm>
      </section>}

      <section className="panel-card card-surface">
        <h2>备份</h2>
        <p>{state?.last_backup ? `最近一次备份：${new Date(state.last_backup).toLocaleString("zh-CN")}` : "还没有备份。"}{state?.backup_dir && <><br /><code>{state.backup_dir}</code></>}</p>
        <div className="panel-buttons">
          <button disabled={!state?.available || !!busy} onClick={() => void run("backup", async () => { const result = await api<{ name: string }>("/api/panel/backup", { method: "POST" }); setMessage(`已生成 ${result.name}`); })}><Archive size={15} />{busy === "backup" ? "正在备份…" : "立即备份"}</button>
          <button disabled={!state?.available || !!busy} onClick={() => void open("backups")}><FolderOpen size={15} />打开备份目录</button>
          <button disabled={!state?.available || !!busy} onClick={() => void open("data")}><FolderOpen size={15} />打开数据目录</button>
          <button disabled={!state?.available || !!busy} onClick={() => void open("logs")}><ScrollText size={15} />查看日志</button>
        </div>
      </section>

      <section className="panel-card card-surface">
        <h2>运行设置</h2>
        {!form && <p>桌面版运行时，可在这里修改服务端口、开机自启动、防睡眠和自动备份；开发模式下没有这些设置。</p>}
        {form && <>
          <label className="panel-toggle">
            <div><strong>开机自动启动</strong><small>登录电脑后自动运行并对外提供服务。</small></div>
            <span className="switch"><input type="checkbox" disabled={!state?.supports?.autostart || !!busy} checked={form.autostart} onChange={(event) => toggle("autostart", event.target.checked)} /><i /></span>
          </label>
          <label className="panel-toggle">
            <div><strong>阻止电脑睡眠</strong><small>运行期间保持电脑唤醒，屏幕仍可正常关闭。</small></div>
            <span className="switch"><input type="checkbox" disabled={!state?.supports?.prevent_sleep || !!busy} checked={form.prevent_sleep} onChange={(event) => toggle("prevent_sleep", event.target.checked)} /><i /></span>
          </label>
          <label className="panel-toggle">
            <div><strong>每日自动备份</strong><small>每天自动生成备份包并保留最近若干份。</small></div>
            <span className="switch"><input type="checkbox" disabled={!state?.available || !!busy} checked={form.auto_backup} onChange={(event) => toggle("auto_backup", event.target.checked)} /><i /></span>
          </label>
          <EditableForm className="panel-form" editing={editing === "settings"} busy={busy === "save"} canEdit={!!state?.available && !editing && !busy}
            onEdit={() => setEditing("settings")} onCancel={cancelEdit} onSubmit={submitForm} saveLabel="保存设置">
            <div className="panel-inline">
              <label className="panel-field"><span>服务端口</span><input type="number" min={1} max={65535} required value={form.port} onChange={(event) => setForm({ ...form, port: Number(event.target.value) })} /></label>
              <label className="panel-field"><span>自动备份保留份数</span><input type="number" min={1} max={365} required value={form.backup_keep} onChange={(event) => setForm({ ...form, backup_keep: Number(event.target.value) })} /></label>
            </div>
            <label className="panel-field"><span>对外显示地址（可选，例如固定 IP 或域名）</span><input placeholder="留空使用推荐地址" value={form.public_address} onChange={(event) => setForm({ ...form, public_address: event.target.value })} /></label>
            <label className="panel-field"><span>更新源地址</span><input placeholder="https://…/latest.json" value={form.update_url} onChange={(event) => setForm({ ...form, update_url: event.target.value })} /></label>
            <label className="panel-field"><span>GitHub 更新 token（私有仓库）</span><input type="password" autoComplete="off" maxLength={500} disabled={!!busy || clearUpdateToken} placeholder={editing === "settings" ? form.update_token_configured ? "已配置，留空保留现有 token" : "填写具有仓库 Contents 读取权限的 token" : form.update_token_configured ? "已配置" : "未配置"} value={updateToken} onChange={(event) => setUpdateToken(event.target.value)} /></label>
            <p className="panel-notice">仅用于官方 GitHub 仓库更新，token 加密保存在本机。选择 DeskAtlas 仓库并授予 Contents 读取权限，保存后点击“检查更新”。</p>
            {editing === "settings" && form.update_token_configured && <label className="check-control"><input type="checkbox" disabled={!!busy} checked={clearUpdateToken} onChange={(event) => setClearUpdateToken(event.target.checked)} /> 清除已保存的 token（保存后生效）</label>}
          </EditableForm>
        </>}
      </section>

      <section className="panel-card card-surface">
        <h2>软件更新</h2>
        <p>
          当前版本 {state?.version ?? "…"}。{state?.update ? updateLabels[state.update.status] ?? state.update.status : ""}
          {state?.update?.latest && state.update.status !== "latest" ? `：${state.update.latest}` : ""}
          {state?.update?.error ? `（${state.update.error}）` : ""}
        </p>
        {state?.update?.notes && <pre className="panel-notes">{state.update.notes}</pre>}
        <div className="panel-buttons">
          <button disabled={!state?.available || !!busy} onClick={() => void run("check", async () => { await api("/api/panel/update/check", { method: "POST" }); })}><RefreshCw size={15} />{busy === "check" ? "正在检查…" : "检查更新"}</button>
          <button className="accent" disabled={!state?.available || !!busy || !(state?.update?.status === "available" || state?.update?.status === "ready")} onClick={async () => {
            const linux = state?.platform === "linux";
            if (linux || await confirmDialog({ title: "现在安装更新？", body: "安装更新会短暂停止服务并自动重新启动。", confirmLabel: "立即更新" })) void run("apply", async () => {
              await api("/api/panel/update/apply", { method: "POST" });
              setMessage(linux ? "正在下载更新包，完成后会打开系统安装器。安装后退出并重新启动 DeskAtlas。" : "正在下载并安装更新，程序会自动重启。");
            });
          }}>{state?.platform === "linux" ? "下载更新包" : "立即更新"}</button>
        </div>
      </section>

      <footer className="panel-footer">关闭此窗口不会停止服务；从任务栏图标右键“退出”才会停止。{state?.data_dir && <><br />数据目录 <code>{state.data_dir}</code></>}</footer>
    </main>
  );
}
