"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeMode = "day" | "night" | "system";
const STORAGE_KEY = "deskatlas-theme";

function systemTheme(): "day" | "night" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

function savedMode(): ThemeMode {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved === "day" || saved === "night" ? saved : "system";
}

function applyMode(mode: ThemeMode) {
  document.documentElement.dataset.theme = mode === "system" ? systemTheme() : mode;
  document.documentElement.dataset.themeMode = mode;
}

const labels: Record<ThemeMode, { current: string; next: string }> = {
  day: { current: "白天", next: "深夜" },
  night: { current: "深夜", next: "跟随系统" },
  system: { current: "跟随系统", next: "白天" },
};
const order: ThemeMode[] = ["day", "night", "system"];

/** Cycles day → night → follow system, so a manual choice can always be undone. */
export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const initial = savedMode();
    setMode(initial);
    applyMode(initial);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => { if (savedMode() === "system") applyMode("system"); };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const cycle = () => {
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setMode(next);
    if (next === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, next);
    applyMode(next);
  };

  const Icon = mode === "day" ? Sun : mode === "night" ? Moon : Monitor;
  const label = `主题：${labels[mode].current}，点击切换为${labels[mode].next}`;
  return (
    <button className="icon-button" type="button" onClick={cycle} title={label} aria-label={label}>
      <Icon size={18} />
    </button>
  );
}
