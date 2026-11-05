"use client";

import { useEffect, useRef, useState } from "react";
import {
  CALENDAR_ACCENT_PRESETS,
  applyCalendarAccent,
  getStoredCalendarAccent,
  setStoredCalendarAccent,
} from "@/lib/calendar-theme";
import { applyThemeAttribute, getStoredTheme, setStoredTheme, type ThemeMode } from "@/lib/theme";
import { MoonIcon, PaletteIcon } from "@/components/ui/icons";

/** Whether a theme choice shows dark: the red-light night counts, and "system" follows the device. */
function isDark(mode: ThemeMode): boolean {
  if (mode === "system") return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  return mode !== "light";
}

/** A plain sun: a disc and its rays. */
function SunGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <path strokeLinecap="round" d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
    </svg>
  );
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; title?: string; icon: React.ReactNode }[] = [
  {
    mode: "light",
    label: "Light",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
        <circle cx="12" cy="12" r="4" />
        <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    ),
  },
  {
    mode: "system",
    label: "System",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path strokeLinecap="round" d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    mode: "dark",
    label: "Dark",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
      </svg>
    ),
  },
  {
    mode: "night",
    label: "Night",
    title: "Night — real red cockpit lighting, to protect your night vision",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3.5 w-3.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3a6 6 0 0 0-3.5 10.9c.4.3.5.8.5 1.3V16h6v-.8c0-.5.1-1 .5-1.3A6 6 0 0 0 12 3z" />
        <path strokeLinecap="round" d="M9.5 18h5M10.5 21h3" />
      </svg>
    ),
  },
];

/**
 * One compact trigger for both personalization controls that used to sit as
 * two always-visible widgets in the sidebar footer (ThemeToggle,
 * CalendarAccentPicker — both retired, folded in here). Living near the
 * logo instead means it's reachable in one glance rather than buried below
 * the whole nav list, and collapsing two rows into one small button is the
 * actual space savings — the popover itself can afford to be a little more
 * generous than the old inline row ever could.
 */
export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>("system");
  const [accent, setAccent] = useState<string | null>(null);
  // Light to dark: the sun sets and the moon rises in the button; dark to light, the other way round.
  const [sky, setSky] = useState<{ to: "dark" | "light"; n: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const storedTheme = getStoredTheme();
    const storedAccent = getStoredCalendarAccent();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(storedTheme);
    setAccent(storedAccent);
    applyThemeAttribute(storedTheme);
    applyCalendarAccent(storedAccent);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function chooseTheme(next: ThemeMode) {
    const wasDark = isDark(mode);
    setMode(next);
    setStoredTheme(next);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!still && isDark(next) !== wasDark) setSky((s) => ({ to: isDark(next) ? "dark" : "light", n: (s?.n ?? 0) + 1 }));
  }

  function chooseAccent(value: string | null) {
    setAccent(value);
    setStoredCalendarAccent(value);
  }

  // A pilot's own calendar color when they've picked one; otherwise the chrome's own accent (amber on the charcoal sidebar).
  const accentCss = accent ?? "var(--color-accent)";

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Appearance"
        className="relative flex h-9 w-9 items-center justify-center rounded-full border transition-transform hover:scale-105"
        style={{
          borderColor: `color-mix(in srgb, ${accentCss} 45%, var(--color-border))`,
          background: `color-mix(in srgb, ${accentCss} 16%, var(--color-surface))`,
        }}
      >
        <span style={{ color: accentCss }} className={`transition-opacity ${sky ? "opacity-0" : ""}`}>
          <PaletteIcon className="h-4 w-4" />
        </span>
        {sky && (
          <span
            key={sky.n}
            aria-hidden
            className="celestial-out pointer-events-none absolute inset-0 overflow-hidden rounded-full"
            style={{ color: accentCss }}
            onAnimationEnd={(e) => e.target === e.currentTarget && setSky(null)}
          >
            <span className={`absolute inset-0 flex items-center justify-center ${sky.to === "dark" ? "sun-set" : "moon-rise"}`}>
              <SunGlyph className="h-4 w-4" />
            </span>
            <span className={`absolute inset-0 flex items-center justify-center ${sky.to === "dark" ? "moon-rise" : "sun-set"}`}>
              <MoonIcon className="h-3.5 w-3.5" />
            </span>
          </span>
        )}
        <span className="sr-only">Appearance settings</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-52 rail-collapsed:left-0 rail-collapsed:right-auto animate-fade-in overflow-hidden rounded-lg border border-border bg-surface shadow-elevated-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-medium text-ink">Appearance</div>
            <div className="text-xs text-ink-faint">Saved to this device only.</div>
          </div>

          <div className="space-y-4 px-4 py-3.5">
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">Mode</div>
              <div
                role="radiogroup"
                aria-label="Color theme"
                className="inline-flex w-full items-center gap-0.5 rounded-full border border-border bg-canvas p-0.5"
              >
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.mode}
                    type="button"
                    role="radio"
                    aria-checked={mode === opt.mode}
                    title={opt.title ?? opt.label}
                    onClick={() => chooseTheme(opt.mode)}
                    className={`flex flex-1 items-center justify-center rounded-full py-1.5 transition-colors ${
                      mode === opt.mode ? "bg-brand text-on-brand shadow-sm" : "text-ink-faint hover:text-ink"
                    }`}
                  >
                    {opt.icon}
                    <span className="sr-only">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-ink-faint">
                Calendar accent
              </div>
              <div role="radiogroup" aria-label="Calendar accent color" className="flex items-center gap-1.5">
                {CALENDAR_ACCENT_PRESETS.map((preset) => {
                  const swatchCss = preset.value ?? "var(--color-calendar-accent)";
                  const isSelected = accent === preset.value;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      title={preset.label}
                      onClick={() => chooseAccent(preset.value)}
                      className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110"
                      style={{
                        background: `radial-gradient(circle at 32% 28%, color-mix(in srgb, ${swatchCss} 45%, white), ${swatchCss})`,
                        boxShadow: isSelected
                          ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${swatchCss}`
                          : "0 1px 3px hsl(var(--shadow-color) / 0.3)",
                      }}
                    >
                      {isSelected && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3.5} className="h-2.5 w-2.5">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      <span className="sr-only">{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
