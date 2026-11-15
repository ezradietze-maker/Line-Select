import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PreviewScreen } from "@/components/upload/PreviewScreen";
import { classifyPage } from "@/lib/pdf-parser/page-classifier";
import type { ParseBidPackResult } from "@/lib/pdf-parser/types";
import type { BidPack } from "@/types/bidpack";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, " ");

describe("what the preview says was read", () => {
  it("doesn't say the vacation schedule was never read: its numbers are", () => {
    // The parser reads this page (seniority numbers and vacation dates), so the strategies can work around a vacation.
    const vacation = classifyPage(9, ["Vacation Schedule by Week"]);
    expect(vacation.kind).toBe("vacation-schedule");
    const pack = { lines: [{ id: "l", lineNumber: "1001", totalCreditHours: 70, daysOff: 15 }] } as unknown as BidPack;
    const result = { errors: [], warnings: [], problems: [], bidPacksBySeat: { CAP: pack }, meta: null, pageClassifications: [vacation], linesParsed: 1, pairingsParsed: 0, linesWithIncompleteTrips: [] } as unknown as ParseBidPackResult;
    const shown = text(renderToStaticMarkup(createElement(PreviewScreen, { result, onConfirm: () => {}, onUploadDifferent: () => {} })));
    expect(shown).not.toMatch(/vacation[^.]*never (?:parsed|read)/i);
    expect(shown).toMatch(/vacation schedule only numbers were read/);
  });
});
