import { extractBidPeriodStart } from "@/lib/pdf-parser/line-grid-days";
import type { BidPackMeta } from "@/lib/pdf-parser/types";

const MONTH_ABBREV: Record<string, string> = {
  JANUARY: "JAN", FEBRUARY: "FEB", MARCH: "MAR", APRIL: "APR", MAY: "MAY", JUNE: "JUN",
  JULY: "JUL", AUGUST: "AUG", SEPTEMBER: "SEP", OCTOBER: "OCT", NOVEMBER: "NOV", DECEMBER: "DEC",
};

const PAIRING_HEADER_RE =
  /^([A-Z]+)\s+(\d{4})\s+BID\s*PACK\s*PAIRING\s*SCHEDULE\s*FOR\s+(\S+)\s+(\S+)/i;
const LINE_GRID_HEADER_RE =
  /(\S+)\s+(\S+)\s+DOMICILE\s*-\s*(CAPTAIN|CAP|F\s*\/\s*O|FIRST OFFICER)\s*ONLY/i;

export function extractMetaFromPairingHeader(header: string): Partial<BidPackMeta> | null {
  const m = header.match(PAIRING_HEADER_RE);
  if (!m) return null;
  const monthAbbrev = MONTH_ABBREV[m[1].toUpperCase()] ?? m[1].slice(0, 3).toUpperCase();
  const yearShort = m[2].slice(-2);
  return { month: `${monthAbbrev}${yearShort}`, aircraft: m[3], base: m[4] };
}

export function extractMetaFromLineGridHeader(header: string): Partial<BidPackMeta> | null {
  const m = header.match(LINE_GRID_HEADER_RE);
  if (!m) return null;
  const seatText = m[3].toUpperCase().replace(/\s+/g, "");
  const seat = seatText.includes("F") ? "FO" : "CAP";
  return { aircraft: m[1], base: m[2], seat, bidPeriodStart: extractBidPeriodStart(header) };
}
