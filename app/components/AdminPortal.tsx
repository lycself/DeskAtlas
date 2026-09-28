"use client";

import {
  Activity,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  House,
  LayoutDashboard,
  LogOut,
  Map,
  Menu,
  Search,
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
import type { AdminJump } from "@/app/lib/types";
const AdminApplications = dynamic(() => import("./admin/AdminApplications").then((module) => module.AdminApplications));
const AdminImport = dynamic(() => import("./admin/AdminImport").then((module) => module.AdminImport));
const AdminOverview = dynamic(() => import("./admin/AdminOverview").then((module) => module.AdminOverview));
const AdminRooms = dynamic(() => import("./admin/AdminRooms").then((module) => module.AdminRooms));
const AdminSettings = dynamic(() => import("./admin/AdminSettings").then((module) => module.AdminSettings));
const AdminStudents = dynamic(() => import("./admin/AdminStudents").then((module) => module.AdminStudents));
import { Brand } from "./Brand";
import { CommandPalette } from "./admin/CommandPalette";
import { ThemeToggle } from "./ThemeToggle";

type Section = "overview" | "applications" | "rooms" | "students" | "import" | "settings";

const sections: Array<{ id: Section; label: string; icon: typeof Map }> = [
  { id: "overview", label: "运行概览", icon: LayoutDashboard },
  { id: "applications", label: "申请审批", icon: Activity },
  { id: "rooms", label: "房间与工位", icon: Map },
  { id: "students", label: "学生名册", icon: Users },
  { id: "import", label: "数据导入", icon: FileSpreadsheet },
  { id: "settings", label: "系统设置", icon: Settings },
];

/** Sections live in the URL hash (`#rooms`, `#rooms/12`) so reload and the back button keep working. */
function sectionFromHash(): Section {
  const head = window.location.hash.replace(/^#/, "").split("/")[0];
  return sections.some((item) => item.id === head) ? (head as Section) : "overview";
}

export function AdminPortal() {
  const router = useRouter();
  const [sessionError, setSessionError] = useState("");
  const [visited, setVisited] = useState<Section[]>(["overview"]);
  const [ready, setReady] = useState(false);
  const headerRef = useSpringHeader(ready);
  const [section, setSection] = useState<Section>("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [jump, setJump] = useState<AdminJump | null>(null);

  useEffect(() => {
    api("/api/admin/session")
      .then(() => setReady(true))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/admin/login");
        else setSessionError("无法验证会话，请检查服务连接后重试。");
      });
  }, [router]);

  useEffect(() => {
    if (!ready) return;
    const sync = () => {
      const next = sectionFromHash();
      setSection(next);
      setVisited((current) => current.includes(next) ? current : [...current, next]);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']");
      const shortcut = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!shortcut && !slash) return;
      // Another dialog owns the keyboard while it is open.
      if (!paletteOpen && document.querySelector(".profile-backdrop")) return;
      event.preventDefault();
      setPaletteOpen(shortcut ? !paletteOpen : true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, paletteOpen]);

  const logout = async () => {
    try {
      await api("/api/admin/logout", { method: "POST" });
      router.replace("/admin/login");
    } catch { setSessionError("退出失败，请检查网络后重试。"); }
  };

  if (!ready) return <main className="admin-loading"><Brand compact label="DeskAtlas 管理端" href="/admin" /><p>{sessionError || "正在验证管理员会话…"}</p>{sessionError && <button className="secondary-action" onClick={() => window.location.reload()}>重试</button>}</main>;

  const currentSection = sections.find((item) => item.id === section);

  const navigate = (next: Section) => {
    setSection(next);
    setVisited((current) => current.includes(next) ? current : [...current, next]);
    setNavOpen(false);
    if (window.location.hash.replace(/^#/, "").split("/")[0] !== next) window.history.pushState(null, "", `#${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const openPage = (page: string) => { setPaletteOpen(false); navigate(page as Section); };
  const openJump = (target: AdminJump) => { setPaletteOpen(false); navigate(target.section); setJump(target); };
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent);

  return (
    <main className={`admin-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <div className="admin-header-wrapper">
        <header className="admin-topbar" ref={headerRef}>
          <span className="nav-glass" aria-hidden="true" />
          <Brand href="/admin" label="DeskAtlas 管理端" />
          <button className="mobile-sidebar-toggle icon-button" aria-label="打开导航" onClick={() => setNavOpen(true)}><Menu /></button>
          <div className="admin-breadcrumb"><span>管理端</span><i>/</i><strong>{currentSection?.label}</strong></div>
          <button className="command-trigger" onClick={() => setPaletteOpen(true)} aria-label="全局搜索" aria-keyshortcuts={isMac ? "Meta+K" : "Control+K"} title={`全局搜索（${isMac ? "⌘K" : "Ctrl K"}）`}>
            <Search /><span>搜索学生、房间、工位</span><kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          <div className="admin-topbar-actions">
            <Link className="icon-button" href="/" aria-label="打开学生端" title="打开学生端"><House size={17} /></Link>
            <ThemeToggle />
            <button className="icon-button" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={17} /></button>
          </div>
        </header>
      </div>
      <aside className={`admin-sidebar glass-surface ${navOpen ? "open" : ""}`}>
        <button className="sidebar-edge-toggle" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} aria-expanded={!sidebarCollapsed} onClick={() => setSidebarCollapsed((value) => !value)}>
          {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
        <div className="admin-brand"><span>管理端</span><button className="sidebar-mobile-close icon-button" aria-label="关闭导航" onClick={() => setNavOpen(false)}><X /></button></div>
        <nav aria-label="管理端导航">
          {sections.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} title={item.label} className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span></button>;
          })}
        </nav>
        <div className="sidebar-footer"><span>DeskAtlas · 管理端</span></div>
      </aside>
      {navOpen && <button className="sidebar-scrim" aria-label="关闭导航" onClick={() => setNavOpen(false)} />}
      <section className="admin-main">
        {sessionError && <p className="form-error page-error">{sessionError}</p>}
        {visited.includes("overview") && <div hidden={section !== "overview"}><AdminOverview active={section === "overview"} onNavigate={navigate} /></div>}
        {visited.includes("applications") && <div hidden={section !== "applications"}><AdminApplications active={section === "applications"} jump={jump?.section === "applications" ? jump : null} /></div>}
        {visited.includes("rooms") && <div hidden={section !== "rooms"}><AdminRooms active={section === "rooms"} jump={jump?.section === "rooms" ? jump : null} /></div>}
        {visited.includes("students") && <div hidden={section !== "students"}><AdminStudents active={section === "students"} jump={jump?.section === "students" ? jump : null} /></div>}
        {visited.includes("import") && <div hidden={section !== "import"}><AdminImport active={section === "import"} /></div>}
        {visited.includes("settings") && <div hidden={section !== "settings"}><AdminSettings active={section === "settings"} /></div>}
      </section>
      {paletteOpen && <CommandPalette pages={sections} onNavigate={openPage} onJump={openJump} onClose={() => setPaletteOpen(false)} />}
    </main>
  );
}
