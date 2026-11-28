"use client";

import { ArrowRight, LockKeyhole, Search } from "lucide-react";
import Link from "next/link";
import { Brand } from "./Brand";
import { ThemeToggle } from "./ThemeToggle";

/** The student page's bar: fixed to the top and always the same shape. `onSearch` is absent until there are rooms to search. */
export function PublicHeader({ onSearch }: { onSearch?: () => void }) {
  return <header className="topbar">
    <div className="topbar-inner">
      <Brand />
      <div className="topbar-actions">
        <button className="command-trigger" disabled={!onSearch} onClick={onSearch} aria-label="搜索工位" aria-keyshortcuts="Meta+K Control+K" title="搜索工位">
          {/* Server-rendered, so the platform hint is picked by CSS from the pre-paint <html data-platform>. */}
          <Search /><span>搜索房间、工位、姓名</span><kbd className="kbd-mac">⌘K</kbd><kbd className="kbd-other">Ctrl K</kbd>
        </button>
        <span className="privacy-note"><LockKeyhole size={14} />校内访问</span>
        <ThemeToggle />
        <Link className="text-link" href="/admin/login">管理入口 <ArrowRight size={15} /></Link>
      </div>
    </div>
  </header>;
}
