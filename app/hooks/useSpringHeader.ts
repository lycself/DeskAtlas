"use client";

import { useEffect, useRef } from "react";

export function useSpringHeader(enabled = true) {
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header || !enabled) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let target = window.scrollY > 80 ? 1 : 0;
    let position = target;
    let velocity = 0;
    let frame = 0;
    let previousTime = 0;
    const paint = () => header.style.setProperty("--nav-progress", String(position));
    const step = (time: number) => {
      const dt = Math.min((time - previousTime) / 1000 || 1 / 60, 1 / 30);
      previousTime = time;
      // Reference: DeepSeek Harness uses a spring with stiffness 180, damping 28.
      velocity += (180 * (target - position) - 28 * velocity) * dt;
      position += velocity * dt;
      if (Math.abs(target - position) < .0005 && Math.abs(velocity) < .005) {
        position = target;
        velocity = 0;
        frame = 0;
        paint();
        return;
      }
      paint();
      frame = requestAnimationFrame(step);
    };
    const update = () => {
      target = window.scrollY > 80 ? 1 : 0;
      header.classList.toggle("is-scrolled", Boolean(target));
      if (reduced.matches) {
        cancelAnimationFrame(frame);
        frame = 0;
        velocity = 0;
        position = target;
        paint();
      } else if (!frame && position !== target) {
        previousTime = performance.now();
        frame = requestAnimationFrame(step);
      }
    };
    paint();
    update();
    window.addEventListener("scroll", update, { passive: true });
    reduced.addEventListener("change", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      reduced.removeEventListener("change", update);
    };
  }, [enabled]);

  return headerRef;
}
