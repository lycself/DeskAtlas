import type { Metadata } from "next";
import type { ReactNode } from "react";

import { ConfirmHost } from "./components/ConfirmDialog";
import { ToastHost } from "./components/Notice";
import "./globals.css";
import "./public-space.css";
import "./admin-workspace.css";
import "./panel.css";

export const metadata: Metadata = {
  title: { default: "DeskAtlas · 研究生工位地图", template: "%s · DeskAtlas" },
  description: "研究生自习室工位可视化、申请与管理平台",
};

const themeScript = `
try {
  const saved = localStorage.getItem('deskatlas-theme');
  const mode = saved === 'day' || saved === 'night' ? saved : 'system';
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = mode === 'system' ? (dark ? 'night' : 'day') : mode;
  if (localStorage.getItem('deskatlas-admin-nav') === 'collapsed') document.documentElement.dataset.adminNav = 'collapsed';
} catch (_) {}
try {
  if (/Mac|iPhone|iPad/.test(navigator.userAgent)) document.documentElement.dataset.platform = 'mac';
} catch (_) {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}<ToastHost /><ConfirmHost /></body>
    </html>
  );
}
