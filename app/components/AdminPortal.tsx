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
import dynamic from "next/dynamic";
import { useSpringHeader } from "@/app/hooks/useSpringHeader";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiError } from "@/app/lib/api";
const AdminApplications = dynamic(() => import("./admin/AdminApplications").then((module) => module.AdminApplications));
const AdminImport = dynamic(() => import("./admin/AdminImport").then((module) => module.AdminImport));
const AdminOverview = dynamic(() => import("./admin/AdminOverview").then((module) => module.AdminOverview));
const AdminRooms = dynamic(() => import("./admin/AdminRooms").then((module) => module.AdminRooms));
const AdminSettings = dynamic(() => import("./admin/AdminSettings").then((module) => module.AdminSettings));
const AdminStudents = dynamic(() => import("./admin/AdminStudents").then((module) => module.AdminStudents));
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

type Section = "overview" | "applications" | "rooms" | "students" | "import" | "settings";

const sections: Array<{ id: Section; label: string; icon: typeof Map }> = [
  { id: "overview", label: "运行概览", icon: LayoutDashboard },
  { id: "applications", label: "申请审批", icon: Activity },
  { id: "rooms", label: "房间与工位", icon: Map },
  { id: "students", label: "学生与工位", icon: Users },
  { id: "import", label: "数据导入", icon: FileSpreadsheet },
  { id: "settings", label: "教研中心与设置", icon: Settings },
];

export function AdminPortal() {
  const router = useRouter();
  const [sessionError, setSessionError] = useState("");
  const [visited, setVisited] = useState<Section[]>(["overview"]);
  const [ready, setReady] = useState(false);
  const headerRef = useSpringHeader(ready);
  const [section, setSection] = useState<Section>("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    api("/api/admin/session")
      .then(() => setReady(true))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/admin/login");
        else setSessionError("无法验证会话，请检查服务连接后重试。");
      });
  }, [router]);

  const logout = async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
      router.replace("/admin/login");
    } catch { setSessionError("退出失败，请检查网络后重试。"); }
  };

  if (!ready) return <main className="admin-loading"><Brand compact /><p>{sessionError || "正在验证管理员会话…"}</p>{sessionError && <button onClick={() => window.location.reload()}>重试</button>}</main>;

  const currentSection = sections.find((item) => item.id === section);

  const navigate = (next: Section) => {
    setSection(next);
    setVisited((current) => current.includes(next) ? current : [...current, next]);
    setNavOpen(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return (
    <main className={`admin-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <div className="admin-header-wrapper">
        <header className="admin-topbar" ref={headerRef}>
          <span className="nav-glass" aria-hidden="true" />
          <Brand href="/admin" />
          <button className="mobile-sidebar-toggle" aria-label="打开导航" onClick={() => setNavOpen(true)}><Menu /></button>
          <button className="desktop-sidebar-toggle" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} onClick={() => setSidebarCollapsed((value) => !value)}>
            {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
          <div className="admin-breadcrumb"><span>管理工作台</span><i>/</i><strong>{currentSection?.label}</strong></div>
          <div className="admin-topbar-actions">
            <Link className="admin-home-link" href="/" aria-label="返回首页" title="返回首页"><House size={17} /></Link>
            <ThemeToggle />
            <button className="topbar-logout" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={17} /></button>
          </div>
        </header>
      </div>
      <aside className={`admin-sidebar glass-surface ${navOpen ? "open" : ""}`}>
        <div className="admin-brand"><span>工作空间</span><button className="sidebar-mobile-close" aria-label="关闭导航" onClick={() => setNavOpen(false)}><X /></button></div>
        <nav>
          {sections.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} title={item.label} className={section === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="sidebar-footer"><span>DeskAtlas · 管理端</span></div>
      </aside>
      {navOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setNavOpen(false)} />}
      <section className="admin-main">
        {sessionError && <p className="form-error page-error">{sessionError}</p>}
        {visited.includes("overview") && <div hidden={section !== "overview"}><AdminOverview active={section === "overview"} onNavigate={navigate} /></div>}
        {visited.includes("applications") && <div hidden={section !== "applications"}><AdminApplications active={section === "applications"} /></div>}
        {visited.includes("rooms") && <div hidden={section !== "rooms"}><AdminRooms active={section === "rooms"} /></div>}
        {visited.includes("students") && <div hidden={section !== "students"}><AdminStudents active={section === "students"} /></div>}
        {visited.includes("import") && <div hidden={section !== "import"}><AdminImport /></div>}
        {visited.includes("settings") && <div hidden={section !== "settings"}><AdminSettings active={section === "settings"} /></div>}
      </section>
    </main>
  );
}
