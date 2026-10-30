import { useSyncExternalStore } from "react";

/** How the results list draws each line before it's opened: the bid pack's own strip, or the newer timeline. */
export type StripViewMode = "timeline" | "pack";

const KEY = "line-select:strip-view:v1";
/** Told to the page when the pilot switches, so every list on it switches together. */
const CHANGED = "line-select:strip-view-changed";

/** The newer timeline first; the pack's own look is a tap away for a pilot who reads lines the paper way. */
const DEFAULT_VIEW: StripViewMode = "timeline";

export function loadStripView(): StripViewMode {
  if (typeof window === "undefined") return DEFAULT_VIEW;
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw === "pack" || raw === "timeline" ? raw : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveStripView(view: StripViewMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, view);
  } catch {
    // ignore — quota exceeded or unavailable
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The pilot's choice of strip, remembered. The server and the first paint draw the default. */
export function useStripView(): [StripViewMode, (view: StripViewMode) => void] {
  const view = useSyncExternalStore(subscribe, loadStripView, () => DEFAULT_VIEW);
  return [view, saveStripView];
}
