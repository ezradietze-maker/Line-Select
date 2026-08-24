import { isInternationalCity } from "@/lib/pdf-parser/airports";
import type { LayoverDetail, ParsedPairing, ParseWarning } from "@/lib/pdf-parser/types";
import type { ReportTime } from "@/types/bidpack";

const HEADER_RE =
  /^(\d+)\s+((?:[A-Z]{2}\s+)*[A-Z]{2})\s+REPORT\s+AT\s+(\d{3,4})\s*\(\s*[*#]?\d{3,4}\s*\)\s*(.*)$/i;
const EFFECTIVE_RE = /^EFFECTIVE\s+(.+)$/i;
const COLUMN_HEADER_RE = /^DAY\s+FLIGHT\s+EQP\s+DEPARTS\s+ARRIVES/i;
const FOOTER_RE =
  /^LDGS:\s*(\d+)\s+BLOCK\s*HRS:\s*(\d{1,3}:\d{2})\s+CREDIT\s*HRS:\s*(\d{1,3}:\d{2})\s*T?\s*TAFB:\s*(\d{1,4}:\d{2})\s*$/i;
// Weekday letters are usually present ("01TU") but are occasionally dropped
// by the source PDF for single-day pairings, leaving a bare date ("1"). We
// don't rely on the letters for anything beyond distinct-day counting, so
// accept either form rather than rejecting the whole leg row.
const DAY_TOKEN_RE = /^[*#]?(\d{0,2}[A-Z]{0,2})$/;
const AIRPORT_RE = /^[A-Z]{3}$/;
const TIME_PAIR_RE = /^\d{4}\([*#]?\d{4}\)$/;
const HHMM_RE = /^\d{1,3}:\d{2}$/;
const SEPARATOR_RE = /^[.\s]{10,}$/;
const isNonEmptyRow = (r: string) => r.trim().length > 0 && !SEPARATOR_RE.test(r);
// The hotel's own address/phone block sits between "Trans To:" and "Trans
// From:" lines for the same layover, e.g. "Hotel: WHITE SWAN (CAN),
// +86-20-8188-6968". Some entries have a stray phone-like number wedged
// between the name and the city code (an extraction artifact from a
// two-column source table, e.g. "HILTON NRT 011-81-476-33-1121 (NRT)", or
// even glued on with no space at all, e.g. "PUDONG SHANGRI-LA862168826888"),
// so a trailing run of digits/punctuation is stripped from the captured
// name — whitespace before it is optional, since the source PDF isn't
// consistent about including one.
const HOTEL_RE = /^Hotel:\s*(.+?)\s*\(([A-Z]{3})\)/i;

function extractHotelName(row: string): string | null {
  const match = row.match(HOTEL_RE);
  if (!match) return null;
  const cleaned = match[1].replace(/\s*\d[\d\s\-()]{5,}$/, "").trim();
  return cleaned || null;
}

function timeToHours(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
}

function classifyReportTime(localHHMM: string): ReportTime {
  const hour = Math.floor(Number(localHHMM) / 100);
  if (hour >= 0 && hour < 10) return "early";
  if (hour >= 10 && hour < 17) return "afternoon";
  return "evening";
}

interface LegInfo {
  dayLetters: string;
  flightNumber: string;
  depAirport: string;
  arrAirport: string;
  isDeadhead: boolean;
  layoverCity?: string;
}

function tryParseLeg(row: string): LegInfo | null {
  const tokens = row.split(" ").filter(Boolean);
  if (tokens.length < 7) return null;

  const dayMatch = tokens[0].match(DAY_TOKEN_RE);
  if (!dayMatch) return null;
  const flightNumber = tokens[1];
  if (!/^[A-Z]{0,3}\d+$/.test(flightNumber)) return null;
  if (!/^(\d+|JET)$/.test(tokens[2])) return null;
  const depAirport = tokens[3];
  if (!AIRPORT_RE.test(depAirport)) return null;
  if (!TIME_PAIR_RE.test(tokens[4])) return null;
  const arrAirport = tokens[5];
  if (!AIRPORT_RE.test(arrAirport)) return null;
  if (!TIME_PAIR_RE.test(tokens[6])) return null;
  if (tokens.length > 7 && !HHMM_RE.test(tokens[7])) return null;

  const rest = tokens.slice(8);
  const isDeadhead = rest.length > 0 && rest[0].toUpperCase() === "DH";

  // Layover city: a 3-letter code immediately followed by an HH:MM at the
  // tail of the row (the last leg of a duty period reports its layover).
  let layoverCity: string | undefined;
  for (let i = rest.length - 2; i >= 0; i--) {
    if (AIRPORT_RE.test(rest[i]) && HHMM_RE.test(rest[i + 1])) {
      layoverCity = rest[i];
      break;
    }
  }

  return { dayLetters: dayMatch[1], flightNumber, depAirport, arrAirport, isDeadhead, layoverCity };
}

interface RawBlock {
  rows: string[];
  startIndex: number;
}

/** Splits a column's rows into per-pairing blocks, delimited by a new header line. Anything before the first header (page title, legend text) isn't a pairing and is discarded. */
function splitIntoBlocks(rows: string[]): RawBlock[] {
  const blocks: RawBlock[] = [];
  let current: string[] = [];
  let startIndex = 0;
  let seenFirstHeader = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const isHeaderStart = HEADER_RE.test(row);
    if (isHeaderStart) {
      if (current.length > 0) blocks.push({ rows: current, startIndex });
      current = [];
      startIndex = i;
      seenFirstHeader = true;
    }
    if (!seenFirstHeader || !isNonEmptyRow(row)) continue;
    current.push(row);
  }
  if (current.length > 0) blocks.push({ rows: current, startIndex });
  return blocks;
}

export function parsePairingColumn(
  rows: string[],
  pageNumber: number,
  warnings: ParseWarning[]
): ParsedPairing[] {
  const blocks = splitIntoBlocks(rows.filter(isNonEmptyRow));
  const pairings: ParsedPairing[] = [];

  for (const block of blocks) {
    const headerRow = block.rows.find((r) => HEADER_RE.test(r));
    const headerMatch = headerRow?.match(HEADER_RE);
    if (!headerMatch) {
      warnings.push({
        pageNumber,
        message: "Skipped a pairing block with no recognizable report-time header.",
        context: block.rows[0]?.slice(0, 80),
      });
      continue;
    }

    const footerRow = block.rows.find((r) => FOOTER_RE.test(r));
    const footerMatch = footerRow?.match(FOOTER_RE);
    if (!footerMatch) {
      warnings.push({
        pageNumber,
        message: `Skipped pairing ${headerMatch[1]}: couldn't find its LDGS/BLOCK/CREDIT/TAFB summary line.`,
        context: block.rows.at(-1)?.slice(0, 80),
      });
      continue;
    }

    const effectiveRow = block.rows.find((r) => EFFECTIVE_RE.test(r));
    const effectiveText = effectiveRow?.match(EFFECTIVE_RE)?.[1]?.trim() ?? "";

    const contentRows = block.rows.filter(
      (r) => !HEADER_RE.test(r) && !EFFECTIVE_RE.test(r) && !COLUMN_HEADER_RE.test(r) && !FOOTER_RE.test(r)
    );

    // Walked in printed order (not filtered to leg rows alone) so a "Hotel:"
    // line — which never matches the flight-leg pattern itself — can be
    // attached to whichever layover it immediately follows.
    const legs: LegInfo[] = [];
    const layoverDetails: LayoverDetail[] = [];
    for (const row of contentRows) {
      const leg = tryParseLeg(row);
      if (leg) {
        legs.push(leg);
        if (leg.layoverCity) layoverDetails.push({ city: leg.layoverCity, hotelName: null });
        continue;
      }
      const hotelName = extractHotelName(row);
      if (hotelName && layoverDetails.length > 0) {
        layoverDetails[layoverDetails.length - 1].hotelName = hotelName;
      }
    }

    if (legs.length === 0) {
      warnings.push({
        pageNumber,
        message: `Skipped pairing ${headerMatch[1]}: found its header and totals but no readable flight legs.`,
        context: contentRows[0]?.slice(0, 80),
      });
      continue;
    }

    const distinctDays = new Set(legs.map((l) => l.dayLetters));
    const layoverCities = Array.from(new Set(layoverDetails.map((d) => d.city)));
    const allCities = new Set([
      ...legs.map((l) => l.depAirport),
      ...legs.map((l) => l.arrAirport),
    ]);
    const international = Array.from(allCities).some(isInternationalCity);
    const deadheadLegs = legs.filter((l) => l.isDeadhead).length;
    const flightNumbers = legs.map((l) => l.flightNumber);

    const reportLocal = headerMatch[3];
    const sequenceNumber = headerMatch[1];

    // The printed LDGS field is unreliable — some pairings (seen on pages
    // documenting short/reserve-style duty) print 0 regardless of how many
    // legs the pilot actually flew. A bare-digit flight number (no airline
    // prefix, e.g. "6091") is a company-operated leg the pilot lands; one
    // with an airline code prefix (e.g. "UA0869", "WN1411") is a commercial
    // flight ridden as a passenger. Counting bare-digit legs matches the
    // printed LDGS value on every pairing checked where that value was
    // itself trustworthy — including ones flagged deadhead, so deadhead
    // status is not part of this rule — so it replaces LDGS entirely rather
    // than only filling in when the printed value is 0.
    const landings = legs.filter((l) => /^\d+$/.test(l.flightNumber)).length;

    pairings.push({
      id: `p-${pageNumber}-${sequenceNumber}-${flightNumbers[0]}-${block.startIndex}`,
      sequenceNumber,
      pageNumber,
      days: Math.max(1, distinctDays.size),
      layoverCities,
      layoverDetails,
      reportTime: classifyReportTime(reportLocal),
      reportTimeLocal: reportLocal,
      international,
      deadheadLegs,
      creditHours: timeToHours(footerMatch[3]),
      blockHours: timeToHours(footerMatch[2]),
      landings,
      tafbHours: timeToHours(footerMatch[4]),
      effectiveText,
      firstFlightNumber: flightNumbers[0],
      flightNumbers,
    });
  }

  return pairings;
}
