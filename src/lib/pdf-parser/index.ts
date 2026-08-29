import { buildLine } from "@/lib/pdf-parser/build-bidpack";
import { parseInfoPage } from "@/lib/pdf-parser/info-page-parser";
import {
  indexPairingsByFlightNumber,
  indexPairingsBySequence,
  parseLineGridColumn,
} from "@/lib/pdf-parser/line-grid-parser";
import { extractMetaFromLineGridHeader, extractMetaFromPairingHeader } from "@/lib/pdf-parser/meta";
import { parsePairingColumn } from "@/lib/pdf-parser/pairing-parser";
import { classifyPage } from "@/lib/pdf-parser/page-classifier";
import { extractReserveLineSeat, parseReserveLineGridRows } from "@/lib/pdf-parser/reserve-line-parser";
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
  ParsedPairing,
  ParseWarning,
} from "@/lib/pdf-parser/types";
import type { BidPack, BidPackInfo, ReserveLine, Seat } from "@/types/bidpack";

export { MAX_PDF_BYTES } from "@/lib/pdf-parser/constants";
export type { ParseBidPackResult } from "@/lib/pdf-parser/types";

export async function parseBidPackPdf(data: Uint8Array): Promise<ParseBidPackResult> {
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

  for (let i = 0; i < pages.length; i++) {
    if (pageClassifications[i].kind !== "pairing-schedule") continue;
    const page = pages[i];
    const headerText = groupIntoRows(page.items).slice(0, 2).join(" | ");
    if (!pairingMeta) pairingMeta = extractMetaFromPairingHeader(headerText);

    const { left, right } = extractTwoColumnRows(page);
    allPairings.push(...parsePairingColumn([...left, ...right], page.pageNumber, warnings));
  }

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
  };

  // Pass 3: reserve line grid + info page — both purely numeric/summary
  // data (line numbers and R/A/B types; pack-wide guarantee and credit
  // stats), never a page that names anyone.
  const reserveLinesBySeat: Partial<Record<Seat, ReserveLine[]>> = {};
  let infoBySeat: Partial<Record<Seat, BidPackInfo>> | null = null;

  for (let i = 0; i < pages.length; i++) {
    const kind = pageClassifications[i].kind;
    if (kind !== "reserve-line-grid" && kind !== "info-page") continue;
    const page = pages[i];
    const rows = groupIntoRows(page.items);

    if (kind === "reserve-line-grid") {
      const seat = extractReserveLineSeat(rows.slice(0, 4)) ?? "CAP";
      const parsed = parseReserveLineGridRows(rows, page.pageNumber, warnings);
      if (parsed.length > 0) {
        reserveLinesBySeat[seat] = [...(reserveLinesBySeat[seat] ?? []), ...parsed];
      }
    } else if (!infoBySeat) {
      infoBySeat = parseInfoPage(rows, page.pageNumber, warnings);
    }
  }

  const linesWithIncompleteTrips: { lineNumber: string; seat: "CAP" | "FO" }[] = [];
  const bidPacksBySeat: Partial<Record<"CAP" | "FO", BidPack>> = {};

  for (const seat of ["CAP", "FO"] as const) {
    const seatResults = lineResults.filter((r) => r.summary.seat === seat);
    if (seatResults.length === 0) continue;

    for (const r of seatResults) {
      if (!r.pairings) linesWithIncompleteTrips.push({ lineNumber: r.summary.lineNumber, seat });
    }

    bidPacksBySeat[seat] = {
      id: `uploaded-${meta.base}-${seat}-${meta.month}`.toLowerCase(),
      month: meta.month,
      base: meta.base,
      aircraft: meta.aircraft,
      seat,
      bidPeriodDays: 28,
      lines: seatResults.map((r) => buildLine(r.summary, r.pairings)),
      reserveLines: reserveLinesBySeat[seat],
      info: infoBySeat?.[seat],
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
  };
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
