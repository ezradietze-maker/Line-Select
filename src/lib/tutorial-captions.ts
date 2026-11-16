import { useSyncExternalStore } from "react";

/** Whether the tutorial shows its captions: one choice for every chapter, remembered on this device. */
const KEY = "line-select:tutorial-captions:v1";
/** Told to the page when the pilot switches, from the switch or the player's own CC button. */
const CHANGED = "line-select:tutorial-captions-changed";

/** On until the pilot turns them off: the tutorial is often watched with the sound off. */
const DEFAULT_ON = true;

/** The stored choice; anything else stored there (or nothing) is the default. */
export function readCaptions(raw: string | null): boolean {
  return raw === "off" ? false : raw === "on" ? true : DEFAULT_ON;
}

export function loadCaptions(): boolean {
  if (typeof window === "undefined") return DEFAULT_ON;
  try {
    return readCaptions(window.localStorage.getItem(KEY));
  } catch {
    return DEFAULT_ON;
  }
}

export function saveCaptions(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // ignore — quota exceeded or unavailable; the page still switches for this visit
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

/** Captions on or off for the whole tutorial. The server and the first paint draw the default. */
export function useTutorialCaptions(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, loadCaptions, () => DEFAULT_ON);
  return [on, saveCaptions];
}
