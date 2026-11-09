import { describe, expect, it } from "vitest";
import { narrowestPiece, normalizeForMatch, validateAnswer, type RawAnswer } from "./validate";

const QUOTE = "The SWW is a period of not less than 115 hours beginning at 1700 CT the day following the posting of the View/Add Processing Window results.";
const good: RawAnswer = { found: true, answer: "It runs at least 115 hours from 1700 CT.", quotes: [{ section: "25.E.6", quote: QUOTE, version: "2026" }] };
const check = (raw: RawAnswer, question = "How long is the SWW?", facts?: string) => validateAnswer(raw, { question, facts });

describe("the contract validator", () => {
  it("passes a real quote from a real section", () => {
    expect(check(good)).toEqual({ ok: true, answer: good.answer, quotes: [{ section: "25.E.6", quote: QUOTE, version: "2026" }] });
  });

  it("rejects a made-up section", () => {
    expect(check({ ...good, quotes: [{ ...good.quotes[0], section: "25.E.42" }] })).toMatchObject({ ok: false, reason: expect.stringContaining("no section 25.E.42") });
    expect(check({ ...good, quotes: [{ ...good.quotes[0], section: "13.B.2" }] }).ok).toBe(false);
  });

  it("rejects a misquote: one word changed", () => {
    const quote = QUOTE.replace("115", "144");
    expect(check({ ...good, quotes: [{ ...good.quotes[0], quote }] })).toMatchObject({ ok: false, reason: expect.stringContaining("not word for word") });
  });

  it("doesn't relabel a deleted rule for the model: it rejects it and says where the words are", () => {
    const deleted = 'Reserves who elected the "first fly" option as provided in Section 25.M.4., shall be assigned in seniority order, prior to pilots who have not elected that option, until they have accrued 75% of RLG.';
    const verdict = check({ found: true, answer: "Until they have accrued 75% of RLG.", quotes: [{ section: "25.M.6", quote: deleted, version: "2026" }] });
    expect(verdict).toMatchObject({ ok: false, reason: expect.stringContaining("Those words are in the 2015 wording of 25.M.6.b.iv") });
  });

  it("rejects a real quote cited to the wrong section", () => {
    expect(check({ ...good, quotes: [{ ...good.quotes[0], section: "25.E.5" }] }).ok).toBe(false);
  });

  it("holds a quote to the version it claims", () => {
    expect(check({ ...good, quotes: [{ ...good.quotes[0], version: "2015" }] }).ok).toBe(false);
    const old = "The SWW is a period of not less than 144 hours beginning at the posting of the View/Add Processing Window results.";
    expect(check({ found: true, answer: "It was 144 hours.", quotes: [{ section: "25.E.6", quote: old, version: "2015" }] }).ok).toBe(true);
    expect(check({ found: true, answer: "It was 144 hours.", quotes: [{ section: "25.E.6", quote: old, version: "2026" }] }).ok).toBe(false);
  });

  it("rejects an answer naming a section that doesn't exist, even with good quotes", () => {
    expect(check({ ...good, answer: "See 25.E.99 for this." }).ok).toBe(false);
    expect(check({ ...good, answer: "Section 13 covers it." }).ok).toBe(false);
    expect(check({ ...good, answer: "It's in 25.E.6, at least 115 hours." }).ok).toBe(true);
  });

  it("rejects a number the quotes don't back", () => {
    expect(check({ ...good, answer: "It runs at least 120 hours." })).toMatchObject({ ok: false, reason: expect.stringContaining("120") });
    expect(check({ ...good, answer: "The 2026 wording says 115 hours." }).ok).toBe(true);
  });

  it("lets numbers through from the question and the pilot's pack", () => {
    expect(check({ ...good, answer: "Line 2016 has 14 days off; the SWW is 115 hours." }, "line 2016?", "Line 2016 as printed: 14 days off").ok).toBe(true);
  });

  it("needs a quote long enough to prove something", () => {
    expect(check({ ...good, answer: "Yes.", quotes: [{ section: "25.E.6", quote: "the SWW", version: "2026" }] }).ok).toBe(false);
    expect(check({ found: true, answer: "Yes.", quotes: [] }).ok).toBe(false);
    expect(check({ found: false, answer: "", quotes: [] }).ok).toBe(false);
  });

  it("ignores only spacing and the PDF's typography", () => {
    expect(normalizeForMatch("the pilot’s  “bid”\n– R-24")).toBe(normalizeForMatch(`the pilot's "bid" - R‑24`));
    expect(normalizeForMatch("115 hours")).not.toBe(normalizeForMatch("116 hours"));
  });

  it("lands a quote on the narrowest piece that holds it", () => {
    expect(narrowestPiece("25.E", QUOTE, "2026")).toBe("25.E.6");
    expect(check({ ...good, quotes: [{ ...good.quotes[0], section: "25.E" }] })).toMatchObject({ ok: true, quotes: [{ section: "25.E.6" }] });
  });
});
