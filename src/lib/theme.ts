export type ThemeMode = "light" | "dark" | "system";

const THEME_KEY = "line-select:theme:v1";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    // ignore
  }
  return "system";
}

export function applyThemeAttribute(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  if (mode === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", mode);
  }
}

export function setStoredTheme(mode: ThemeMode): void {
  applyThemeAttribute(mode);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {
    // ignore
  }
}

/**
 * Inlined into <head> so the correct theme attribute is set before first
 * paint, avoiding a flash of the wrong theme on load.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var mode = localStorage.getItem('${THEME_KEY}');
    if (mode === 'light' || mode === 'dark') {
      document.documentElement.setAttribute('data-theme', mode);
    }
  } catch (e) {}
})();
`;
