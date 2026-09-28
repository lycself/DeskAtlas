"use client";

import { Check, CircleAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";

type Props = {
  error?: string;
  message?: string;
  onClearError?: () => void;
  onClearMessage?: () => void;
  /** Milliseconds before a success message hides itself. */
  autoHide?: number;
};

/**
 * Floating feedback anchored to the bottom of the viewport, so messages stay
 * visible next to long pages such as the room workbench instead of scrolling
 * away at the top. Errors stay until dismissed; success messages fade out.
 */
export function Notice({ error, message, onClearError, onClearMessage, autoHide = 5000 }: Props) {
  const clearMessage = useRef(onClearMessage);
  useEffect(() => { clearMessage.current = onClearMessage; }, [onClearMessage]);
  useEffect(() => {
    if (!message || !clearMessage.current) return;
    const timer = window.setTimeout(() => clearMessage.current?.(), autoHide);
    return () => window.clearTimeout(timer);
  }, [message, autoHide]);
  if (!error && !message) return null;
  return (
    <div className="notice-stack">
      {error && (
        <p className="notice error" role="alert">
          <CircleAlert size={16} /><span>{error}</span>
          {onClearError && <button type="button" aria-label="关闭错误提示" onClick={onClearError}><X size={14} /></button>}
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          <Check size={16} /><span>{message}</span>
          {onClearMessage && <button type="button" aria-label="关闭提示" onClick={onClearMessage}><X size={14} /></button>}
        </p>
      )}
    </div>
  );
}
