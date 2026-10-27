"use client";

import { useEffect, useRef } from "react";
import { HEADER_MOTION_MS, headerMotionFrames, headerShouldCompact } from "@/app/lib/header-motion";

export function useSpringHeader(enabled = true) {
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header || !enabled) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let compact = headerShouldCompact(false, window.scrollY);
    let animations: Animation[] = [];
    const cancel = () => {
      animations.forEach((animation) => animation.cancel());
      animations = [];
      header.classList.remove("is-morphing");
    };
    const paint = () => {
      header.style.setProperty("--nav-progress", compact ? "1" : "0");
      header.classList.toggle("is-scrolled", compact);
    };
    const update = () => {
      const next = headerShouldCompact(compact, window.scrollY);
      if (next === compact) return;
      const motion = !reduced.matches && !document.hidden && typeof header.animate === "function";
      // Read the current visual positions before cancelling an interrupted transition.
      const elements = motion ? [...header.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.getBoundingClientRect().width > 0) : [];
      const before = elements.map((node) => node.getBoundingClientRect());
      cancel();
      compact = next;
      // Layout changes only once. The spring animates independent foreground translations and
      // the glass background's scale, so text stays sharp and no dimensions change per frame.
      paint();
      if (!motion) return;
      const after = elements.map((node) => node.getBoundingClientRect());
      header.classList.add("is-morphing");
      const running = elements.flatMap((node, index) => {
        const from = before[index], to = after[index];
        if (!to.width || !to.height || Math.abs(from.left - to.left) + Math.abs(from.top - to.top) + Math.abs(from.width - to.width) + Math.abs(from.height - to.height) < .01) return [];
        return [node.animate(headerMotionFrames(from, to, node.classList.contains("nav-glass")), { duration: HEADER_MOTION_MS, easing: "linear" })];
      });
      animations = running;
      void Promise.allSettled(running.map((animation) => animation.finished)).then(() => {
        if (animations !== running) return;
        animations = [];
        header.classList.remove("is-morphing");
      });
    };
    const preferenceChanged = () => { cancel(); compact = headerShouldCompact(compact, window.scrollY); paint(); };
    const visibilityChanged = () => { if (document.hidden) cancel(); };
    paint();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", cancel, { passive: true });
    reduced.addEventListener("change", preferenceChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      cancel();
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", cancel);
      reduced.removeEventListener("change", preferenceChanged);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [enabled]);

  return headerRef;
}
