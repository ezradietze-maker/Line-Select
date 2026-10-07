import { isInternationalCity } from "@/lib/pdf-parser/airports";
import { isStandbyDutyCode } from "@/lib/standby";
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
// The EQP column: a company fleet code ("83", "55"), "JET" for an interline
// airliner, or "CAB" for ground transport between airports ("GT9999 CAB
// MOB … BFM 19:47") — 355 such rows across real packs, which used to be
// rejected outright, silently dropping any layover printed on them and
// merging the duty days on either side into one.
const EQUIPMENT_RE = /^(\d+|[A-Z]{3})$/;
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
// consistent about including one. "/" is included in that trailing run
// (confirmed against a real entry, "HILTON 907/272-7411") since a phone
// number sometimes prints with a slash before the area code rather than a
// dash — without it, the cleanup regex stops at the slash and leaves a
// stray "907/" glued onto the name.
const HOTEL_RE = /^Hotel:\s*(.+?)\s*\(([A-Z]{3})\)/i;

function extractHotel(row: string): { name: string; city: string } | null {
  const match = row.match(HOTEL_RE);
  if (!match) return null;
  const cleaned = match[1].replace(/\s*\d[\d\s\-()/]{5,}$/, "").trim();
  return cleaned ? { name: cleaned, city: match[2].toUpperCase() } : null;
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
const TRANSPORT_RE = /^Trans\s+(To|From):\s*(.+?)\s*\(([A-Z]{3})\)/i;

function extractTransport(row: string): { direction: "To" | "From"; company: string; city: string } | null {
  const match = row.match(TRANSPORT_RE);
  if (!match) return null;
  return { direction: match[1] as "To" | "From", company: match[2].trim(), city: match[3].toUpperCase() };
}

// The pickup on a "Trans From:" line — on the same row, or on the wrapped row after it when the company name is long. Local time can carry a "*" (previous day).
const PICKUP_RE = /pickup\s*@\s*(\d{4})\s*\(\s*\*?(\d{4})\s*\)/i;

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

// A ground-duty code — "STHOTL" (standby/reserve at a hotel near base) is
// the one confirmed against real bid packs, printed as a same-airport
// "leg" with no flying at all. Written to recognize the *shape* rather
// than that one literal string: a real flight number always ends in at
// least one digit (company or interline), so an all-letters code is never
// ambiguous with one. Ground duty also has no EQP column at all — every
// field after the code sits one position earlier than on a flown leg.
const GROUND_DUTY_CODE_RE = /^[A-Z]{3,8}$/;

/** True when `code`/`afterCode` match the ground-duty row shape (all-letters code immediately followed by an airport, rather than a flight number followed by an equipment code). */
function isGroundDutyRow(code: string, afterCode: string | undefined): boolean {
  return GROUND_DUTY_CODE_RE.test(code) && AIRPORT_RE.test(afterCode ?? "");
}

/**
 * A deadhead is a leg ridden as a passenger, and the pack only ever prints
 * that one way: an interline flight number carrying another carrier's
 * prefix ("DL2939", or "GT9999" for a cab between airports). The column
 * right after BLOCK is MEAL — "BH", "DH", "BH/DH", "BSI", "DSI", "DM",
 * "NOCAT"… — NOT a deadhead flag: across 1,673 real pairings, counting
 * every company leg (including every "DH" one) reconciles with the printed
 * BLOCK HRS footer on 1,671, while dropping the "DH" legs breaks 226 of
 * them; and 74% of "DH" legs depart between 15:00 and 23:59 local versus
 * 0% of "BH" legs. "DH" is dinner, hot.
 */
function isDeadheadLeg(flightNumber: string, groundDuty: boolean): boolean {
  return !groundDuty && !/^\d+$/.test(flightNumber);
}

/**
 * The layover is the row's last column: a city then its printed length,
 * directly after the DUTY time ("… 08:52 KIX 23:29"). Anchoring to that
 * exact position — rather than scanning backwards for any three letters
 * followed by a time — matters because a 3-letter meal code on a trip's
 * final leg ("05:55 DSI 05:55 05:55 07:25") otherwise reads as a 5.9-hour
 * "layover in DSI".
 */
function findLayover(rest: string[]): { city: string; hours: number } | null {
  const n = rest.length;
  if (n < 3) return null;
  const [beforeCity, city, hours] = [rest[n - 3], rest[n - 2], rest[n - 1]];
  if (!AIRPORT_RE.test(city) || !HHMM_RE.test(hours) || !HHMM_RE.test(beforeCity)) return null;
  return { city, hours: timeToHours(hours) };
}

function tryParseLeg(row: string): LegInfo | null {
  const tokens = row.split(" ").filter(Boolean);
  if (tokens.length < 6) return null;

  const dayMatch = tokens[0].match(DAY_TOKEN_RE);
  if (!dayMatch) return null;

  const flightNumber = tokens[1];
  const groundDuty = isGroundDutyRow(flightNumber, tokens[2]);
  if (!groundDuty) {
    if (!/^[A-Z]{0,3}\d+$/.test(flightNumber)) return null;
    if (!EQUIPMENT_RE.test(tokens[2])) return null;
  }
  // Ground duty has no EQP token to skip past, so its fields start one
  // position earlier than a flown leg's.
  const base = groundDuty ? 2 : 3;

  const depAirport = tokens[base];
  if (!AIRPORT_RE.test(depAirport)) return null;
  if (!TIME_PAIR_RE.test(tokens[base + 1])) return null;
  const arrAirport = tokens[base + 2];
  if (!AIRPORT_RE.test(arrAirport)) return null;
  if (!TIME_PAIR_RE.test(tokens[base + 3])) return null;
  if (tokens.length > base + 4 && !HHMM_RE.test(tokens[base + 4])) return null;

  const rest = tokens.slice(base + 5);
  const isDeadhead = isDeadheadLeg(flightNumber, groundDuty);
  const layoverCity = findLayover(rest)?.city;

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
  if (tokens.length < 6) return null;

  const dayMatch = tokens[0].match(DAY_TOKEN_RE);
  if (!dayMatch) return null;

  const flightNumber = tokens[1];
  const groundDuty = isGroundDutyRow(flightNumber, tokens[2]);
  if (!groundDuty) {
    if (!/^[A-Z]{0,3}\d+$/.test(flightNumber)) return null;
    if (!EQUIPMENT_RE.test(tokens[2])) return null;
  }
  const base = groundDuty ? 2 : 3;

  const depAirport = tokens[base];
  if (!AIRPORT_RE.test(depAirport)) return null;
  const depPair = parseTimePair(tokens[base + 1]);
  if (!depPair) return null;
  const arrAirport = tokens[base + 2];
  if (!AIRPORT_RE.test(arrAirport)) return null;
  const arrPair = parseTimePair(tokens[base + 3]);
  if (!arrPair) return null;
  if (tokens.length > base + 4 && !HHMM_RE.test(tokens[base + 4])) return null;

  // Ground duty's own "block"-column value is really its duty/standby
  // length, not flying time — the pack's footer BLOCK HRS already
  // reflects the real (zero) total, so this is left null rather than
  // mislabeling standby hours as block.
  const blockHours = groundDuty ? null : tokens.length > base + 4 ? timeToHours(tokens[base + 4]) : null;
  const rest = tokens.slice(base + 5);
  const isDeadhead = isDeadheadLeg(flightNumber, groundDuty);
  const layover = findLayover(rest);

  return {
    flightNumber,
    // No EQP column at all for ground duty — honestly empty rather than
    // borrowing the airport code that now sits in that token position.
    equipment: groundDuty ? "" : tokens[2],
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

const PAGE_TITLE_RE = /BID PACK PAIRING SCHEDULE/i;

/**
 * Parses consecutive pairing-schedule pages as one continuous stream. A
 * pairing that starts at the bottom of one page finishes at the top of the
 * next (real packs split them mid-pairing — seen on B777 MEM, where each such
 * pairing used to be dropped as "couldn't find its summary line", taking
 * every line that flew it down to a totals-only estimate). The unfinished
 * trailing block of a page is held back, joined with the next page's leading
 * rows (its own page title excluded), and parsed as the single pairing it is.
 */
/**
 * Moves each layover's end — and the next duty's start — to the hotel
 * pickup the pack actually prints. The printed layover length isn't
 * measured from block-in to pickup (checked across every pack: block-in plus
 * the printed length lands anywhere from 75 minutes before to 15 after the
 * printed pickup), so without this the next duty would appear to start at
 * the wrong time. The pickup is placed before the next leg's own departure,
 * which is already fixed on the real clock; anything implausible (after
 * the departure, more than 6 hours before it, or before the layover even
 * starts) is ignored and the printed length stands.
 */
function anchorPickups(schedule: ScheduledDutyPeriod[]): void {
  for (let i = 0; i < schedule.length - 1; i++) {
    const layover = schedule[i].layover;
    const nextLeg = schedule[i + 1].legs[0];
    if (!layover?.pickupTimeGmt || !nextLeg) continue;
    const lead = (((hhmmToMinutes(nextLeg.depTimeGmt) - hhmmToMinutes(layover.pickupTimeGmt)) % 1440) + 1440) % 1440;
    const pickup = nextLeg.startMinutes - lead;
    // A pickup at the departure time itself is real: the next "leg" is a ground ride (GT9999 CAB) and the pickup is that ride.
    if (lead > 6 * 60 || pickup <= layover.startMinutes) continue;
    layover.endMinutes = pickup;
    schedule[i + 1].startMinutes = pickup;
  }
}

export function parsePairingPages(
  pages: { rows: string[]; pageNumber: number }[],
  warnings: ParseWarning[]
): ParsedPairing[] {
  const pairings: ParsedPairing[] = [];
  let carry: { rows: string[]; pageNumber: number } | null = null;

  pages.forEach(({ rows, pageNumber }, index) => {
    let body = rows.filter(isNonEmptyRow);

    if (carry) {
      const firstHeader = body.findIndex((r) => HEADER_RE.test(r));
      const splitAt = firstHeader === -1 ? body.length : firstHeader;
      const continuation = body.slice(0, splitAt).filter((r) => !PAGE_TITLE_RE.test(r));
      pairings.push(...parsePairingColumn([...carry.rows, ...continuation], carry.pageNumber, warnings));
      body = body.slice(splitAt);
      carry = null;
    }

    if (index < pages.length - 1) {
      let lastHeader = -1;
      for (let i = body.length - 1; i >= 0; i--) {
        if (HEADER_RE.test(body[i])) {
          lastHeader = i;
          break;
        }
      }
      if (lastHeader !== -1 && !body.slice(lastHeader).some((r) => FOOTER_RE.test(r))) {
        carry = { rows: body.slice(lastHeader), pageNumber };
        body = body.slice(0, lastHeader);
      }
    }

    pairings.push(...parsePairingColumn(body, pageNumber, warnings));
  });

  return pairings;
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
    // A hotel line belongs to the layover only when it's in the layover's
    // own city and no leg has flown since: a pairing can stop mid-duty at a
    // day-room hotel (MIA → GUA, a few hours at a GUA hotel, GUA → SAP → MIA),
    // and that hotel must never overwrite the overnight one.
    const legs: LegInfo[] = [];
    const layoverDetails: LayoverDetail[] = [];
    let legsSinceLayover = 0;
    for (const row of contentRows) {
      const leg = tryParseLeg(row);
      if (leg) {
        legs.push(leg);
        legsSinceLayover++;
        if (leg.layoverCity) {
          layoverDetails.push({ city: leg.layoverCity, hotelName: null });
          legsSinceLayover = 0;
        }
        continue;
      }
      const hotel = extractHotel(row);
      const last = layoverDetails[layoverDetails.length - 1];
      if (hotel && last && legsSinceLayover === 0 && hotel.city === last.city) last.hotelName = hotel.name;
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
    const standbyDays = legs.filter((l) => isStandbyDutyCode(l.flightNumber)).length;
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
      let awaitingPickup: NonNullable<ScheduledDutyPeriod["layover"]> | null = null;

      for (const row of contentRows) {
        const richLeg = tryParseRichLeg(row);
        if (richLeg) {
          awaitingPickup = null;
          const startMinutes = clock.advance(richLeg.depGmt);
          const endMinutes = clock.advance(richLeg.arrGmt);
          currentLegs.push({
            flightNumber: richLeg.flightNumber,
            equipment: richLeg.equipment,
            isDeadhead: richLeg.isDeadhead,
            isStandby: isStandbyDutyCode(richLeg.flightNumber),
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

        // Same rule as the summary pass above: the overnight layover takes a
        // hotel/ride line only in its own city with nothing flown since;
        // a hotel at a stop partway through a duty is that stop's day room.
        const lastDuty = schedule[schedule.length - 1];
        const layover = currentLegs.length === 0 ? lastDuty?.layover : null;
        const hotel = extractHotel(row);
        if (hotel) {
          if (layover && hotel.city === layover.city) layover.hotelName = hotel.name;
          else {
            const stop = currentLegs[currentLegs.length - 1];
            if (stop && stop.arrAirport === hotel.city) stop.dayRoomHotel = hotel.name;
          }
        }

        const transport = extractTransport(row);
        if (transport && layover && transport.city === layover.city) {
          if (transport.direction === "To") layover.transportToHotel = transport.company;
          else {
            layover.transportFromHotel = transport.company;
            awaitingPickup = layover;
          }
        }
        // The pickup time itself, wherever the "Trans From:" line put it.
        if (awaitingPickup && !HOTEL_RE.test(row) && !(transport && transport.direction === "To")) {
          const pickup = row.match(PICKUP_RE);
          if (pickup) {
            awaitingPickup.pickupTimeGmt = pickup[1];
            awaitingPickup.pickupTimeLocal = pickup[2];
            awaitingPickup = null;
          }
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

      anchorPickups(schedule);
    }

    // Self-verifying, matching the house style: only trust the rich
    // schedule when its own total block hours agrees with the pairing's
    // printed BLOCK HRS footer — a mismatch means the row-shape assumptions
    // above didn't hold for this pairing, and it's safer to fall back to no
    // detailed schedule than to show a pilot a plausible-looking but wrong
    // one. The footer's BLOCK HRS counts every company-metal (bare-digit
    // flight number) leg and excludes interline deadheads (see
    // `isDeadheadLeg` for why a "DH" in the meal column is not one).
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
    // flight ridden as a passenger. Counting bare-digit legs is the same
    // rule that reconciles the printed BLOCK HRS footer on 1,671 of 1,673
    // real pairings, so it replaces LDGS entirely rather than only filling
    // in when the printed value is 0.
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
      standbyDays,
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
