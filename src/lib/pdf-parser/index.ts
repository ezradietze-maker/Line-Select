import { buildLine } from "@/lib/pdf-parser/build-bidpack";
import { parseBidCalendarPage } from "@/lib/pdf-parser/bid-calendar-parser";
import { parseInfoPage } from "@/lib/pdf-parser/info-page-parser";
import { extractLineOffDays, extractLinePlacements, type DayPlacement } from "@/lib/pdf-parser/line-grid-days";
import {
  indexPairingsByFlightNumber,
  indexPairingsBySequence,
  parseLineGridColumn,
} from "@/lib/pdf-parser/line-grid-parser";
import { extractMetaFromLineGridHeader, extractMetaFromPairingHeader } from "@/lib/pdf-parser/meta";
import { parsePairingPages } from "@/lib/pdf-parser/pairing-parser";
import { classifyPage } from "@/lib/pdf-parser/page-classifier";
import { extractReserveLineSeat, parseReserveLineDays, parseReserveLineGridRows } from "@/lib/pdf-parser/reserve-line-parser";
import { extractSeniorityListSeat, parseSeniorityListRows, validateSeniorityList } from "@/lib/pdf-parser/seniority-list-parser";
import { extractVacationScheduleSeat, parseSweepFlightRows, parseVacationScheduleRows } from "@/lib/pdf-parser/vacation-schedule-parser";
import {
  extractPage,
  extractTwoColumnRows,
  groupIntoRows,
  loadPdf,
  looksGarbled,
  type ExtractedPage,
} from "@/lib/pdf-parser/text-extraction";
import type {
  BidPackMeta,
  PageClassification,
  ParsedLineSummary,
  ParseBidPackResult,
  ParseProgress,
  ParsedPairing,
  ParseWarning,
} from "@/lib/pdf-parser/types";
import type { BidPack, BidPackInfo, ReserveLine, Seat, SeniorityEntry, SweepFlight, VacationPeriod } from "@/types/bidpack";
import { packIdFor } from "@/lib/pack-id";

import { openTripsOfSeat } from "@/lib/pdf-parser/open-trips";

export { MAX_PDF_BYTES } from "@/lib/pdf-parser/constants";
export type { ParseBidPackResult, ParseProgress } from "@/lib/pdf-parser/types";

export async function parseBidPackPdf(
  data: Uint8Array,
  { onProgress: listener }: { onProgress?: (progress: ParseProgress) => void } = {}
): Promise<ParseBidPackResult> {
  // Text extraction resolves page after page without ever giving the event
  // loop a turn, so a streamed response would hold every progress event
  // until the very end. Reporting progress therefore yields one macrotask
  // after each event — only when someone is listening, so a plain parse
  // runs exactly as before.
  const onProgress = listener
    ? async (progress: ParseProgress) => {
        listener(progress);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    : undefined;

  const errors: ParseWarning[] = [];
  const warnings: ParseWarning[] = [];

  let doc;
  try {
    doc = await loadPdf(data);
  } catch (e) {
    errors.push({
      pageNumber: 0,
      message:
        "This file couldn't be read as a PDF. Make sure it's the exported bid pack PDF, not a renamed or corrupted file.",
      context: e instanceof Error ? e.message : String(e),
    });
    return emptyResult(errors, warnings);
  }

  if (doc.numPages === 0) {
    errors.push({ pageNumber: 0, message: "This PDF has no pages." });
    return emptyResult(errors, warnings);
  }

  const pages: ExtractedPage[] = [];
  const allRowsForGarbleCheck: string[] = [];
  const pageClassifications: PageClassification[] = [];

  for (let p = 1; p <= doc.numPages; p++) {
    let page: ExtractedPage;
    try {
      page = await extractPage(doc, p);
    } catch (e) {
      warnings.push({
        pageNumber: p,
        message: "Couldn't extract text from this page — it was skipped.",
        context: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    pages.push(page);
    const rows = groupIntoRows(page.items);
    allRowsForGarbleCheck.push(...rows.slice(0, 10));
    pageClassifications.push(classifyPage(p, rows));
    await onProgress?.({ stage: "pages", done: p, total: doc.numPages });
  }

  const looksLikeScannedPdf = looksGarbled(allRowsForGarbleCheck);
  if (looksLikeScannedPdf) {
    errors.push({
      pageNumber: 0,
      message:
        "This PDF doesn't seem to contain extractable text — it may be a scanned image rather than the original exported file. Try re-exporting or re-downloading the bid pack PDF.",
    });
    return emptyResult(errors, warnings, pageClassifications);
  }

  // Pass 1: parse every pairing-schedule page, regardless of where it falls
  // in the document, into one pool keyed by sequence number.
  const allPairings: ParsedPairing[] = [];
  let pairingMeta: Partial<BidPackMeta> | null = null;

  const pairingPages: { rows: string[]; pageNumber: number }[] = [];
  for (let i = 0; i < pages.length; i++) {
    if (pageClassifications[i].kind !== "pairing-schedule") continue;
    const page = pages[i];
    const headerText = groupIntoRows(page.items).slice(0, 2).join(" | ");
    if (!pairingMeta) pairingMeta = extractMetaFromPairingHeader(headerText);

    const { left, right } = extractTwoColumnRows(page);
    pairingPages.push({ rows: [...left, ...right], pageNumber: page.pageNumber });
  }
  allPairings.push(...parsePairingPages(pairingPages, warnings));
  await onProgress?.({ stage: "pairings", pairings: allPairings.length });

  if (allPairings.length === 0) {
    errors.push({
      pageNumber: 0,
      message:
        "No pairing schedule pages were recognized in this PDF. Check that this is a full bid pack export, not an excerpt.",
    });
    return emptyResult(errors, warnings, pageClassifications);
  }

  const pairingsBySeq = indexPairingsBySequence(allPairings);
  const pairingsByFlightNumber = indexPairingsByFlightNumber(allPairings);

  // Pass 2: parse every line-grid page using the completed pairing pool.
  const lineResults: {
    summary: ParsedLineSummary;
    pairings: ParsedPairing[] | null;
  }[] = [];
  let lineGridMeta: Partial<BidPackMeta> | null = null;
  const placementsBySeat: Partial<Record<Seat, Map<string, DayPlacement[]>>> = {};
  const offDaysBySeat: Partial<Record<Seat, Map<string, { offDays: number[]; dayCount: number }>>> = {};

  for (let i = 0; i < pages.length; i++) {
    if (pageClassifications[i].kind !== "line-grid") continue;
    const page = pages[i];
    const rows = groupIntoRows(page.items);
    const headerText = rows.slice(0, 4).join(" | ");
    const pageMeta = extractMetaFromLineGridHeader(headerText);
    if (pageMeta && !lineGridMeta) lineGridMeta = pageMeta;
    const seat = pageMeta?.seat ?? "CAP";

    lineResults.push(
      ...parseLineGridColumn(rows, page.pageNumber, seat, pairingsBySeq, pairingsByFlightNumber, warnings)
    );
    await onProgress?.({ stage: "lines", lines: lineResults.length });

    const seatPlacements = placementsBySeat[seat] ?? new Map<string, DayPlacement[]>();
    for (const [lineNumber, entries] of extractLinePlacements(rows)) {
      seatPlacements.set(lineNumber, entries);
    }
    placementsBySeat[seat] = seatPlacements;

    const seatOffDays = offDaysBySeat[seat] ?? new Map<string, { offDays: number[]; dayCount: number }>();
    for (const [lineNumber, grid] of extractLineOffDays(rows)) seatOffDays.set(lineNumber, grid);
    offDaysBySeat[seat] = seatOffDays;
  }

  if (lineResults.length === 0) {
    errors.push({
      pageNumber: 0,
      message:
        "No bid line pages were recognized in this PDF. Check that this is a full bid pack export, not an excerpt.",
    });
    return emptyResult(errors, warnings, pageClassifications);
  }

  const meta: BidPackMeta = {
    month: pairingMeta?.month ?? "UNKNOWN",
    base: pairingMeta?.base ?? lineGridMeta?.base ?? "UNKNOWN",
    aircraft: pairingMeta?.aircraft ?? lineGridMeta?.aircraft ?? "UNKNOWN",
    seat: lineGridMeta?.seat ?? "CAP",
    bidPeriodStart: lineGridMeta?.bidPeriodStart ?? null,
    bidPeriodDays: lineGridMeta?.bidPeriodDays ?? null,
  };

  // Pass 3: reserve line grid + info page — both purely numeric/summary
  // data (line numbers and R/A/B types; pack-wide guarantee and credit
  // stats), never a page that names anyone.
  const reserveLinesBySeat: Partial<Record<Seat, ReserveLine[]>> = {};
  let infoBySeat: Partial<Record<Seat, BidPackInfo>> | null = null;
  const seniorityBySeat: Partial<Record<Seat, SeniorityEntry[]>> = {};
  const vacationsBySeat: Partial<Record<Seat, Map<number, VacationPeriod[]>>> = {};
  const sweepFlights: SweepFlight[] = [];

  for (let i = 0; i < pages.length; i++) {
    const kind = pageClassifications[i].kind;
    if (kind !== "reserve-line-grid" && kind !== "info-page" && kind !== "seniority-list" && kind !== "vacation-schedule" && kind !== "sweep-flights") continue;
    const page = pages[i];
    const rows = groupIntoRows(page.items);

    if (kind === "vacation-schedule") {
      const seat = extractVacationScheduleSeat(rows.slice(0, 6));
      if (!seat) continue;
      const bySeniority = vacationsBySeat[seat] ?? new Map<number, VacationPeriod[]>();
      for (const v of parseVacationScheduleRows(rows)) bySeniority.set(v.seniority, [...(bySeniority.get(v.seniority) ?? []), v.period]);
      vacationsBySeat[seat] = bySeniority;
      continue;
    }

    if (kind === "sweep-flights") {
      for (const f of parseSweepFlightRows(rows)) if (!sweepFlights.some((x) => x.flightNumber === f.flightNumber && x.from === f.from)) sweepFlights.push(f);
      continue;
    }

    if (kind === "seniority-list") {
      const seat = extractSeniorityListSeat(rows.slice(0, 8));
      if (seat) seniorityBySeat[seat] = [...(seniorityBySeat[seat] ?? []), ...parseSeniorityListRows(rows)];
      continue;
    }

    if (kind === "reserve-line-grid") {
      const seat = extractReserveLineSeat(rows.slice(0, 4)) ?? "CAP";
      const onCallDays = parseReserveLineDays(page.items);
      const parsed = parseReserveLineGridRows(rows, page.pageNumber, warnings).map((r) => {
        const days = onCallDays.get(r.lineNumber);
        return days?.length ? { ...r, days } : r;
      });
      if (parsed.length > 0) {
        reserveLinesBySeat[seat] = [...(reserveLinesBySeat[seat] ?? []), ...parsed];
      }
    } else if (!infoBySeat) {
      infoBySeat = parseInfoPage(rows, page.pageNumber, warnings);
    }
  }

  // The cover page's bid calendar says when open time goes out to each seat ("OT Release CAP 1915 LBT F/O 2115 LBT").
  const coverText = pages[0] ? groupIntoRows(pages[0].items).join(" ") : "";
  const otRelease = (seat: Seat) => {
    const m = coverText.match(seat === "CAP" ? /CAP\s+(\d{2})(\d{2})\s+LBT/ : /F\s*\/\s*O\s+(\d{2})(\d{2})\s+LBT/);
    return m ? `${m[1]}:${m[2]}` : null;
  };
  if (infoBySeat) for (const seat of ["CAP", "FO"] as const) if (infoBySeat[seat]) infoBySeat[seat] = { ...infoBySeat[seat]!, openTimeRelease: otRelease(seat) };
  const bidCalendar = pages[0] ? parseBidCalendarPage(pages[0]) : [];

  const linesWithIncompleteTrips: { lineNumber: string; seat: "CAP" | "FO" }[] = [];
  const bidPacksBySeat: Partial<Record<"CAP" | "FO", BidPack>> = {};

  for (const seat of ["CAP", "FO"] as const) {
    const seatResults = lineResults.filter((r) => r.summary.seat === seat);
    if (seatResults.length === 0) continue;

    for (const r of seatResults) {
      if (!r.pairings) linesWithIncompleteTrips.push({ lineNumber: r.summary.lineNumber, seat });
    }

    bidPacksBySeat[seat] = {
      id: packIdFor({ base: meta.base, aircraft: meta.aircraft, seat, month: meta.month }),
      month: meta.month,
      base: meta.base,
      aircraft: meta.aircraft,
      seat,
      // The pack's own printed dates; a four-week bid month when it didn't print them (the line pages always have so far).
      bidPeriodDays: meta.bidPeriodDays ?? 28,
      bidPeriodStart: meta.bidPeriodStart,
      lines: seatResults.map((r) =>
        buildLine(
          r.summary,
          r.pairings,
          meta.month,
          placementsBySeat[seat]?.get(r.summary.lineNumber),
          offDaysBySeat[seat]?.get(r.summary.lineNumber),
          { bidPeriodStart: meta.bidPeriodStart, base: meta.base },
          (n) => pairingsBySeq.get(n) ?? []
        )
      ),
      reserveLines: reserveLinesBySeat[seat],
      info: infoBySeat?.[seat],
      seniorityList: withVacations(validateSeniorityList(seniorityBySeat[seat] ?? [], seat, warnings), vacationsBySeat[seat]),
      ...(bidCalendar.length ? { bidCalendar } : {}),
      ...(sweepFlights.length ? { sweepFlights } : {}),
      openPairings: openTripsOfSeat(allPairings, heldBySeat(placementsBySeat[seat]), seat, meta.month, {
        bidPeriodStart: meta.bidPeriodStart,
        bidPeriodDays: meta.bidPeriodDays ?? 28,
        base: meta.base,
      }),
    };
  }

  return {
    bidPacksBySeat,
    meta,
    pageClassifications,
    pairingsParsed: allPairings.length,
    linesParsed: lineResults.length,
    linesWithIncompleteTrips,
    warnings,
    errors,
    looksLikeScannedPdf: false,
    problems: completenessProblems(bidPacksBySeat, infoBySeat),
  };
}

const SEAT_NAME = { CAP: "Captain", FO: "First Officer" } as const;

/**
 * Checked against the pack's own info page: on every real pack so far its regular and reserve line counts are exactly
 * what's read, so a difference means pages are missing (a file cut short, a page dropped) or two packs were joined.
 */
export function completenessProblems(
  packs: Partial<Record<"CAP" | "FO", BidPack>>,
  info: Partial<Record<"CAP" | "FO", BidPackInfo>> | null
): { seat: "CAP" | "FO" | null; message: string }[] {
  const out: { seat: "CAP" | "FO" | null; message: string }[] = [];
  for (const seat of ["CAP", "FO"] as const) {
    const pack = packs[seat];
    const counted = info?.[seat];
    const name = SEAT_NAME[seat];
    if (!pack) {
      if (counted?.totalRegularLines) out.push({ seat, message: `The pack lists ${counted.totalRegularLines} ${name} lines, but this file has none of them. Upload the whole pack to rank ${name} lines.` });
      continue;
    }
    if (counted?.totalRegularLines && pack.lines.length < counted.totalRegularLines) {
      out.push({ seat, message: `This file has ${pack.lines.length} of the ${counted.totalRegularLines} ${name} lines the pack lists. Pages look to be missing: upload the whole pack.` });
    }
    if (counted?.totalReserveLines && (pack.reserveLines?.length ?? 0) < counted.totalReserveLines) {
      out.push({ seat, message: `This file has ${pack.reserveLines?.length ?? 0} of the ${counted.totalReserveLines} ${name} reserve lines the pack lists.` });
    }
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const l of pack.lines) (seen.has(l.lineNumber) ? twice : seen).add(l.lineNumber);
    if (twice.size) {
      const some = [...twice].slice(0, 3).join(", ");
      out.push({ seat, message: `${name} line${twice.size === 1 ? "" : "s"} ${some}${twice.size > 3 ? ` and ${twice.size - 3} more` : ""} appear${twice.size === 1 ? "s" : ""} twice. The file may hold a page twice, or two packs joined: upload the pack on its own.` });
    }
  }
  return out;
}

/** Where a seat's lines place each pairing number, repeats counted. */
function heldBySeat(placements: Map<string, DayPlacement[]> | undefined): Map<string, number[]> {
  const held = new Map<string, number[]>();
  for (const entries of placements?.values() ?? []) {
    for (const e of entries) held.set(e.pairingNumber, [...(held.get(e.pairingNumber) ?? []), e.startDayIndex]);
  }
  return held;
}

function emptyResult(
  errors: ParseWarning[],
  warnings: ParseWarning[],
  pageClassifications: PageClassification[] = []
): ParseBidPackResult {
  return {
    bidPacksBySeat: {},
    meta: null,
    pageClassifications,
    pairingsParsed: 0,
    linesParsed: 0,
    linesWithIncompleteTrips: [],
    warnings,
    errors,
    looksLikeScannedPdf: false,
  };
}

/** Each pilot's vacation blocks, matched to the seniority list by seniority number (the only key the two pages share that's kept). */
function withVacations(list: SeniorityEntry[] | null, vacations: Map<number, VacationPeriod[]> | undefined): SeniorityEntry[] | undefined {
  if (!list) return undefined;
  if (!vacations?.size) return list;
  return list.map((e) => {
    const v = vacations.get(e.seniority);
    return v ? { ...e, vacations: v } : e;
  });
}
