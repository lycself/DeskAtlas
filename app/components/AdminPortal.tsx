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
import { modalOpen } from "@/app/hooks/useModalLayer";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { api, ApiError } from "@/app/lib/api";
import type { AdminJump } from "@/app/lib/types";
// Every section is split out, and each gets its own loading placeholder: without one there is no
// Suspense boundary, and loading a section suspends the whole workspace. Next requires the
// options to be an object literal at each call.
const AdminApplications = dynamic(() => import("./admin/AdminApplications").then((module) => module.AdminApplications), { loading: () => <SectionPending /> });
const AdminImport = dynamic(() => import("./admin/AdminImport").then((module) => module.AdminImport), { loading: () => <SectionPending /> });
const AdminOverview = dynamic(() => import("./admin/AdminOverview").then((module) => module.AdminOverview), { loading: () => <SectionPending /> });
const AdminRooms = dynamic(() => import("./admin/AdminRooms").then((module) => module.AdminRooms), { loading: () => <SectionPending /> });
const AdminSettings = dynamic(() => import("./admin/AdminSettings").then((module) => module.AdminSettings), { loading: () => <SectionPending /> });
const AdminStudents = dynamic(() => import("./admin/AdminStudents").then((module) => module.AdminStudents), { loading: () => <SectionPending /> });
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

const NAV_KEY = "deskatlas-admin-nav";

function SectionPending({ message = "正在载入…", children }: { message?: string; children?: ReactNode }) {
  return <div className="admin-page section-pending" role="status"><p>{message}</p>{children}</div>;
}

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
  const headerRef = useSpringHeader();
  const [section, setSection] = useState<Section>("overview");
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [jump, setJump] = useState<AdminJump | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // Set by an in-app navigation; a reload or deep link leaves focus where the browser put it.
  const focusHeading = useRef(false);
  const main = useRef<HTMLElement>(null);

  // The pre-paint script in the root layout already applied the saved state to <html>.
  useEffect(() => { setSidebarCollapsed(document.documentElement.dataset.adminNav === "collapsed"); }, []);
  const toggleSidebar = () => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    if (next) document.documentElement.dataset.adminNav = "collapsed";
    else delete document.documentElement.dataset.adminNav;
    try { localStorage.setItem(NAV_KEY, next ? "collapsed" : "expanded"); } catch { /* private mode keeps it for this page only */ }
  };

  useEffect(() => {
    api("/api/admin/session")
      .then(() => setReady(true))
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) router.replace("/admin/login");
        else setSessionError("无法验证会话，请检查服务连接后重试。");
      });
  }, [router]);

  useEffect(() => {
    const sync = () => {
      const next = sectionFromHash();
      setSection(next);
      setVisited((current) => current.includes(next) ? current : [...current, next]);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const currentLabel = sections.find((item) => item.id === section)?.label ?? "";
  useEffect(() => {
    document.title = `${currentLabel} · DeskAtlas 管理端`;
  }, [currentLabel]);

  // After an in-app switch, announce the new section and move focus to its heading, so keyboard
  // and screen-reader users land at the top of the new page. A section that is still loading is
  // polled for its heading for about two seconds.
  useEffect(() => {
    if (!ready || !focusHeading.current) return;
    focusHeading.current = false;
    setAnnouncement(`已切换到${currentLabel}`);
    const start = document.activeElement;
    let frames = 0, frame = 0;
    const tryFocus = () => {
      const moved = document.activeElement !== start && document.activeElement !== document.body;
      if (moved || modalOpen()) return;
      const heading = main.current?.querySelector<HTMLElement>(`[data-section="${section}"] h1`);
      if (!heading) { if (++frames < 120) frame = requestAnimationFrame(tryFocus); return; }
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(tryFocus);
    return () => cancelAnimationFrame(frame);
  }, [section, ready, currentLabel]);

  useEffect(() => {
    if (!ready) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']");
      const shortcut = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!shortcut && !slash) return;
      // Another dialog owns the keyboard while it is open.
      if (!paletteOpen && modalOpen()) return;
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

  const navigate = (next: Section) => {
    if (next !== section) focusHeading.current = true;
    setSection(next);
    setVisited((current) => current.includes(next) ? current : [...current, next]);
    setNavOpen(false);
    if (window.location.hash.replace(/^#/, "").split("/")[0] !== next) window.history.pushState(null, "", `#${next}`);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const openPage = (page: string) => { setPaletteOpen(false); navigate(page as Section); };
  const openJump = (target: AdminJump) => { setPaletteOpen(false); navigate(target.section); setJump(target); };

  return (
    <main className="admin-shell" ref={main}>
      <div className="admin-header-wrapper">
        <header className="admin-topbar" ref={headerRef}>
          <span className="nav-glass" aria-hidden="true" />
          <Brand href="/admin" label="DeskAtlas 管理端" />
          <button className="mobile-sidebar-toggle icon-button" aria-label="打开导航" onClick={() => setNavOpen(true)}><Menu /></button>
          <div className="admin-breadcrumb"><span>管理端</span><i>/</i><strong>{currentLabel}</strong></div>
          <button className="command-trigger" disabled={!ready} onClick={() => setPaletteOpen(true)} aria-label="全局搜索" aria-keyshortcuts="Meta+K Control+K" title="全局搜索">
            {/* The shell is server-rendered, so the platform hint is picked by CSS from the pre-paint <html data-platform>. */}
            <Search /><span>搜索学生、房间、工位</span><kbd className="kbd-mac">⌘K</kbd><kbd className="kbd-other">Ctrl K</kbd>
          </button>
          <div className="admin-topbar-actions">
            <Link className="icon-button" href="/" aria-label="打开学生端" title="打开学生端"><House size={17} /></Link>
            <ThemeToggle />
            <button className="icon-button" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={17} /></button>
          </div>
        </header>
      </div>
      <aside className={`admin-sidebar glass-surface ${navOpen ? "open" : ""}`}>
        <button className="sidebar-edge-toggle" aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"} aria-expanded={!sidebarCollapsed} onClick={toggleSidebar}>
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
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
        <p className="sr-only" aria-live="polite">{announcement}</p>
        {!ready ? (
          <SectionPending message={sessionError || "正在验证管理员会话…"}>
            {sessionError && <button className="secondary-action" onClick={() => window.location.reload()}>重试</button>}
          </SectionPending>
        ) : <>
        {sessionError && <p className="form-error page-error">{sessionError}</p>}
        {visited.includes("overview") && <div data-section="overview" hidden={section !== "overview"}><AdminOverview active={section === "overview"} onNavigate={navigate} /></div>}
        {visited.includes("applications") && <div data-section="applications" hidden={section !== "applications"}><AdminApplications active={section === "applications"} jump={jump?.section === "applications" ? jump : null} /></div>}
        {visited.includes("rooms") && <div data-section="rooms" hidden={section !== "rooms"}><AdminRooms active={section === "rooms"} jump={jump?.section === "rooms" ? jump : null} /></div>}
        {visited.includes("students") && <div data-section="students" hidden={section !== "students"}><AdminStudents active={section === "students"} jump={jump?.section === "students" ? jump : null} /></div>}
        {visited.includes("import") && <div data-section="import" hidden={section !== "import"}><AdminImport active={section === "import"} /></div>}
        {visited.includes("settings") && <div data-section="settings" hidden={section !== "settings"}><AdminSettings active={section === "settings"} /></div>}
        </>}
      </section>
      {paletteOpen && <CommandPalette pages={sections} onNavigate={openPage} onJump={openJump} onClose={() => setPaletteOpen(false)} />}
    </main>
  );
}
