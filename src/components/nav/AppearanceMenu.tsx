"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CALENDAR_ACCENT_PRESETS,
  applyCalendarAccent,
  getStoredCalendarAccent,
  setStoredCalendarAccent,
} from "@/lib/calendar-theme";
import { applyThemeAttribute, getStoredTheme, setStoredTheme, THEME_CHANGE_EVENT, type ThemeMode } from "@/lib/theme";
import { PaletteIcon } from "@/components/ui/icons";
import { radioKeyProps } from "@/components/ui/radio-keys";

/**
 * Each mode's own colors, for its little picture in the menu — fixed on purpose, so every picture shows its mode
 * whichever one is on now. Page, sidebar, text and the sign (the yellow that's red under red light).
 */
const PICTURES: Record<Exclude<ThemeMode, "system">, { page: string; side: string; ink: string; sign: string }> = {
  light: { page: "#eceff3", side: "#0a1120", ink: "#0a1120", sign: "#ffcc00" },
  dark: { page: "#0a1120", side: "#060b16", ink: "#eef1f6", sign: "#ffcc00" },
  night: { page: "#0d0404", side: "#0a0303", ink: "#ff5c5c", sign: "#ff5c5c" },
};

/** A thumbnail of the site in one mode: the sidebar with its location sign, and a page of text. */
function ModePicture({ mode }: { mode: ThemeMode }) {
  const half = (m: Exclude<ThemeMode, "system">, clip?: string) => {
    const c = PICTURES[m];
    return (
      <span className="absolute inset-0 flex" style={{ background: c.page, clipPath: clip }}>
        <span className="flex w-[30%] flex-col gap-[3px] px-[3px] pt-[4px]" style={{ background: c.side }}>
          <span className="h-[4px] w-full rounded-[1px]" style={{ background: c.sign }} />
          <span className="h-[2px] w-[80%] rounded-full opacity-40" style={{ background: m === "light" ? "#eef1f6" : c.ink }} />
          <span className="h-[2px] w-[70%] rounded-full opacity-40" style={{ background: m === "light" ? "#eef1f6" : c.ink }} />
        </span>
        <span className="flex flex-1 flex-col gap-[3px] px-[4px] pt-[5px]">
          <span className="h-[3px] w-[70%] rounded-full" style={{ background: c.ink }} />
          <span className="h-[2px] w-full rounded-full opacity-35" style={{ background: c.ink }} />
          <span className="h-[2px] w-[85%] rounded-full opacity-35" style={{ background: c.ink }} />
        </span>
      </span>
    );
  };
  return (
    <span aria-hidden className="relative block h-9 w-full overflow-hidden rounded-[3px] border border-border">
      {mode === "system" ? (
        <>
          {half("light")}
          {half("dark", "polygon(100% 0, 100% 100%, 0 100%)")}
        </>
      ) : (
        half(mode)
      )}
    </span>
  );
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; title?: string }[] = [
  { mode: "light", label: "Light" },
  { mode: "system", label: "System" },
  { mode: "dark", label: "Dark" },
  { mode: "night", label: "Night", title: "Night — real red cockpit lighting, to protect your night vision" },
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
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    const storedTheme = getStoredTheme();
    const storedAccent = getStoredCalendarAccent();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(storedTheme);
    setAccent(storedAccent);
    applyThemeAttribute(storedTheme);
    applyCalendarAccent(storedAccent);
    // Chosen elsewhere (the command palette, or the other of the two menus): show it here too.
    const onChange = (e: Event) => setMode((e as CustomEvent<ThemeMode>).detail);
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    // Into the panel at the mode that's on: each group of choices is one Tab stop, and the arrows move along it.
    ref.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      // Back to the button that opened it: closing used to leave the keyboard at the top of the page.
      buttonRef.current?.focus();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  /** The new mode sweeps across the window from the Appearance button (see `.theme-sweep` in globals.css). */
  function chooseTheme(next: ThemeMode) {
    if (next === mode) return;
    setMode(next);
    const root = document.documentElement;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Found by id, not the ref: this runs from the radios' key handlers too, which are built during render.
    const button = document.getElementById(`${panelId}-button`);
    if (still || !document.startViewTransition || !button) {
      setStoredTheme(next);
      return;
    }
    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    root.style.setProperty("--sweep-x", `${x}px`);
    root.style.setProperty("--sweep-y", `${y}px`);
    root.style.setProperty("--sweep-r", `${Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))}px`);
    root.classList.add("theme-sweep");
    const sweep = document.startViewTransition(() => setStoredTheme(next));
    sweep.finished.finally(() => root.classList.remove("theme-sweep"));
  }

  function chooseAccent(value: string | null) {
    setAccent(value);
    setStoredCalendarAccent(value);
  }

  // A pilot's own calendar color when they've picked one; otherwise the chrome's own accent (sign yellow).
  const accentCss = accent ?? "var(--color-accent)";
  const themeIndex = Math.max(0, THEME_OPTIONS.findIndex((o) => o.mode === mode));
  const accentIndex = Math.max(0, CALENDAR_ACCENT_PRESETS.findIndex((p) => p.value === accent));

  return (
    <div
      className="relative shrink-0"
      ref={ref}
      // Tabbing out of the panel closes it, as a click outside does. (A click that focuses nothing says no target: left open.)
      onBlur={(e) => {
        if (open && e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        id={`${panelId}-button`}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? panelId : undefined}
        title="Appearance"
        className="relative flex h-9 w-9 items-center justify-center rounded-[4px] border border-border transition-colors hover:border-border-strong"
      >
        <span style={{ color: accentCss }}>
          <PaletteIcon className="h-4 w-4" />
        </span>
        <span className="sr-only">Appearance settings</span>
      </button>

      {open && (
        // A small panel of two sets of choices, not a menu: it held radio groups, which a menu can't, so a screen reader
        // announced choices it then wouldn't let the arrows reach.
        <div
          id={panelId}
          role="dialog"
          aria-labelledby={`${panelId}-title`}
          className="absolute right-0 top-full z-40 mt-2 w-52 rail-collapsed:left-0 rail-collapsed:right-auto animate-fade-in overflow-hidden rounded-[6px] border border-border bg-surface shadow-elevated-lg"
        >
          <div className="border-b border-border px-4 py-3">
            <div id={`${panelId}-title`} className="text-sm font-medium text-ink">
              Appearance
            </div>
            <div className="text-xs text-ink-faint">Saved to this device only.</div>
          </div>

          <div className="space-y-4 px-4 py-3.5">
            <div>
              <div className="mb-2 text-2xs font-semibold text-ink-faint">Mode</div>
              <div role="radiogroup" aria-label="Color theme" className="grid grid-cols-4 gap-1">
                {THEME_OPTIONS.map((opt, i) => {
                  const on = mode === opt.mode;
                  return (
                    <button
                      key={opt.mode}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      {...radioKeyProps(i, THEME_OPTIONS.length, themeIndex, (n) => chooseTheme(THEME_OPTIONS[n].mode))}
                      title={opt.title ?? opt.label}
                      onClick={() => chooseTheme(opt.mode)}
                      className={`flex flex-col items-stretch gap-1 rounded-[4px] p-1 text-center text-2xs font-medium transition-colors ${
                        on ? "bg-accent-wash text-on-wash ring-[1.5px] ring-inset ring-accent" : "text-ink-muted hover:bg-ink/[0.06] hover:text-ink"
                      }`}
                    >
                      <ModePicture mode={opt.mode} />
                      <span>{opt.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-2 text-2xs font-semibold text-ink-faint">
                Calendar accent
              </div>
              <div role="radiogroup" aria-label="Calendar accent color" className="flex items-center gap-1.5">
                {CALENDAR_ACCENT_PRESETS.map((preset, i) => {
                  const swatchCss = preset.value ?? "var(--color-calendar-accent)";
                  const isSelected = accent === preset.value;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      {...radioKeyProps(i, CALENDAR_ACCENT_PRESETS.length, accentIndex, (n) => chooseAccent(CALENDAR_ACCENT_PRESETS[n].value))}
                      title={preset.label}
                      onClick={() => chooseAccent(preset.value)}
                      className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-[3px] transition-transform hover:-translate-y-px"
                      style={{
                        background: swatchCss,
                        boxShadow: isSelected ? `0 0 0 2px var(--color-surface), 0 0 0 3.5px ${swatchCss}` : "inset 0 0 0 1px rgb(0 0 0 / 0.15)",
                      }}
                    >
                      {isSelected && (
                        <svg viewBox="0 0 24 24" fill="none" stroke="rgb(0 0 0 / 0.75)" strokeWidth={3.5} className="h-2.5 w-2.5">
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
