import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./public-space.css";
import "./admin-workspace.css";
import "./workspace-ui.css";
import "./panel.css";

export const metadata: Metadata = {
  title: "DeskAtlas · 研究生工位地图",
  description: "研究生自习室工位可视化、申请与管理平台",
};

const themeScript = `
try {
  const saved = localStorage.getItem('deskatlas-theme');
  const mode = saved === 'day' || saved === 'night' ? saved : 'system';
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = mode === 'system' ? (dark ? 'night' : 'day') : mode;
} catch (_) {}
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
