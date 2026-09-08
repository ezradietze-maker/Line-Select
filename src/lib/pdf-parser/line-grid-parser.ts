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
/** Above this many candidate pairings, a combination search stops being
 * worth the (still small) cost — a pool this size usually means the
 * candidate numbers were mostly noise, and a coincidental sum match becomes
 * more likely precisely when it's least trustworthy. This is a sanity cap,
 * not a real performance constraint. */
const MAX_POOL_FOR_SEARCH = 200;
/** The busiest real lines (high duty-period counts, lots of short
 * flight-number-only trips stitched together) can combine well past three
 * separate pairings in a month — this is generous enough to cover them
 * without letting the search run away on a noisy pool. */
const MAX_COMBINATION_SIZE = 10;

function timeToHours(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
}

/** Groups a line-grid page's rows into per-LINE blocks, delimited by the horizontal rule rows. */
export function splitIntoLineBlocks(rows: string[]): string[][] {
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
 * `sequenceMatches` (found via a pairing's own near-unique sequence number)
 * and `flightPool` (the noisier remainder, found only via a shared flight
 * number many unrelated pairings can carry) are both folded into one pool
 * and searched together — see `searchSubsets` below — rather than trusting
 * every sequence match as a mandatory fixed base. A sequence number can
 * still occasionally collide with an unrelated stray digit run elsewhere in
 * a dense calendar block, so forcing it into the sum unconditionally would
 * make an otherwise-solvable line impossible to match; letting the search
 * choose which candidates actually belong is what the self-verification
 * against CR/TAFB/BLK/LANDINGS is really for. A combined pool above
 * MAX_POOL_FOR_SEARCH skips the search entirely: a pool that size usually
 * means the candidate numbers were mostly noise, and a coincidental sum
 * match becomes more likely precisely when it's least trustworthy.
 */
interface Candidate {
  pairing: ParsedPairing;
  /** How many times this pairing's credit/block/landings count if chosen — >1 for a sequence-number match repeated across several weeks. */
  weight: number;
}

/**
 * Depth-first search over subsets of `pool`, smallest first, for one whose
 * combined credit/block/landings hits the target. All three fields only
 * accumulate upward as candidates are added, so once a running total
 * overshoots the target past tolerance, no further addition can bring it
 * back — that prunes the large majority of branches in practice, keeping
 * this fast even though it's exponential in the worst case.
 */
function searchSubsets(
  pool: Candidate[],
  maxSize: number,
  targetCredit: number,
  targetBlock: number,
  targetLandings: number
): Candidate[] | null {
  function isMatch(credit: number, block: number, landings: number): boolean {
    return (
      Math.abs(credit - targetCredit) < TOLERANCE_HOURS &&
      Math.abs(block - targetBlock) < TOLERANCE_HOURS &&
      landings === targetLandings
    );
  }

  function search(
    startIndex: number,
    chosen: Candidate[],
    accCredit: number,
    accBlock: number,
    accLandings: number
  ): Candidate[] | null {
    if (chosen.length > 0 && isMatch(accCredit, accBlock, accLandings)) return chosen;
    if (chosen.length >= maxSize) return null;

    for (let i = startIndex; i < pool.length; i++) {
      const c = pool[i];
      const nextCredit = accCredit + c.pairing.creditHours * c.weight;
      const nextBlock = accBlock + c.pairing.blockHours * c.weight;
      const nextLandings = accLandings + c.pairing.landings * c.weight;
      if (nextCredit > targetCredit + TOLERANCE_HOURS) continue;
      if (nextBlock > targetBlock + TOLERANCE_HOURS) continue;
      if (nextLandings > targetLandings) continue;

      const result = search(i + 1, [...chosen, c], nextCredit, nextBlock, nextLandings);
      if (result) return result;
    }
    return null;
  }

  return search(0, [], 0, 0, 0);
}

function findMatchingPairings(
  sequenceMatches: SequenceMatch[],
  flightMatches: SequenceMatch[],
  targetCredit: number,
  targetBlock: number,
  targetLandings: number
): ParsedPairing[] | null {
  const pool: Candidate[] = [
    ...sequenceMatches.map((m) => ({ pairing: m.pairing, weight: m.count })),
    ...flightMatches.map((m) => ({ pairing: m.pairing, weight: m.count })),
  ];

  if (pool.length > MAX_POOL_FOR_SEARCH) return null;

  const chosen = searchSubsets(pool, MAX_COMBINATION_SIZE, targetCredit, targetBlock, targetLandings);
  if (!chosen) return null;
  return chosen.flatMap((c) => Array(c.weight).fill(c.pairing) as ParsedPairing[]);
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
    // Exclusion is by character position, not by value: a C/O ("carry over")
    // time can appear more than once per block, and blacklisting its digits
    // by value would also wipe out a genuine, unrelated candidate elsewhere
    // in the block that happens to read the same number.
    //
    // A line whose trip spans the bid period's edge has part of that trip's
    // hours carried into (or out of) the adjacent period — printed CR./BLK.
    // are net of that carry, but the pairing schedule lists the trip's full
    // gross hours, so matching against the schedule needs those hours added
    // back. Always exactly two C/O readings print per line (both 0:00 when
    // nothing carries): the first sits by NO. DP'S (credit carried), the
    // second by DAYS OFF (block carried) — verified against a real
    // carry-over line, where CR.+C/O. and BLK.+C/O. landed on the exact
    // combined credit/block of the pairings it should have matched.
    const coMatches = Array.from(text.matchAll(CO_RE));
    const creditCarryOver = coMatches[0] ? Number(coMatches[0][1]) + Number(coMatches[0][2]) / 60 : 0;
    const blockCarryOver = coMatches[1] ? Number(coMatches[1][1]) + Number(coMatches[1][2]) / 60 : 0;

    const excludedRanges: [number, number][] = [];
    for (const m of [lineMatch, crMatch, tafbMatch, blkMatch, landingsMatch, daysOffMatch, dutyPeriodsMatch]) {
      if (m?.index !== undefined) excludedRanges.push([m.index, m.index + m[0].length]);
    }
    for (const m of coMatches) {
      excludedRanges.push([m.index!, m.index! + m[0].length]);
    }
    // "DAYS OFF NN" is always the last labeled field in a line's block —
    // confirmed against real data that a bare, un-piped run of numbers
    // sometimes trails it (e.g. "DAYS OFF 13 | 640 931 624 1531 640 1531
    // 640 1531"). None of those numbers correspond to any real pairing
    // sequence or flight number anywhere in the schedule; they were being
    // swept up as candidates purely because the extraction regex accepts a
    // bare space as a terminator, which both wastes search budget and can
    // inflate a real candidate's occurrence-based weight when a genuine
    // sequence/flight number happens to coincide with one of these values.
    if (daysOffMatch?.index !== undefined) {
      excludedRanges.push([daysOffMatch.index + daysOffMatch[0].length, text.length]);
    }

    const candidateMatches = Array.from(text.matchAll(/\b(\d{1,4})(?=[:|]|\s|$)/g)).filter(
      (m) => !excludedRanges.some(([start, end]) => m.index! >= start && m.index! < end)
    );
    const occurrenceCounts = new Map<string, number>();
    for (const m of candidateMatches) {
      occurrenceCounts.set(m[1], (occurrenceCounts.get(m[1]) ?? 0) + 1);
    }
    const candidates = Array.from(occurrenceCounts.keys());

    // Sequence-number matches are near-unique (each pairing has its own) —
    // stronger candidates than flight-number matches, but still only
    // candidates, weighted by how many times that number occurs; see
    // `findMatchingPairings` for why they're no longer trusted
    // unconditionally. Flight-number matches are noisier — the same flight
    // number shows up across many unrelated pairings — so anything already
    // found via its sequence number is excluded here to avoid double-
    // counting it.
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

    // Keyed by pairing id, weighted by the *candidate's own* occurrence
    // count (mirroring sequenceMatches' `count`) rather than a flat 1 —
    // a trip repeated across several weeks in the same line often only
    // shows up in the grid via its deadhead flight number (no bare
    // sequence-number cell for the repeat weeks at all), so a flat weight
    // of 1 under-counts its real credit/block/landings contribution and
    // makes an otherwise-solvable line impossible to match. `Math.max`
    // guards against double-counting when more than one flight number in
    // the same candidate set happens to belong to this same pairing.
    const flightPool = new Map<string, SequenceMatch>();
    for (const c of candidates) {
      const count = occurrenceCounts.get(c)!;
      // pairingsByFlightNumber's own keys are leading-zero-stripped (see
      // normalizeFlightNumberDigits) since the pairing schedule and the
      // line grid don't always pad a flight number the same way (e.g. a
      // grid cell's "0762" for the schedule's own "762") — the lookup key
      // needs the same normalization or it silently misses a real match.
      for (const p of pairingsByFlightNumber.get(normalizeFlightNumberDigits(c)) ?? []) {
        if (sequenceMatchedIds.has(p.id)) continue;
        const existing = flightPool.get(p.id);
        flightPool.set(p.id, { pairing: p, count: Math.max(existing?.count ?? 0, count) });
      }
    }

    // The pairing schedule's totals are gross (including any carried-over
    // portion), so the matching target adds the carry-over back on top of
    // the line's own net printed totals — see the C/O comment above. The
    // line's own summary keeps the net, printed totalCreditHours/
    // totalBlockHours values; only the matching target is adjusted.
    const pairings = findMatchingPairings(
      sequenceMatches,
      Array.from(flightPool.values()),
      totalCreditHours + creditCarryOver,
      totalBlockHours + blockCarryOver,
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
