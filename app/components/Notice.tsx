"use client";

import { Check, CircleAlert, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";

type Toast = { id: number; kind: "success" | "error"; text: string; onDismiss?: () => void };

const SUCCESS_MS = 5000;
const MAX_TOASTS = 4;
let toasts: Toast[] = [];
let nextId = 1;
const timers = new Map<number, number>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const snapshot = () => toasts;
const empty: Toast[] = [];

export function dismissToast(id: number) {
  const toast = toasts.find((entry) => entry.id === id);
  if (!toast) return;
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter((entry) => entry.id !== id);
  emit();
}

/**
 * Floating feedback anchored to the bottom of the viewport, so it stays visible beside long
 * pages. Messages stack instead of replacing each other; success hides itself, errors stay
 * until dismissed. Repeating a message that is still shown restarts it rather than doubling it.
 */
export function toast(text: string, kind: Toast["kind"] = "success", onDismiss?: () => void): number {
  const repeat = toasts.find((entry) => entry.kind === kind && entry.text === text);
  if (repeat) dismissToast(repeat.id);
  const id = nextId++;
  toasts = [...toasts, { id, kind, text, onDismiss }].slice(-MAX_TOASTS);
  if (kind === "success") timers.set(id, window.setTimeout(() => dismissToast(id), SUCCESS_MS));
  emit();
  return id;
}

/** Mounted once in the root layout. */
export function ToastHost() {
  const items = useSyncExternalStore(subscribe, snapshot, () => empty);
  if (!items.length) return null;
  return (
    <div className="notice-stack">
      {items.map((item) => (
        <p key={item.id} className={`notice ${item.kind}`} role={item.kind === "error" ? "alert" : "status"}>
          {item.kind === "error" ? <CircleAlert size={16} /> : <Check size={16} />}<span>{item.text}</span>
          <button type="button" aria-label={item.kind === "error" ? "关闭错误提示" : "关闭提示"} onClick={() => { dismissToast(item.id); item.onDismiss?.(); }}><X size={14} /></button>
        </p>
      ))}
    </div>
  );
}

/**
 * Bridges a page's `error` / `message` state to the toast stack. A message is handed off and the
 * page state cleared at once, so the same text can be shown again later. An error toast follows
 * the page state: clearing `error` removes it, and dismissing it clears `error`.
 */
export function Notice({ error, message, onClearError, onClearMessage }: {
  error?: string;
  message?: string;
  onClearError?: () => void;
  onClearMessage?: () => void;
}) {
  const clearError = useRef(onClearError);
  const clearMessage = useRef(onClearMessage);
  useEffect(() => { clearError.current = onClearError; clearMessage.current = onClearMessage; }, [onClearError, onClearMessage]);
  useEffect(() => {
    if (!message) return;
    toast(message);
    clearMessage.current?.();
  }, [message]);
  useEffect(() => {
    if (!error) return;
    const id = toast(error, "error", () => clearError.current?.());
    return () => dismissToast(id);
  }, [error]);
  return null;
}
