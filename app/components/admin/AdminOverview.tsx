"use client";

import { ArrowUpRight, CircleAlert, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/app/lib/api";

type Overview = {
  totals: Record<string, number>;
  majors: Array<{ name: string; count: number }>;
  advisers: Array<{ name: string; count: number }>;
};

export function AdminOverview({ onNavigate }: { onNavigate: (section: "applications" | "students" | "rooms") => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api<Overview>("/api/admin/overview").then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="admin-page"><div className="central-message error"><CircleAlert />{error}</div></div>;
  if (!data) return <div className="admin-page"><div className="central-message"><RefreshCw className="spin" />正在加载统计数据…</div></div>;
  const maxMajor = Math.max(1, ...data.majors.map((item) => item.count));
  const maxAdviser = Math.max(1, ...data.advisers.map((item) => item.count));
  return (
    <div className="admin-page">
      <header className="page-heading"><h1>运行概览</h1><span className="live-indicator"><i />数据实时</span></header>
      <div className="metric-line">
        <button onClick={() => onNavigate("rooms")}><strong>{data.totals.rooms}</strong><span>房间</span><ArrowUpRight /></button>
        <button onClick={() => onNavigate("rooms")}><strong>{data.totals.available}</strong><span>空闲工位</span><ArrowUpRight /></button>
        <button className={data.totals.pending_applications ? "attention" : ""} onClick={() => onNavigate("applications")}><strong>{data.totals.pending_applications}</strong><span>待审批</span><ArrowUpRight /></button>
        <button className={data.totals.incomplete_students ? "attention" : ""} onClick={() => onNavigate("students")}><strong>{data.totals.incomplete_students}</strong><span>信息待补全</span><ArrowUpRight /></button>
      </div>
      <div className="overview-grid">
        <section className="flat-section"><header><div><h2>专业分布</h2><p>当前有效工位中的学生</p></div></header><div className="bar-list">{data.majors.map((item) => <div key={item.name}><span>{item.name}</span><i><b style={{ width: `${(item.count / maxMajor) * 100}%` }} /></i><strong>{item.count}</strong></div>)}</div></section>
        <section className="flat-section"><header><div><h2>导师分布</h2><p>按当前工位人数排序</p></div></header><div className="bar-list compact">{data.advisers.map((item) => <div key={item.name}><span>{item.name}</span><i><b style={{ width: `${(item.count / maxAdviser) * 100}%` }} /></i><strong>{item.count}</strong></div>)}</div></section>
      </div>
    </div>
  );
}
