"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeMode = "system" | "day" | "night";

const modes: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "day", label: "白天模式", icon: Sun },
  { value: "night", label: "深夜模式", icon: Moon },
];

function applyTheme(mode: ThemeMode) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = mode === "system" ? (dark ? "night" : "day") : mode;
  document.documentElement.dataset.themeMode = mode;
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    const saved = (localStorage.getItem("deskatlas-theme") as ThemeMode | null) ?? "system";
    setMode(saved);
    applyTheme(saved);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => ((localStorage.getItem("deskatlas-theme") as ThemeMode | null) ?? "system") === "system" && applyTheme("system");
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const cycle = () => {
    const index = modes.findIndex((item) => item.value === mode);
    const next = modes[(index + 1) % modes.length].value;
    setMode(next);
    localStorage.setItem("deskatlas-theme", next);
    applyTheme(next);
  };

  const current = modes.find((item) => item.value === mode) ?? modes[0];
  const Icon = current.icon;
  return (
    <button className="icon-button" type="button" onClick={cycle} title={current.label} aria-label={current.label}>
      <Icon size={18} />
    </button>
  );
}
