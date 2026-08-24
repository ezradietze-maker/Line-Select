import type { PageClassification, PageKind } from "@/lib/pdf-parser/types";

/**
 * Classifies a page from its first several text rows. Only two kinds get
 * parsed further (pairing-schedule, line-grid); everything else — most
 * importantly pages listing named individuals — is classified and then
 * never touched again by the rest of the pipeline.
 */
export function classifyPage(pageNumber: number, headerRows: string[]): PageClassification {
  const header = headerRows.slice(0, 8).join(" | ");

  if (/BID\s*PACK\s*PAIRING\s*SCHEDULE\s*FOR/i.test(header)) {
    return { pageNumber, kind: "pairing-schedule", reason: "matched pairing schedule header" };
  }

  if (/DOMICILE\s*-\s*(CAPTAIN|CAP|F\s*\/\s*O|FIRST OFFICER)\s*ONLY/i.test(header)) {
    return { pageNumber, kind: "line-grid", reason: "matched '<base> domicile - <seat> only' header" };
  }

  const personalDataPatterns: { pattern: RegExp; label: string }[] = [
    { pattern: /Vacation\s+Schedule\s+by\s+Week/i, label: "Vacation Schedule by Week" },
    { pattern: /Bid\s+Seniority\s+List/i, label: "Bid Seniority List" },
    { pattern: /Training\s+List/i, label: "Training List" },
    { pattern: /Reserve\s+Lines\s*:/i, label: "Reserve Lines roster" },
  ];
  for (const { pattern, label } of personalDataPatterns) {
    if (pattern.test(header)) {
      return { pageNumber, kind: "ignored-personal-data", reason: `matched "${label}" header` };
    }
  }

  return { pageNumber, kind: "ignored-other", reason: "did not match a parsed page pattern" };
}

export function summarizeClassifications(
  classifications: PageClassification[]
): Record<PageKind, number> {
  const counts: Record<PageKind, number> = {
    "pairing-schedule": 0,
    "line-grid": 0,
    "ignored-personal-data": 0,
    "ignored-other": 0,
  };
  for (const c of classifications) counts[c.kind]++;
  return counts;
}
