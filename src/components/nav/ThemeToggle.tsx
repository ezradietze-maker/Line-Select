"use client";

import { useEffect, useState } from "react";
import { applyThemeAttribute, getStoredTheme, setStoredTheme, type ThemeMode } from "@/lib/theme";

const OPTIONS: { mode: ThemeMode; label: string; icon: React.ReactNode }[] = [
  {
    mode: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    mode: "system",
    label: "System",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path strokeLinecap="round" d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    mode: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
      </svg>
    ),
  },
];

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>("system");

  useEffect(() => {
    // One-time read of a client-only external store (localStorage) to sync
    // the toggle's highlighted option with the theme the bootstrap script
    // already applied before paint.
    const stored = getStoredTheme();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(stored);
    applyThemeAttribute(stored);
  }, []);

  function choose(next: ThemeMode) {
    setMode(next);
    setStoredTheme(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5"
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.mode}
          type="button"
          role="radio"
          aria-checked={mode === opt.mode}
          title={opt.label}
          onClick={() => choose(opt.mode)}
          className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
            mode === opt.mode
              ? "bg-brand text-white"
              : "text-ink-faint hover:text-ink"
          }`}
        >
          {opt.icon}
          <span className="sr-only">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}
