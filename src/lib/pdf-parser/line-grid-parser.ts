import type { ParsedLineSummary, ParsedPairing, ParseWarning } from "@/lib/pdf-parser/types";

const LINE_RE = /LINE\s+(\d+)/;
const CR_RE = /CR\.\s+(\d{1,3}:\d{2})/;
const TAFB_RE = /TAFB\s+(\d{1,4}:\d{2})/;
const BLK_RE = /BLK\.\s+(\d{1,3}:\d{2})/;
const LANDINGS_RE = /LANDINGS\s+(\d+)/;
const DAYS_OFF_RE = /DAYS\s+OFF\s+(\d+)/;
const CO_RE = /C\/O\.\s+(\d{1,3}):(\d{2})/g;
const DUTY_PERIODS_RE = /NO\.\s+DP.?S\s+(\d+)/i;
const SEPARATOR_RE = /^_{5,}$/;
const TOLERANCE_HOURS = 0.1;
/** Above this many candidate pairings, a 3-way combination search stops
 * being worth the (still small) cost — a pool this size usually means the
 * candidate numbers were mostly noise, and a coincidental 3-way sum match
 * becomes more likely precisely when it's least trustworthy. A triple
 * search over even a few hundred candidates is well under a second, so
 * this is a sanity cap, not a real performance constraint. */
const MAX_POOL_FOR_TRIPLES = 200;

function timeToHours(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
}

/** Groups a line-grid page's rows into per-LINE blocks, delimited by the horizontal rule rows. */
function splitIntoLineBlocks(rows: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const row of rows) {
    if (SEPARATOR_RE.test(row.trim())) {
      if (current.some((r) => LINE_RE.test(r))) blocks.push(current);
      current = [];
      continue;
    }
    current.push(row);
  }
  if (current.some((r) => LINE_RE.test(r))) blocks.push(current);
  return blocks;
}

/** A pairing referenced by its own sequence number, plus how many separate
 * times that sequence number appears in the line's calendar — a short trip
 * flown several times in the same month (e.g. the same LAX turn done three
 * separate weeks) is a real, common pattern, and each occurrence's full
 * credit/block/landings counts on its own, not once for the whole month. */
interface SequenceMatch {
  pairing: ParsedPairing;
  count: number;
}

/**
 * Every candidate value is checked against the line's own declared totals
 * before being trusted, rather than relying on a fixed text/column
 * position for the pairing reference — the grid's layout is dense and
 * varies with how many days a pairing spans, but a real pairing match
 * always agrees with the line's stated CR/TAFB/BLK/LANDINGS to within
 * rounding, so this self-verifies instead of guessing blindly.
 *
 * `sequenceMatches` are pairings found via their own sequence number — a
 * near-unique identifier, so all of them are trusted as a fixed base sum
 * (weighted by how many times each occurs) rather than searched over.
 * `flightPool` is the noisier remainder: pairings found only via a shared
 * flight number, which many unrelated pairings can carry, so those are
 * still searched in small combinations to close any gap the base sum
 * leaves. A flight pool above MAX_POOL_FOR_TRIPLES skips the 3-way search:
 * a pool that size usually means the candidate numbers were mostly noise,
 * and a coincidental 3-way sum match becomes more likely precisely when
 * it's least trustworthy.
 */
function findMatchingPairings(
  sequenceMatches: SequenceMatch[],
  flightPool: ParsedPairing[],
  targetCredit: number,
  targetBlock: number,
  targetLandings: number
): ParsedPairing[] | null {
  function isConfidentMatch(credit: number, block: number, landings: number): boolean {
    return (
      Math.abs(credit - targetCredit) < TOLERANCE_HOURS &&
      Math.abs(block - targetBlock) < TOLERANCE_HOURS &&
      landings === targetLandings
    );
  }

  const baseTrips = sequenceMatches.flatMap((m) => Array(m.count).fill(m.pairing) as ParsedPairing[]);
  const baseCredit = baseTrips.reduce((sum, p) => sum + p.creditHours, 0);
  const baseBlock = baseTrips.reduce((sum, p) => sum + p.blockHours, 0);
  const baseLandings = baseTrips.reduce((sum, p) => sum + p.landings, 0);

  if (isConfidentMatch(baseCredit, baseBlock, baseLandings)) {
    return baseTrips;
  }

  for (const p of flightPool) {
    if (isConfidentMatch(baseCredit + p.creditHours, baseBlock + p.blockHours, baseLandings + p.landings)) {
      return [...baseTrips, p];
    }
  }

  for (let i = 0; i < flightPool.length; i++) {
    for (let j = i + 1; j < flightPool.length; j++) {
      const a = flightPool[i];
      const b = flightPool[j];
      if (
        isConfidentMatch(
          baseCredit + a.creditHours + b.creditHours,
          baseBlock + a.blockHours + b.blockHours,
          baseLandings + a.landings + b.landings
        )
      ) {
        return [...baseTrips, a, b];
      }
    }
  }

  // A line flying three or more separate flight-number-only pairings in the
  // month can never match as a single pairing or a pair, so without this
  // the parser would give up on it every time.
  if (flightPool.length <= MAX_POOL_FOR_TRIPLES) {
    for (let i = 0; i < flightPool.length; i++) {
      for (let j = i + 1; j < flightPool.length; j++) {
        for (let k = j + 1; k < flightPool.length; k++) {
          const a = flightPool[i];
          const b = flightPool[j];
          const c = flightPool[k];
          if (
            isConfidentMatch(
              baseCredit + a.creditHours + b.creditHours + c.creditHours,
              baseBlock + a.blockHours + b.blockHours + c.blockHours,
              baseLandings + a.landings + b.landings + c.landings
            )
          ) {
            return [...baseTrips, a, b, c];
          }
        }
      }
    }
  }

  return null;
}

export function parseLineGridColumn(
  rows: string[],
  pageNumber: number,
  seat: "CAP" | "FO",
  pairingsBySeq: Map<string, ParsedPairing[]>,
  pairingsByFlightNumber: Map<string, ParsedPairing[]>,
  warnings: ParseWarning[]
): { summary: ParsedLineSummary; pairings: ParsedPairing[] | null }[] {
  const blocks = splitIntoLineBlocks(rows);
  const results: { summary: ParsedLineSummary; pairings: ParsedPairing[] | null }[] = [];

  for (const block of blocks) {
    const text = block.join(" ");
    const lineMatch = text.match(LINE_RE);
    const crMatch = text.match(CR_RE);
    const tafbMatch = text.match(TAFB_RE);
    const blkMatch = text.match(BLK_RE);
    const landingsMatch = text.match(LANDINGS_RE);
    const daysOffMatch = text.match(DAYS_OFF_RE);

    if (!lineMatch || !crMatch || !tafbMatch || !blkMatch || !landingsMatch || !daysOffMatch) {
      warnings.push({
        pageNumber,
        message: "Skipped a line block missing one of its required summary fields (CR/TAFB/BLK/LANDINGS/DAYS OFF).",
        context: text.slice(0, 100),
      });
      continue;
    }

    const totalCreditHours = timeToHours(crMatch[1]);
    const totalTafbHours = timeToHours(tafbMatch[1]);
    const totalBlockHours = timeToHours(blkMatch[1]);
    const totalLandings = parseInt(landingsMatch[1], 10);
    const daysOff = parseInt(daysOffMatch[1], 10);
    const lineNumber = lineMatch[1];
    const dutyPeriodsMatch = text.match(DUTY_PERIODS_RE);

    // Candidate reference numbers: a standalone digit run sitting in a
    // calendar cell, followed by whichever column separator that cell uses
    // (":" for weekdays, "|" for weekends — same convention the grid's own
    // day-of-week header row uses), excluding fields already parsed above.
    // These can be either a pairing's own sequence number (its report-time
    // header, e.g. "19") or a deadhead leg's flight number (e.g. "9156") —
    // both get looked up below, since the grid uses both conventions.
    //
    // Exclusion is by character position, not by value: a C/O time like
    // "6:19" can appear more than once per block (checkouts reset per work
    // stretch), and blacklisting its digits by value would also wipe out a
    // genuine, unrelated candidate elsewhere in the block that happens to
    // read "19" — which is exactly what was happening here.
    const excludedRanges: [number, number][] = [];
    for (const m of [lineMatch, crMatch, tafbMatch, blkMatch, landingsMatch, daysOffMatch, dutyPeriodsMatch]) {
      if (m?.index !== undefined) excludedRanges.push([m.index, m.index + m[0].length]);
    }
    for (const m of text.matchAll(CO_RE)) {
      excludedRanges.push([m.index!, m.index! + m[0].length]);
    }

    const candidateMatches = Array.from(text.matchAll(/\b(\d{1,4})(?=[:|]|\s|$)/g)).filter(
      (m) => !excludedRanges.some(([start, end]) => m.index! >= start && m.index! < end)
    );
    const occurrenceCounts = new Map<string, number>();
    for (const m of candidateMatches) {
      occurrenceCounts.set(m[1], (occurrenceCounts.get(m[1]) ?? 0) + 1);
    }
    const candidates = Array.from(occurrenceCounts.keys());

    // Sequence-number matches are near-unique (each pairing has its own),
    // so they're trusted directly, weighted by how many times that number
    // occurs. Flight-number matches are noisier — the same flight number
    // shows up across many unrelated pairings — so anything already found
    // via its sequence number is excluded here to avoid double-counting it.
    //
    // A handful of sequence numbers are reused across the pairing schedule
    // for what's operationally the same short trip pattern run in different
    // weeks (same credit/block/landings, different effective dates) — only
    // one representative is taken per number here, since counting every
    // reused entry would multiply that trip's contribution by how many
    // differently-dated copies happen to share its number, not by how many
    // times this line actually flies it.
    const sequenceMatches: { pairing: ParsedPairing; count: number }[] = [];
    const sequenceMatchedIds = new Set<string>();
    for (const c of candidates) {
      const count = occurrenceCounts.get(c)!;
      const p = pairingsBySeq.get(c)?.[0];
      if (p) {
        sequenceMatches.push({ pairing: p, count });
        sequenceMatchedIds.add(p.id);
      }
    }

    const flightPool = new Map<string, ParsedPairing>();
    for (const c of candidates) {
      for (const p of pairingsByFlightNumber.get(c) ?? []) {
        if (!sequenceMatchedIds.has(p.id)) flightPool.set(p.id, p);
      }
    }

    const pairings = findMatchingPairings(
      sequenceMatches,
      Array.from(flightPool.values()),
      totalCreditHours,
      totalBlockHours,
      totalLandings
    );

    if (!pairings) {
      warnings.push({
        pageNumber,
        message: `Line ${lineNumber}: couldn't confidently match its calendar entries to a specific pairing — using its totals only, without a trip-by-trip breakdown.`,
      });
    }

    results.push({
      summary: {
        lineNumber,
        pageNumber,
        seat,
        daysOff,
        totalCreditHours,
        totalTafbHours,
        totalLandings,
        numDutyPeriods: pairings?.length ?? 0,
        flightNumberSequence: pairings?.flatMap((p) => p.flightNumbers) ?? [],
      },
      pairings,
    });
  }

  return results;
}

export function indexPairingsBySequence(
  pairings: ParsedPairing[]
): Map<string, ParsedPairing[]> {
  const map = new Map<string, ParsedPairing[]>();
  for (const p of pairings) {
    const list = map.get(p.sequenceNumber) ?? [];
    list.push(p);
    map.set(p.sequenceNumber, list);
  }
  return map;
}

/** Strips airline-code letters and leading zeros, e.g. "UA0869" -> "869", so it can be matched against a bare digit run pulled out of a grid cell. */
function normalizeFlightNumberDigits(flightNumber: string): string {
  return flightNumber.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
}

/**
 * Indexes pairings by every flight number they contain (not just the
 * first), since a line's calendar cells often print a deadhead leg's own
 * flight number rather than the pairing's report-time-header sequence
 * number — that flight number can belong to several different pairings
 * (a common repositioning flight gets reused), so this is a lookup of
 * candidates to verify against totals, not a direct identification.
 */
export function indexPairingsByFlightNumber(
  pairings: ParsedPairing[]
): Map<string, ParsedPairing[]> {
  const map = new Map<string, ParsedPairing[]>();
  for (const p of pairings) {
    for (const flightNumber of p.flightNumbers) {
      const key = normalizeFlightNumberDigits(flightNumber);
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
  }
  return map;
}
