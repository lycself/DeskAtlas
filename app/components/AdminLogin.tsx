"use client";

import { ArrowLeft, ArrowRight, Archive, CircleAlert, KeyRound, ShieldPlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { FilePicker } from "./FilePicker";
import { api } from "@/app/lib/api";
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

type SetupStatus = { configured: boolean; packaged: boolean; database: string; version: string };
type Mode = "loading" | "login" | "create" | "restore";

export function AdminLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("loading");
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<SetupStatus>("/api/setup/status")
      .then((result) => { setStatus(result); setMode(result.configured ? "login" : "create"); })
      .catch(() => setMode("login"));
  }, []);

  const run = async (action: () => Promise<void>) => {
    setLoading(true);
    setError("");
    setMessage("");
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败"); }
    finally { setLoading(false); }
  };

  const submitLogin = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
      router.replace("/admin");
    });
  };

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) { setError("两次输入的密码不一致"); return; }
    void run(async () => {
      await api("/api/setup/initialize", { method: "POST", body: JSON.stringify({ username, password }) });
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
      router.replace("/admin");
    });
  };

  const submitRestore = (event: FormEvent) => {
    event.preventDefault();
    if (!file) { setError("请选择备份包"); return; }
    void run(async () => {
      const body = new FormData();
      body.append("file", file);
      const result = await api<SetupStatus>("/api/setup/restore", { method: "POST", body });
      setStatus(result);
      setRestored(true);
      setMode("create");
      setUsername("");
      setPassword("");
      setConfirmation("");
      setMessage("数据已导入，请设置本机的管理员用户名和密码。");
    });
  };

  const setupIntro = (
    <p className="login-intro">
      这是首次运行。请设置本机管理员账号；也可以先导入备份包，恢复房间、工位、学生资料和设置，再创建本机账号。
    </p>
  );

  return (
    <main className="login-shell">
      <header className="login-header">
        <Brand href="/" label="DeskAtlas 首页" />
        <div className="login-header-actions">
          <Link className="back-home-link" href="/"><ArrowLeft size={16} />返回首页</Link>
          <ThemeToggle />
        </div>
      </header>
      <section className="login-panel card-surface">
        {mode === "loading" && <p className="form-hint">正在检查系统状态…</p>}
        {mode === "login" && <>
          <span className="login-symbol"><KeyRound /></span>
          <h1>管理员登录</h1>
          {message && <p className="success-banner">{message}</p>}
          <form onSubmit={submitLogin}>
            <label><span>用户名</span><input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label><span>密码</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            {error && <p className="form-error"><CircleAlert size={16} />{error}</p>}
            <button className="primary-action" disabled={loading}>{loading ? "正在验证…" : "进入管理平台"}<ArrowRight size={17} /></button>
          </form>
        </>}
        {mode === "create" && <>
          <span className="login-symbol"><ShieldPlus /></span>
          <h1>{restored ? "设置本机管理员" : "初始化 DeskAtlas"}</h1>
          {!restored && setupIntro}
          {message && <p className="success-banner">{message}</p>}
          {!restored && <div className="section-tabs login-tabs" role="group" aria-label="初始化方式">
            <button aria-pressed disabled={loading} onClick={() => setMode("create")}>创建管理员</button>
            <button aria-pressed={false} disabled={loading} onClick={() => { setMode("restore"); setError(""); }}>从备份包恢复</button>
          </div>}
          <form onSubmit={submitCreate}>
            <label><span>管理员用户名</span><input autoComplete="username" required minLength={3} maxLength={40} pattern="[A-Za-z0-9_.@-]+" value={username} onChange={(event) => setUsername(event.target.value)} /></label>
            <label><span>密码（至少 12 个字符）</span><input type="password" autoComplete="new-password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <label><span>再次输入密码</span><input type="password" autoComplete="new-password" required minLength={12} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
            {error && <p className="form-error"><CircleAlert size={16} />{error}</p>}
            <button className="primary-action" disabled={loading}>{loading ? "正在创建…" : "创建并进入管理平台"}<ArrowRight size={17} /></button>
          </form>
        </>}
        {mode === "restore" && <>
          <span className="login-symbol"><Archive /></span>
          <h1>从备份包恢复</h1>
          {setupIntro}
          <div className="section-tabs login-tabs" role="group" aria-label="初始化方式">
            <button aria-pressed={false} disabled={loading} onClick={() => { setMode("create"); setError(""); }}>创建管理员</button>
            <button aria-pressed disabled={loading} onClick={() => setMode("restore")}>从备份包恢复</button>
          </div>
          <form onSubmit={submitRestore}>
            <div><span>备份包（.zip）</span><FilePicker file={file} onChange={setFile} accept=".zip" maxMB={2048} label="选择备份包" /></div>
            <p className="form-hint">导入房间与学生数据、上传文件和邮件设置。导入后需创建本机管理员账号。</p>
            {error && <p className="form-error"><CircleAlert size={16} />{error}</p>}
            <button className="primary-action" disabled={loading || !file}>{loading ? "正在恢复…" : "导入并设置本机账号"}<ArrowRight size={17} /></button>
          </form>
        </>}
        {status && <p className="login-version">DeskAtlas {status.version}{status.packaged ? " · 桌面版" : ""}</p>}
      </section>
    </main>
  );
}
