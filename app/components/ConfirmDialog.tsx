"use client";

import { CircleAlert, Info } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useModalLayer } from "@/app/hooks/useModalLayer";

type Request = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Irreversible or data-losing actions: red confirm button, focus starts on cancel. */
  danger?: boolean;
  /** A notice with a single acknowledge button instead of a question. */
  acknowledge?: boolean;
};
type Pending = Request & { id: number; resolve: (value: boolean) => void };

let queue: Pending[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => queue[0] ?? null;

/** In-page replacement for `window.confirm`, which the desktop webview cannot always show. */
export function confirmDialog(request: Request): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...request, id: nextId++, resolve }];
    emit();
  });
}

/** In-page replacement for `window.alert`. */
export function noticeDialog(title: string, body?: string): Promise<void> {
  return confirmDialog({ title, body, acknowledge: true, confirmLabel: "知道了" }).then(() => undefined);
}

function settle(id: number, value: boolean) {
  const current = queue.find((entry) => entry.id === id);
  if (!current) return;
  queue = queue.filter((entry) => entry.id !== id);
  emit();
  current.resolve(value);
}

function ConfirmPanel({ request }: { request: Pending }) {
  const panel = useRef<HTMLDivElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useModalLayer(panel, () => settle(request.id, false), { focusPanel: false });
  useEffect(() => {
    (request.danger && !request.acknowledge ? cancel : confirm).current?.focus({ preventScroll: true });
  }, [request]);
  const Icon = request.danger ? CircleAlert : Info;
  return <div className="profile-backdrop confirm-backdrop">
    <div className={`profile-dialog confirm-dialog ${request.danger ? "danger" : ""}`} role="alertdialog" aria-modal="true"
      aria-labelledby={`confirm-title-${request.id}`} aria-describedby={request.body ? `confirm-body-${request.id}` : undefined} ref={panel}>
      <div className="confirm-heading"><Icon size={20} aria-hidden="true" /><h2 id={`confirm-title-${request.id}`}>{request.title}</h2></div>
      {request.body && <p id={`confirm-body-${request.id}`}>{request.body}</p>}
      <div className="confirm-actions">
        {!request.acknowledge && <button ref={cancel} type="button" className="secondary-action" onClick={() => settle(request.id, false)}>{request.cancelLabel ?? "取消"}</button>}
        <button ref={confirm} type="button" className={request.danger ? "danger-action solid" : "primary-action"} onClick={() => settle(request.id, true)}>{request.confirmLabel ?? "确定"}</button>
      </div>
    </div>
  </div>;
}

/** Mounted once in the root layout; shows queued confirmations one at a time. */
export function ConfirmHost() {
  const request = useSyncExternalStore(subscribe, snapshot, () => null);
  return request ? <ConfirmPanel key={request.id} request={request} /> : null;
}
