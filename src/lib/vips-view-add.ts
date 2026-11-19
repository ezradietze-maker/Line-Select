import { useSyncExternalStore } from "react";
import { VIPS_CGI } from "@/lib/vips-bid";

/**
 * Hands a View/Add list to VIPS's make-up page (`webmmu`), as `vips-bid.ts` hands a line order to the bid page: a form
 * posted into a new tab, where the pilot signs in themselves. The layout is the one another FedEx bidding tool posts,
 * read from its public client code; neither FedEx nor the union documents it, so the screen says to check it on VIPS
 * before submitting, and the first real use should be a current pilot's:
 *  - `n999` = "Continue";
 *  - `nMKPTYP`, the make-up type: "CIA" (phase-in) or "MUV" (vacation), one per submission;
 *  - `nMKPCAP`, the hours to make up, "HH:MM";
 *  - `n201001` … `n201099`, one preference each: a set of trips "TRIP/DDMon,TRIP/DDMon", awarded whole (written by
 *    `vipsPreferenceText` in `view-add.ts`).
 *
 * CBA 2026 25.E.4.a.iv: bids are "only by: (a) Specific trip number (including date); (b) Reserve block label; and/or (c)
 * Base simulator support event label", so a reserve block or simulator label goes as the pilot typed it.
 */

export type MakeUpType = "CIA" | "MUV";

/** The tool's limit, and the page's own words: "limited to 99 choices". */
export const MAX_VIEW_ADD_PREFERENCES = 99;

export function vipsViewAddUrl(employeeNumber: string): string {
  return `${VIPS_CGI}?webmmu?${employeeNumber}?`;
}

/** Hours as the page takes them, "12:00", "08:30". */
export function makeUpHoursText(hours: number): string {
  const minutes = Math.round(Math.max(0, hours) * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export type ViewAddBuild = { ok: true; fields: [name: string, value: string][]; preferences: string[] } | { ok: false; reason: string };

/** The form fields for one View/Add submission, in the page's order. A repeated preference is dropped: VIPS would only try it once. */
export function buildViewAddFields({ type, hours, preferences }: { type: MakeUpType; hours: number; preferences: string[] }): ViewAddBuild {
  if (!Number.isFinite(hours) || hours <= 0 || hours >= 100) return { ok: false, reason: "Enter the hours you want to make up, more than 0 and under 100." };
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of preferences) {
    const p = raw.trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    kept.push(p);
  }
  if (!kept.length) return { ok: false, reason: "There's nothing to bid: build your list first." };
  if (kept.length > MAX_VIEW_ADD_PREFERENCES) return { ok: false, reason: `VIPS takes at most ${MAX_VIEW_ADD_PREFERENCES} choices; this list has ${kept.length}.` };
  const fields: [string, string][] = [
    ["n999", "Continue"],
    ["nMKPTYP", type],
    ["nMKPCAP", makeUpHoursText(hours)],
    ...kept.map((p, i): [string, string] => [`n2010${String(i + 1).padStart(2, "0")}`, p]),
  ];
  return { ok: true, fields, preferences: kept };
}

// ---- What was sent, kept on this device for each pack ----

export interface ViewAddSent {
  /** ISO time it was sent. */
  at: string;
  type: MakeUpType;
  hours: number;
  preferences: string[];
}

const KEY = "line-select:view-add-sent:v1:";
const CHANGED = "line-select:view-add-sent-changed";

export function parseViewAddSent(raw: string | null): ViewAddSent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<ViewAddSent>;
    if (typeof v.at !== "string" || (v.type !== "CIA" && v.type !== "MUV") || typeof v.hours !== "number" || !Array.isArray(v.preferences)) return null;
    return { at: v.at, type: v.type, hours: v.hours, preferences: v.preferences.filter((p): p is string => typeof p === "string") };
  } catch {
    return null;
  }
}

function loadRaw(packId: string): string | null {
  try {
    return window.localStorage.getItem(KEY + packId);
  } catch {
    return null;
  }
}

export function saveViewAddSent(packId: string, sent: ViewAddSent): void {
  try {
    window.localStorage.setItem(KEY + packId, JSON.stringify(sent));
  } catch {
    // unavailable storage: VIPS has the list all the same
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The last list sent from this device for this pack, as stored text: read it with `parseViewAddSent`. */
export function useViewAddSentRaw(packId: string): string | null {
  return useSyncExternalStore(subscribe, () => loadRaw(packId), () => null);
}
