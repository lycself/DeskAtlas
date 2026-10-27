"use client";

import { useEffect, useRef, type RefObject } from "react";

/** Open modal layers, innermost last. Only the top layer reacts to the keyboard. */
const layers: symbol[] = [];
let pageOverflow = "";

const FOCUSABLE = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) =>
    !node.closest("[inert]") && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden");
}

/**
 * Shared modal behaviour: locks page scroll, traps Tab inside `panel`, routes Escape to
 * `onEscape` and returns focus on close. Layers stack, so a confirmation opened over a
 * form dialog handles Escape alone instead of closing both. Escape during IME
 * composition only cancels the candidate list.
 */
export function useModalLayer(panel: RefObject<HTMLElement | null>, onEscape: () => void, { focusPanel = true, enabled = true } = {}) {
  const escape = useRef(onEscape);
  useEffect(() => { escape.current = onEscape; }, [onEscape]);
  useEffect(() => {
    if (!enabled) return;
    const id = Symbol("modal");
    layers.push(id);
    const previous = document.activeElement as HTMLElement | null;
    if (layers.length === 1) { pageOverflow = document.body.style.overflow; document.body.style.overflow = "hidden"; }
    if (focusPanel) panel.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      const root = panel.current;
      if (layers.at(-1) !== id || !root) return;
      if (event.key === "Escape") {
        // A list or field inside the layer may already have used Escape (closing a dropdown).
        if (event.isComposing || event.defaultPrevented) return;
        event.preventDefault();
        escape.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusables(root);
      const first = elements[0], last = elements.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      const current = document.activeElement;
      if (!root.contains(current)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && (current === first || current === root)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (current === last || current === root)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      layers.splice(layers.indexOf(id), 1);
      if (!layers.length) document.body.style.overflow = pageOverflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [panel, focusPanel, enabled]);
}

/** Whether a modal layer is open; global shortcuts stay quiet while one is. */
export function modalOpen() {
  return layers.length > 0;
}
