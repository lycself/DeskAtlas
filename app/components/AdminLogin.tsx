"use client";

import { ArrowRight, CircleAlert, KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { api } from "@/app/lib/api";
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

export function AdminLogin() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
      router.replace("/admin");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <div className="login-orb one" /><div className="login-orb two" />
      <header className="login-header">
        <Brand />
        <ThemeToggle />
      </header>
      <section className="login-panel glass-surface">
        <span className="login-symbol"><KeyRound /></span>
        <h1>管理员登录</h1>
        <form onSubmit={submit}>
          <label><span>用户名</span><input autoComplete="username" required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
          <label><span>密码</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="form-error"><CircleAlert size={16} />{error}</p>}
          <button className="primary-action" disabled={loading}>{loading ? "正在验证…" : "进入管理平台"}<ArrowRight size={17} /></button>
        </form>
      </section>
    </main>
  );
}
