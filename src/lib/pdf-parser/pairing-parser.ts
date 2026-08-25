import { isInternationalCity } from "@/lib/pdf-parser/airports";
import type {
  LayoverDetail,
  ParsedPairing,
  ParseWarning,
  ScheduledDutyPeriod,
  ScheduledLeg,
} from "@/lib/pdf-parser/types";
import type { ReportTime } from "@/types/bidpack";

// The pairing schedule prints every clock time as "GMT(LOCAL)" — confirmed
// against real data (e.g. an Oakland departure "1940(1240)": 1940 UTC minus
// PDT's 7-hour offset is exactly 1240 local), and matches the page's own
// legend, "(hhmm) - Local Military Time" — the parenthesized value is local,
// the bare one in front of it is GMT. The header's report time uses the same
// convention, so group 3 (bare) is GMT and group 4 (parenthesized) is local.
const HEADER_RE =
  /^(\d+)\s+((?:[A-Z]{2}\s+)*[A-Z]{2})\s+REPORT\s+AT\s+(\d{3,4})\s*\(\s*[*#]?(\d{3,4})\s*\)\s*(.*)$/i;
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

// "Trans To: <company> (<city>), <phone>, pickup @<gmt> (<local>)" — the
// airport->hotel ride right after landing. "Trans From:" is the same
// company/hotel-pickup ride the other direction, before the next
// departure. The phone number and pickup time can print on a second,
// separate row when the company name is long (confirmed on a real page:
// "Trans To: ASCENT LUXURY TRANSPORTATION (SLC)," then a lone
// "+1-801-263-9606, pickup @0153 (*1953)" row) — the regex only needs the
// company name, which is always complete on the row that starts with
// "Trans To:"/"Trans From:" itself, so a wrapped second row is simply
// never matched and never needed here.
const TRANSPORT_RE = /^Trans\s+(To|From):\s*(.+?)\s*\([A-Z]{3}\)/i;

function extractTransport(row: string): { direction: "To" | "From"; company: string } | null {
  const match = row.match(TRANSPORT_RE);
  if (!match) return null;
  return { direction: match[1] as "To" | "From", company: match[2].trim() };
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

const TIME_PAIR_CAPTURE_RE = /^(\d{4})\([*#]?(\d{4})\)$/;

/** Splits a "GMT(LOCAL)" token, e.g. "1940(1240)", into its two clock readings. */
function parseTimePair(token: string): { gmt: string; local: string } | null {
  const match = token.match(TIME_PAIR_CAPTURE_RE);
  if (!match) return null;
  return { gmt: match[1], local: match[2] };
}

function hhmmToMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2, 4));
}

/**
 * Reconstructs elapsed minutes from a sequence of daily-wrapping GMT clock
 * readings, using only what's actually printed — no calendar dates are
 * available for a pairing whose EFFECTIVE text is a date range rather than a
 * single day, so this deliberately produces minutes-since-report-time
 * (relative), not absolute timestamps.
 */
class RunningClock {
  private absoluteMinutes = 0;
  private lastMinuteOfDay = 0;

  /** Seeds t=0 at the pairing's first report time. */
  seed(hhmm: string): void {
    this.lastMinuteOfDay = hhmmToMinutes(hhmm);
    this.absoluteMinutes = 0;
  }

  /** Feeds the next chronological GMT reading, inferring a midnight rollover whenever it's earlier in the day than the previous one. */
  advance(hhmm: string): number {
    const minuteOfDay = hhmmToMinutes(hhmm);
    let delta = minuteOfDay - this.lastMinuteOfDay;
    if (delta < 0) delta += 24 * 60;
    this.absoluteMinutes += delta;
    this.lastMinuteOfDay = minuteOfDay;
    return this.absoluteMinutes;
  }

  /** Jumps forward by an explicitly known duration (a printed layover length spans too many days for `advance`'s single-rollover assumption), re-syncing the day tracker so the next `advance` call stays correct. */
  jumpBy(minutes: number): number {
    this.absoluteMinutes += minutes;
    this.lastMinuteOfDay = (((this.lastMinuteOfDay + minutes) % 1440) + 1440) % 1440;
    return this.absoluteMinutes;
  }
}

interface RichLegMatch {
  flightNumber: string;
  /** "JET" for an interline/generic airframe, or the operator's own fleet code (e.g. "76", "72") for a company-operated leg — printed directly in the EQP column, not inferred. */
  equipment: string;
  depAirport: string;
  depGmt: string;
  depLocal: string;
  arrAirport: string;
  arrGmt: string;
  arrLocal: string;
  blockHours: number | null;
  isDeadhead: boolean;
  layover: { city: string; hours: number } | null;
}

/**
 * A richer re-read of the same leg row `tryParseLeg` already validates,
 * additionally keeping the actual clock times and block hours (previously
 * discarded once the row was confirmed well-formed) — powers the visual
 * timeline. Deadhead detection is broader here than `LegInfo.isDeadhead`
 * (which only catches the explicit "DH" flag): an interline flight number
 * (e.g. "UA0869") is just as much a deadhead even with no flag, using the
 * same bare-digit-vs-prefixed signal already relied on for landings.
 */
function tryParseRichLeg(row: string): RichLegMatch | null {
  const tokens = row.split(" ").filter(Boolean);
  if (tokens.length < 7) return null;

  const dayMatch = tokens[0].match(DAY_TOKEN_RE);
  if (!dayMatch) return null;
  const flightNumber = tokens[1];
  if (!/^[A-Z]{0,3}\d+$/.test(flightNumber)) return null;
  if (!/^(\d+|JET)$/.test(tokens[2])) return null;
  const depAirport = tokens[3];
  if (!AIRPORT_RE.test(depAirport)) return null;
  const depPair = parseTimePair(tokens[4]);
  if (!depPair) return null;
  const arrAirport = tokens[5];
  if (!AIRPORT_RE.test(arrAirport)) return null;
  const arrPair = parseTimePair(tokens[6]);
  if (!arrPair) return null;
  if (tokens.length > 7 && !HHMM_RE.test(tokens[7])) return null;

  const blockHours = tokens.length > 7 ? timeToHours(tokens[7]) : null;
  const rest = tokens.slice(8);
  const isDeadhead = !/^\d+$/.test(flightNumber) || rest.some((t) => t.toUpperCase() === "DH");

  let layover: { city: string; hours: number } | null = null;
  for (let i = rest.length - 2; i >= 0; i--) {
    if (AIRPORT_RE.test(rest[i]) && HHMM_RE.test(rest[i + 1])) {
      layover = { city: rest[i], hours: timeToHours(rest[i + 1]) };
      break;
    }
  }

  return {
    flightNumber,
    equipment: tokens[2],
    depAirport,
    depGmt: depPair.gmt,
    depLocal: depPair.local,
    arrAirport,
    arrGmt: arrPair.gmt,
    arrLocal: arrPair.local,
    blockHours,
    isDeadhead,
    layover,
  };
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

    const reportTimeGmt = headerMatch[3];
    const reportTimeLocal = headerMatch[4];
    const sequenceNumber = headerMatch[1];

    // A second, richer pass over the same content rows building the actual
    // minute-by-minute schedule for the visual timeline — kept separate from
    // the `legs`/`layoverDetails` pass above so a bug here can never affect
    // the already-verified summary fields (days, layovers, deadhead count,
    // landings) those computed.
    const schedule: ScheduledDutyPeriod[] = [];
    {
      const clock = new RunningClock();
      clock.seed(reportTimeGmt);
      let currentLegs: ScheduledLeg[] = [];
      let dutyStartMinutes = 0;

      for (const row of contentRows) {
        const richLeg = tryParseRichLeg(row);
        if (richLeg) {
          const startMinutes = clock.advance(richLeg.depGmt);
          const endMinutes = clock.advance(richLeg.arrGmt);
          currentLegs.push({
            flightNumber: richLeg.flightNumber,
            equipment: richLeg.equipment,
            isDeadhead: richLeg.isDeadhead,
            depAirport: richLeg.depAirport,
            depTimeLocal: richLeg.depLocal,
            depTimeGmt: richLeg.depGmt,
            arrAirport: richLeg.arrAirport,
            arrTimeLocal: richLeg.arrLocal,
            arrTimeGmt: richLeg.arrGmt,
            blockHours: richLeg.blockHours,
            startMinutes,
            endMinutes,
          });

          if (richLeg.layover) {
            const layoverMinutes = Math.round(richLeg.layover.hours * 60);
            const layoverEnd = clock.jumpBy(layoverMinutes);
            schedule.push({
              // Only the pairing's very first duty period has a printed
              // report time; later ones use their own first leg's real
              // departure time as the best honest stand-in — an
              // approximation of "duty begins around here," not a claimed
              // report time, since no report-lead-time is printed for them.
              reportTimeLocal: schedule.length === 0 ? reportTimeLocal : currentLegs[0].depTimeLocal,
              startMinutes: dutyStartMinutes,
              legs: currentLegs,
              layover: {
                city: richLeg.layover.city,
                hotelName: null,
                transportToHotel: null,
                transportFromHotel: null,
                hours: richLeg.layover.hours,
                startMinutes: endMinutes,
                endMinutes: layoverEnd,
              },
            });
            currentLegs = [];
            dutyStartMinutes = layoverEnd;
          }
          continue;
        }

        const hotelName = extractHotelName(row);
        const lastDuty = schedule[schedule.length - 1];
        if (hotelName && lastDuty?.layover) lastDuty.layover.hotelName = hotelName;

        const transport = extractTransport(row);
        if (transport && lastDuty?.layover) {
          if (transport.direction === "To") lastDuty.layover.transportToHotel = transport.company;
          else lastDuty.layover.transportFromHotel = transport.company;
        }
      }

      if (currentLegs.length > 0) {
        schedule.push({
          reportTimeLocal: schedule.length === 0 ? reportTimeLocal : currentLegs[0].depTimeLocal,
          startMinutes: dutyStartMinutes,
          legs: currentLegs,
          layover: null,
        });
      }
    }

    // Self-verifying, matching the house style: only trust the rich
    // schedule when its own total block hours agrees with the pairing's
    // printed BLOCK HRS footer — a mismatch means the row-shape assumptions
    // above didn't hold for this pairing, and it's safer to fall back to no
    // detailed schedule than to show a pilot a plausible-looking but wrong
    // one. The footer's BLOCK HRS counts every company-metal (bare-digit
    // flight number) leg, even ones flagged "DH" — confirmed against real
    // data: a pairing with two such legs only reconciled once they were
    // included, so the "DH" flag on a company flight affects the flying/
    // deadhead label shown to a pilot, not this airline's own block-hour
    // accounting. Only genuinely interline flight numbers (an actual
    // different carrier) are excluded here.
    const scheduledBlockHours = schedule
      .flatMap((d) => d.legs)
      .filter((l) => /^\d+$/.test(l.flightNumber))
      .reduce((sum, l) => sum + (l.blockHours ?? 0), 0);
    const footerBlockHours = timeToHours(footerMatch[2]);
    const verifiedSchedule = Math.abs(scheduledBlockHours - footerBlockHours) < 0.05 ? schedule : [];
    if (schedule.length > 0 && verifiedSchedule.length === 0) {
      warnings.push({
        pageNumber,
        message: `Pairing ${headerMatch[1]}: detailed schedule didn't reconcile with the printed block hours, so no per-trip timeline is shown for it.`,
      });
    }

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
      reportTime: classifyReportTime(reportTimeLocal),
      reportTimeLocal: reportTimeLocal,
      international,
      deadheadLegs,
      creditHours: timeToHours(footerMatch[3]),
      blockHours: timeToHours(footerMatch[2]),
      landings,
      tafbHours: timeToHours(footerMatch[4]),
      effectiveText,
      firstFlightNumber: flightNumbers[0],
      flightNumbers,
      schedule: verifiedSchedule,
    });
  }

  return pairings;
}
