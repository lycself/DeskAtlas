"use client";

import {
  Activity,
  FileSpreadsheet,
  House,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiError } from "@/app/lib/api";
import { AdminApplications } from "./admin/AdminApplications";
import { AdminImport } from "./admin/AdminImport";
import { AdminOverview } from "./admin/AdminOverview";
import { AdminRooms } from "./admin/AdminRooms";
import { AdminSettings } from "./admin/AdminSettings";
import { AdminStudents } from "./admin/AdminStudents";
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

type Section = "overview" | "applications" | "rooms" | "students" | "import" | "settings";

const sections: Array<{ id: Section; label: string; icon: typeof Map }> = [
  { id: "overview", label: "运行概览", icon: LayoutDashboard },
  { id: "applications", label: "申请审批", icon: Activity },
  { id: "rooms", label: "房间与平面图", icon: Map },
  { id: "students", label: "学生与工位", icon: Users },
  { id: "import", label: "数据导入", icon: FileSpreadsheet },
  { id: "settings", label: "专业、邮件与日志", icon: Settings },
];

export function AdminPortal() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<Section>("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    api("/api/admin/session")
      .then(() => setReady(true))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/admin/login");
      });
  }, [router]);

  const logout = async () => {
    await api("/api/admin/logout", { method: "POST" });
    router.replace("/admin/login");
  };

  if (!ready) return <main className="admin-loading"><Brand compact /><p>正在验证管理员会话…</p></main>;

  const currentSection = sections.find((item) => item.id === section);

  const navigate = (next: Section) => {
    setSection(next);
    setNavOpen(false);
  };

  return (
    <main className={`admin-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`admin-sidebar glass-surface ${navOpen ? "open" : ""}`}>
        <div className="admin-brand">
          <Brand href="/admin" />
          <button className="sidebar-mobile-close" aria-label="关闭导航" onClick={() => setNavOpen(false)}><X /></button>
        </div>
        <nav>
          {sections.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} title={item.label} className={section === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="sidebar-footer">
          <Link className="sidebar-home" href="/" title="返回首页"><House size={17} /><span>返回首页</span></Link>
          <div className="sidebar-footer-actions">
            <ThemeToggle />
            <button onClick={logout} title="退出登录"><LogOut size={17} /><span>退出登录</span></button>
          </div>
        </div>
      </aside>
      {navOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setNavOpen(false)} />}
      <section className="admin-main">
        <header className="admin-topbar glass-surface">
          <button className="mobile-sidebar-toggle" aria-label="打开导航" onClick={() => setNavOpen(true)}><Menu /></button>
          <button className="desktop-sidebar-toggle" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} onClick={() => setSidebarCollapsed((value) => !value)}>
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
          <nav className="admin-horizontal-nav" aria-label="管理功能">
            {sections.map((item) => (
              <button key={item.id} className={section === item.id ? "active" : ""} onClick={() => navigate(item.id)}>{item.label}</button>
            ))}
          </nav>
          <strong className="mobile-section-title">{currentSection?.label}</strong>
          <div className="admin-topbar-actions">
            <Link className="admin-home-link" href="/" aria-label="返回首页" title="返回首页"><House size={17} /></Link>
            <ThemeToggle />
            <button className="topbar-logout" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={17} /></button>
          </div>
        </header>
        {section === "overview" && <AdminOverview onNavigate={setSection} />}
        {section === "applications" && <AdminApplications />}
        {section === "rooms" && <AdminRooms />}
        {section === "students" && <AdminStudents />}
        {section === "import" && <AdminImport />}
        {section === "settings" && <AdminSettings />}
      </section>
    </main>
  );
}
