"use client";

import { ArrowUpRight, CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/app/lib/api";

type Overview = {
  totals: Record<string, number>;
  majors: Array<{ name: string; count: number }>;
  advisers: Array<{ name: string; count: number }>;
};

export function AdminOverview({ onNavigate, active = true }: { active?: boolean; onNavigate: (section: "applications" | "students" | "rooms") => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api<Overview>("/api/admin/overview"));
      setUpdatedAt(new Date());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载统计失败");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { if (active) void load(); }, [active, load]);
  if (error && !data) return <div className="admin-page"><div className="central-message error"><CircleAlert />{error}<button className="secondary-action" onClick={load}>重试</button></div></div>;
  if (!data) return <div className="admin-page"><div className="central-message"><RefreshCw className="spin" />正在加载统计数据…</div></div>;
  const maxMajor = Math.max(1, ...data.majors.map((item) => item.count));
  const maxAdviser = Math.max(1, ...data.advisers.map((item) => item.count));
  return (
    <div className="admin-page">
      <header className="page-heading">
        <div><h1>运行概览</h1>{updatedAt && <p className="page-subtitle">统计截至 {updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}，数据不会自动刷新。</p>}</div>
        <button className="secondary-action" disabled={loading} onClick={load}><RefreshCw size={16} className={loading ? "spin" : ""} />刷新</button>
      </header>
      {error && <p className="form-error page-error"><CircleAlert size={16} />{error}</p>}
      <div className="metric-line">
        <button onClick={() => onNavigate("rooms")} aria-label={`${data.totals.rooms} 个房间，查看房间与工位`}><strong>{data.totals.rooms}</strong><span>房间</span><ArrowUpRight /></button>
        <button onClick={() => onNavigate("rooms")} aria-label={`${data.totals.available} 个空闲工位，查看房间与工位`}><strong>{data.totals.available}</strong><span>空闲工位</span><ArrowUpRight /></button>
        <button className={data.totals.pending_applications ? "attention" : ""} onClick={() => onNavigate("applications")} aria-label={`${data.totals.pending_applications} 份待审批申请，前往申请审批`}><strong>{data.totals.pending_applications}</strong><span>待审批</span><ArrowUpRight /></button>
        <button className={data.totals.incomplete_students ? "attention" : ""} onClick={() => onNavigate("students")} aria-label={`${data.totals.incomplete_students} 名学生信息待补全，前往学生名册`}><strong>{data.totals.incomplete_students}</strong><span>信息待补全</span><ArrowUpRight /></button>
      </div>
      <div className="overview-grid">
        <section className="flat-section"><header><div><h2>教研中心分布</h2><p>当前有效工位中的学生</p></div></header><div className="bar-list">{data.majors.map((item) => <div key={item.name}><span>{item.name}</span><i><b style={{ width: `${(item.count / maxMajor) * 100}%` }} /></i><strong>{item.count}</strong></div>)}</div></section>
        <section className="flat-section"><header><div><h2>导师分布</h2><p>按当前工位人数排序</p></div></header><div className="bar-list compact">{data.advisers.map((item) => <div key={item.name}><span>{item.name}</span><i><b style={{ width: `${(item.count / maxAdviser) * 100}%` }} /></i><strong>{item.count}</strong></div>)}</div></section>
      </div>
    </div>
  );
}
