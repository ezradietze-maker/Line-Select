import type { Seat } from "@/types/bidpack";

/**
 * What VIPS's Monthly Bid Input page says at its top, as the pilot pastes or types it: the bid they're placing ("You
 * are bidding as a IND B767 First Officer for Flying Purposes") and their current bid seniority ("3 of 45"). Line Select
 * never reads VIPS itself, so this is the pilot's own copy of it, checked against the pack the order came from.
 */
export interface VipsHeader {
  base?: string;
  /** As VIPS prints it ("B767", "MD-11"); compare with `sameAircraft`. */
  aircraft?: string;
  seat?: Seat;
  /** "for Flying Purposes", or "for Pay Purposes" for a pilot bidding pay-only. */
  purpose?: "flying" | "pay";
  /** Bid seniority: "3 of 45" — the pilot's place in this month's bid order, and the size of it. */
  position?: { number: number; of: number };
}

const SEAT_WORDS: [RegExp, Seat][] = [
  [/\b(?:first\s+officer|f\s*\/\s*o|fo)\b/i, "FO"],
  [/\b(?:captain|capt?|ca)\b/i, "CAP"],
];

/** A fleet as written anywhere: "B767", "767", "MD-11", "MD11", "A300", "B777F". */
const AIRCRAFT_RE = /\b(B?7[0-9]7F?|MD-?1[01]|DC-?10|A-?3[01]0F?)\b/i;

/** "B767" and "767" are one fleet, as are "MD-11" and "MD11"; a trailing F (freighter) changes nothing. */
export function aircraftKey(name: string): string {
  const k = name.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/F$/, "");
  return /^B\d{3}$/.test(k) ? k.slice(1) : k;
}

export function sameAircraft(a: string, b: string): boolean {
  return aircraftKey(a) === aircraftKey(b);
}

/** Reads what it can; anything it can't is left out, so a half-pasted line still checks what it holds. */
export function parseVipsHeader(text: string): VipsHeader | null {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return null;
  const out: VipsHeader = {};
  const bidding = t.match(/bidding\s+as\s+an?\s+([A-Z]{3})\b/i);
  // A base: the three letters after "bidding as a", or a lone three-letter code typed as the first word ("IND B767 FO").
  const base = bidding?.[1] ?? t.match(/^([A-Z]{3})\b(?=\s)/)?.[1];
  if (base && !/^(?:CAP|THE|YOU|AND|FOR)$/i.test(base)) out.base = base.toUpperCase();
  const aircraft = t.match(AIRCRAFT_RE)?.[1];
  if (aircraft) out.aircraft = aircraft.toUpperCase();
  // The seat words, outside the position ("3 of 45" has no seat in it) and the purpose.
  const words = t.replace(/\d+\s*(?:of|\/)\s*\d+/gi, " ");
  for (const [re, seat] of SEAT_WORDS) {
    if (re.test(words)) {
      out.seat = seat;
      break;
    }
  }
  if (/\bpay\s+purposes?\b|\bpay[\s-]+only\b/i.test(t)) out.purpose = "pay";
  else if (/\bflying\s+purposes?\b/i.test(t)) out.purpose = "flying";
  const pos = t.match(/\b(\d{1,4})\s*(?:of|\/)\s*(\d{1,4})\b/i);
  if (pos) {
    const number = Number(pos[1]);
    const of = Number(pos[2]);
    if (number >= 1 && of >= number) out.position = { number, of };
  }
  return Object.keys(out).length ? out : null;
}

/** How the pack names this bid, in VIPS's words, for a message: "MEM B767 First Officer". */
export function seatWords(seat: Seat): string {
  return seat === "FO" ? "First Officer" : "Captain";
}

const STORE = "line-select:vips-header:v1:";

/** What was read from the pilot's copy for this pack, kept on this device so it's entered once a month. */
export function loadVipsHeaderText(packId: string): string {
  try {
    return window.localStorage.getItem(STORE + packId) ?? "";
  } catch {
    return "";
  }
}

/**
 * The header in VIPS's own words, rebuilt from what was read: the top of VIPS's page also shows the pilot's name and
 * employee number, so a pasted copy is never kept as it was pasted.
 */
export function formatVipsHeader(h: VipsHeader): string {
  const bid = [h.base, h.aircraft, h.seat && seatWords(h.seat)].filter(Boolean).join(" ");
  const purpose = h.purpose ? ` for ${h.purpose === "pay" ? "Pay" : "Flying"} Purposes` : "";
  const position = h.position ? `${h.position.number} of ${h.position.of}` : "";
  return [bid ? `You are bidding as a ${bid}${purpose}` : purpose.trim(), position].filter(Boolean).join(" ");
}

/** Keeps only what was read from it (see `formatVipsHeader`); nothing for a line that read as nothing. */
export function saveVipsHeaderText(packId: string, text: string): void {
  try {
    const read = parseVipsHeader(text);
    if (read) window.localStorage.setItem(STORE + packId, formatVipsHeader(read));
    else window.localStorage.removeItem(STORE + packId);
  } catch {
    // unavailable storage: it's still checked for this visit
  }
}
