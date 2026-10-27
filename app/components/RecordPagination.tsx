"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

/** Histories use page scrolling; bounded pages replace a second vertical scroll area. */
export function RecordPagination({ label, total, page, pageSize, onChange, regionId }: {
  label: string; total: number; page: number; pageSize: number; onChange: (page: number) => void; regionId: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const go = (next: number) => {
    onChange(next);
    requestAnimationFrame(() => {
      const section = document.getElementById(regionId);
      section?.scrollIntoView({ block: "start" });
      section?.focus({ preventScroll: true });
    });
  };
  return <nav className="record-pagination" aria-label={`${label}分页`}>
    <span aria-live="polite">{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} / 共 {total} 条</span>
    <div>
      <button className="secondary-action compact" aria-label={`上一页${label}`} disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft />上一页</button>
      <span>{page} / {pages}</span>
      <button className="secondary-action compact" aria-label={`下一页${label}`} disabled={page >= pages} onClick={() => go(page + 1)}>下一页<ChevronRight /></button>
    </div>
  </nav>;
}
