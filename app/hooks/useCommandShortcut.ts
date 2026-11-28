"use client";

import { useEffect } from "react";
import { modalOpen } from "./useModalLayer";

/** ⌘K / Ctrl K toggles the command palette; "/" outside a text field opens it. Quiet while another dialog is open. */
export function useCommandShortcut(enabled: boolean, open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const typing = event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']");
      const shortcut = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!shortcut && !slash) return;
      // Another dialog owns the keyboard while it is open.
      if (!open && modalOpen()) return;
      event.preventDefault();
      setOpen(shortcut ? !open : true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, open, setOpen]);
}
