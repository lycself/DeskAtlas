"use client";

import { useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { useModalLayer } from "@/app/hooks/useModalLayer";

/** Typed input must never vanish by accident: while the dialog holds fields, only its close button dismisses it. */
function holdsInput(panel: HTMLElement | null) {
  return !!panel?.querySelector("input:not([type='hidden']), textarea, select");
}

export function DetailDialog({ label, onClose, children, wide = false }: { label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useModalLayer(panel, () => { if (!holdsInput(panel.current)) onClose(); });
  return <div className="profile-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !holdsInput(panel.current)) onClose(); }}>
    <div className={`profile-dialog ${wide ? "wide-dialog" : ""}`} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={panel}>
      <button className="dialog-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>
      {children}
    </div>
  </div>;
}
