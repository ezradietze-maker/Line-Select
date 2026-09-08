/**
 * A personal accent color for calendar views only (the "Flying" segment
 * color in the mini month calendar and the full trip-list calendar) — built
 * on top of the existing flight-plan/nav-log design system, not a redesign
 * of it. Applied as a single CSS custom property override on
 * `documentElement`, the same simple global-attribute approach `theme.ts`
 * already uses for light/dark mode, so it survives a theme switch unchanged
 * (see `--color-calendar-accent`'s own doc comment in `globals.css`).
 */

const CALENDAR_ACCENT_KEY = "line-select:calendar-accent:v1";
const CSS_VAR = "--color-calendar-accent";

/** A handful of curated, always-legible-on-both-themes options rather than a full color wheel — every one of these reads clearly as both a light calendar bar and a dark one. */
export const CALENDAR_ACCENT_PRESETS = [
  { label: "Default", value: null },
  { label: "Amber", value: "#b5792b" },
  { label: "Teal", value: "#2f7d6b" },
  { label: "Violet", value: "#6b5b95" },
  { label: "Crimson", value: "#a3435a" },
  { label: "Slate green", value: "#4a6d5c" },
] as const;

export function getStoredCalendarAccent(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(CALENDAR_ACCENT_KEY);
  } catch {
    return null;
  }
}

export function applyCalendarAccent(hex: string | null): void {
  if (typeof document === "undefined") return;
  if (hex) {
    document.documentElement.style.setProperty(CSS_VAR, hex);
  } else {
    document.documentElement.style.removeProperty(CSS_VAR);
  }
}

export function setStoredCalendarAccent(hex: string | null): void {
  applyCalendarAccent(hex);
  if (typeof window === "undefined") return;
  try {
    if (hex) window.localStorage.setItem(CALENDAR_ACCENT_KEY, hex);
    else window.localStorage.removeItem(CALENDAR_ACCENT_KEY);
  } catch {
    // ignore
  }
}
