"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeMode = "day" | "night";

function systemTheme(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

function savedTheme(): ThemeMode | null {
  const saved = localStorage.getItem("deskatlas-theme");
  return saved === "day" || saved === "night" ? saved : null;
}

function applyTheme(mode: ThemeMode, manual: boolean) {
  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.themeMode = manual ? mode : "system";
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("day");

  useEffect(() => {
    const saved = savedTheme();
    const initial = saved ?? systemTheme();
    setMode(initial);
    applyTheme(initial, Boolean(saved));
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => {
      if (savedTheme()) return;
      const next = systemTheme();
      setMode(next);
      applyTheme(next, false);
    };
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const toggle = () => {
    const next = mode === "day" ? "night" : "day";
    setMode(next);
    localStorage.setItem("deskatlas-theme", next);
    applyTheme(next, true);
  };

  const Icon = mode === "day" ? Sun : Moon;
  const label = mode === "day" ? "切换到深夜模式" : "切换到白天模式";
  return (
    <button className="icon-button" type="button" onClick={toggle} title={label} aria-label={label}>
      <Icon size={18} />
    </button>
  );
}
