"use client";

import { ArrowRight, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { useSpringHeader } from "@/app/hooks/useSpringHeader";
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

export function PublicHeader() {
  const headerRef = useSpringHeader();

  return <div className="public-header-wrapper">
    <header className="topbar" ref={headerRef}>
      <span className="nav-glass" aria-hidden="true" />
      <Brand />
      <nav className="public-navigation" aria-label="主导航"><a href="#workspace">工位地图</a></nav>
      <div className="topbar-actions">
        <span className="privacy-note"><LockKeyhole size={14} />校内访问</span>
        <ThemeToggle />
        <Link className="text-link" href="/admin/login">管理入口 <ArrowRight size={15} /></Link>
      </div>
    </header>
  </div>;
}
