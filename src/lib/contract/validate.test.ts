import { describe, expect, it } from "vitest";
import { contractNode } from "./index";
import { holdsQuote, narrowestPiece, normalizeForMatch, validateAnswer, whereIsQuote, type RawAnswer } from "./validate";

const QUOTE = "The SWW is a period of not less than 115 hours beginning at 1700 CT the day following the posting of the View/Add Processing Window results.";
const good: RawAnswer = { found: true, answer: "It runs at least 115 hours from 1700 CT.", quotes: [{ section: "25.E.6", quote: QUOTE, version: "2026" }] };
const check = (raw: RawAnswer, question = "How long is the SWW?", facts?: string) => validateAnswer(raw, { question, facts });

describe("the contract validator", () => {
  it("passes a real quote from a real section", () => {
    expect(check(good)).toEqual({ ok: true, answer: good.answer, quotes: [{ section: "25.E.6", quote: QUOTE, version: "2026" }] });
  });

  it("holds a number written in words to the quotes, like one in digits", () => {
    expect(check({ ...good, answer: "It runs at least twelve hours." })).toMatchObject({ ok: false, reason: expect.stringContaining("12") });
    expect(check({ ...good, answer: "It starts by December 2026 and runs 115 hours." }).ok).toBe(true);
    // The SWW's 2026 wording is Phase 2's, so June 29 isn't when it starts.
    expect(check({ ...good, answer: "It starts June 29 and runs 115 hours." }).ok).toBe(false);
    expect(check({ ...good, answer: "It runs 29 hours." }).ok).toBe(false);
  });

  it("rejects an answer that names a section it doesn't quote", () => {
    expect(check({ ...good, answer: "Under 25.E.6 it runs at least 115 hours." }).ok).toBe(true);
    expect(check({ ...good, answer: "Under 25.E.5 it runs at least 115 hours." })).toMatchObject({ ok: false, reason: expect.stringContaining("quotes nothing from it") });
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

  it("refuses a quote cut off inside a number, at either end", () => {
    const cut = (quote: string, answer: string) => check({ found: true, answer, quotes: [{ section: "25.E.6", quote, version: "2026" }] });
    expect(cut("The SWW is a period of not less than 11", "At least 11 hours.").ok).toBe(false);
    expect(cut("5 hours beginning at 1700 CT the day following", "5 hours.").ok).toBe(false);
    expect(cut("The SWW is a period of not less than 115", "At least 115 hours.").ok).toBe(true);
  });

  it("lets no number through from the question, only a line or trip the pack facts show is real", () => {
    expect(check({ ...good, answer: "Yes, it runs 100 hours." }, "Is the SWW 100 hours?").ok).toBe(false);
    expect(check({ ...good, answer: "Yes, it begins at 1800 CT." }, "Does the SWW begin at 1800 CT?").ok).toBe(false);
    expect(check({ ...good, answer: "Yes, it runs 3 days." }, "Do trips 3 days long count?").ok).toBe(false);
    expect(check({ ...good, answer: "Yes, the SWW is 85 hours." }, "Is the line 85 hours?").ok).toBe(false);
    expect(check({ ...good, answer: "Yes, it runs 2 days." }, "Is the #2 rule that the SWW is 2 days?").ok).toBe(false);
    expect(check({ ...good, answer: "For trip 93 the SWW still runs 115 hours." }, "What about trip 93?").ok).toBe(false);
    expect(check({ ...good, answer: "For trip 93 the SWW still runs 115 hours." }, "What about trip 93?", "Trip 93 is in this pack.").ok).toBe(true);
    // A line the pack doesn't have is said to the model, but its number backs nothing.
    const missing = "The pilot's bid pack: OCT26, MEM B777 FO.\nLine 1800 isn't in this pack.";
    expect(check({ ...good, answer: "No, it posts at 1800 CT." }, "Does line 1800 still post at 1700?", missing).ok).toBe(false);
    expect(check({ ...good, answer: "Line 1800 isn't in your pack." }, "Does line 1800 still post at 1700?", missing).ok).toBe(false);
    const printed = "Line 2163 as printed: 13 days off, 81.5 CH, 240 hours TAFB, 6 trips.\nLine 1800 isn't in this pack.";
    expect(check({ ...good, answer: "Line 2163 has 13 days off and 81.5 CH; the SWW runs 115 hours." }, "line 2163 or line 1800?", printed).ok).toBe(true);
  });

  it("doesn't read 'no one' as a number, but does read a real count of one", () => {
    expect(check({ ...good, answer: "No one can shorten it below 115 hours." }).ok).toBe(true);
    expect(check({ ...good, answer: "Anyone, everyone and someone get 115 hours, all with one another." }).ok).toBe(true);
    expect(check({ ...good, answer: "It runs 115 hours for one of these pilots, not this one." }).ok).toBe(true);
    expect(check({ ...good, answer: "It gives you the one day off." }).ok).toBe(false);
    expect(check({ ...good, answer: "It covers only one of your vacations." }).ok).toBe(false);
    expect(check({ ...good, answer: "At least one of these runs 115 hours." }).ok).toBe(false);
    expect(check({ ...good, answer: "Each one runs 115 hours." }).ok).toBe(false);
  });

  it("lets a pack's figure back only what's said of its own line", () => {
    const blocks = { section: "25.D.1.c", version: "2026" as const, quote: "Regular lines in a 4 week bid period shall contain at least 1 block of 4 consecutive days off" };
    const facts = "The pilot's bid pack: OCT26, IND B767 CAP, a 28-day bid period.\nLine 1001 as printed: 15 days off, 78.6 CH, 294.73 hours TAFB, 1 trips.";
    const said = (answer: string) => check({ found: true, answer, quotes: [blocks] }, "How many days off does line 1001 have?", facts).ok;
    expect(said("Line 1001 has 15 days off and 78.6 CH. The contract requires at least 1 block of 4 days off in a 4 week bid period.")).toBe(true);
    expect(said("Line 1001 has 15 days off in a 28-day bid period.")).toBe(true);
    expect(said("Line 1001 has 15 days off. The contract requires at least 15 days off in a 4 week bid period.")).toBe(false);
    expect(said("Line 1001 has 15 days off. A 4 week bid period may have at most 28 work days.")).toBe(false);
    expect(said("Line 1001 has 15 days off, but the contract requires 15 of them in blocks of 4.")).toBe(false);
  });

  it("lets the answer name only a piece a quote landed on, one above it, or one the quote itself names", () => {
    const order = { section: "25.G.3.b", version: "2026" as const, quote: "Open time not assigned as provided in Section 25.G.1. shall be assigned in the following order:" };
    const said = (answer: string) => check({ found: true, answer, quotes: [order] }).ok;
    expect(said("Under 25.G.3.b, it goes in this order.")).toBe(true);
    expect(said("Under 25.G.3, it goes in this order.")).toBe(true);
    expect(said("What 25.G.1 doesn't assign goes in this order.")).toBe(true);
    expect(said("See 25.G.3.b.vii for this.")).toBe(false);
    expect(said("See 25.G.2 for this.")).toBe(false);
    // A piece under the one quoted, whose words are part of the quote, counts as quoted.
    const list = { section: "25.N.4.b.ii", version: "2026" as const, quote: `if the trip touches: (a) ${contractNode("25.N.4.b.ii.(a)")!.text}` };
    expect(check({ found: true, answer: "A trip that touches 25.N.4.b.ii.(a)'s holiday.", quotes: [list] }).ok).toBe(true);
  });

  it("holds every month, date and phase to when the quoted rules start", () => {
    const at = (answer: string, bidMonth?: string) => validateAnswer({ ...good, answer }, { question: "How long is the SWW?", bidMonth }).ok;
    expect(at("It runs 115 hours, starting by the December 2026 bid period (Phase 2).")).toBe(true);
    expect(at("It runs 115 hours, starting by the December 2027 bid period.")).toBe(false);
    expect(at("It runs 115 hours, starting by the March 2026 bid period.")).toBe(false);
    expect(at("It runs 115 hours, starting in Phase 3.")).toBe(false);
    expect(at("It runs 115 hours from June 29, 2026.")).toBe(false);
    expect(at("For November 2026 the 2015 wording applies.", "2026-11")).toBe(true);
    expect(at("For November 2026 the 2015 wording applies.")).toBe(false);
    expect(at("For November 2027 the 2015 wording applies.", "2026-11")).toBe(false);
    // A change the chart doesn't list is in force from the Agreement's general effective date.
    const recall = contractNode("4.Z")!.text.split(/\s+/).slice(0, 12).join(" ");
    expect(validateAnswer({ found: true, answer: "This is in force since June 29, 2026.", quotes: [{ section: "4.Z", quote: recall, version: "2026" }] }, { question: "?" }).ok).toBe(true);
    expect(validateAnswer({ found: true, answer: "This starts by the December 2026 bid period.", quotes: [{ section: "4.Z", quote: recall, version: "2026" }] }, { question: "?" }).ok).toBe(false);
  });

  it("reads a reserve status the contract writes as a name, not a count, and takes section numbers the quote names", () => {
    const standby = { section: "25.M.3.a.vii", version: "2026" as const, quote: "the Company may assign a pilot once per bid period to base hotel standby for a block or a portion of a block of R-days" };
    expect(check({ found: true, answer: "An R-24 pilot can be put on base hotel standby once per bid period.", quotes: [standby] }).ok).toBe(true);
    expect(check({ found: true, answer: "An R-48 pilot can be put on base hotel standby once per bid period.", quotes: [standby] }).ok).toBe(false);
    const disruption = {
      section: "25.S.2.g",
      version: "2026" as const,
      quote: "For trips originally scheduled entirely under Section 12.C. (Domestic Provisions), a day to critical disruption occurs if more than half of the original scheduled revenue duty periods in a trip began in the day duty period",
    };
    expect(check({ found: true, answer: "It covers trips scheduled entirely under Section 12.C.", quotes: [disruption] }).ok).toBe(true);
    expect(check({ found: true, answer: "It covers trips scheduled entirely under Section 12.D.", quotes: [disruption] }).ok).toBe(false);
  });

  it("holds a quote from a pay table, cell by cell", () => {
    // A row of 3.C.1.a as the index holds it: the year, then a rate for each seat, then the next year.
    const cells = contractNode("3.C.1.a")!.text.split(/\s+/);
    const at = cells.findIndex((c, i) => c === "5" && /^\d+\.\d+$/.test(cells[i + 1] ?? ""));
    const row = cells.slice(at, at + 4).join(" ");
    const rate = cells[at + 1];
    const pay = (quote: string, answer = `Year 5 pays ${rate} an hour.`) =>
      check({ found: true, answer, quotes: [{ section: "3.C.1.a", quote, version: "2026" }] }, "What does a year 5 captain make?");
    expect(pay(row)).toMatchObject({ ok: true, quotes: [{ section: "3.C.1.a" }] });
    expect(pay(cells.slice(at - 3, at + 1).join(" "), `Year 4 pays ${cells[at - 2]} an hour.`).ok).toBe(true);
    expect(whereIsQuote(row)).toEqual({ section: "3.C.1.a", version: "2026" });
    // Still cut inside a cell, and still no running two cells into a number neither holds.
    expect(pay(`${row.slice(3)} ${cells[at + 4]}`).ok).toBe(false);
    expect(pay(`${row} ${cells[at + 4].slice(0, 2)}`).ok).toBe(false);
    expect(pay(`${cells[at - 2]} ${cells[at - 1]} 5${rate} ${cells[at + 2]}`, `It pays 5${rate} an hour.`)).toMatchObject({ ok: false, reason: expect.stringContaining(`5${rate}`) });
  });

  it("tells a space between numbers from a number cut in two", () => {
    expect(holdsQuote("Year 1 386.72 117.54 2 429.64", "1 386.72 117.54 2")).toBe(true);
    expect(holdsQuote("notified in writing at least 30 days prior", "notified in writing at least 3")).toBe(false);
    expect(holdsQuote("notified in writing at least 30 days prior", "0 days prior")).toBe(false);
    expect(holdsQuote("up to 1,000 hours a year", "up to 1")).toBe(false);
    expect(holdsQuote("paid at 2.25 times the rate", "paid at 2.")).toBe(false);
    expect(holdsQuote("a rest of 9:30 hours", "a rest of 9")).toBe(false);
    expect(holdsQuote("between 8-10 hours of rest", "between 8")).toBe(true);
    // The PDF breaks a line inside a word or a number; a quote reads them whole.
    expect(holdsQuote("effective on June 29, 202 6; and", "effective on June 29, 2026")).toBe(true);
    expect(holdsQuote("the pi lot shall", "the pilot shall")).toBe(true);
  });

  it("reads a length of time or a number with thousands the way the contract writes it", () => {
    const rest = { section: "12.C.6.a", quote: "A domestic rest period shall be scheduled for not less than 9:30 hours", version: "2026" as const };
    const rig = { section: "4.F.2.d.ii", quote: "Duty rig is computed as 1 CH for each 1.5 hours on duty", version: "2026" as const };
    const weight = { section: "1.B.3", quote: "having a MTOGW of greater than 60,000 lbs.", version: "2026" as const };
    const said = (answer: string, quote: RawAnswer["quotes"][number]) => check({ found: true, answer, quotes: [quote] }, "?").ok;
    expect(said("At least 9 hours 30 minutes.", rest)).toBe(true);
    expect(said("At least 9 hours and 30 minutes.", rest)).toBe(true);
    expect(said("At least 9 hours 15 minutes.", rest)).toBe(false);
    expect(said("At least 8 hours 30 minutes.", rest)).toBe(false);
    expect(said("1 CH for every 1 hour 30 minutes on duty.", rig)).toBe(true);
    expect(said("1 CH for every 1 hour 20 minutes on duty.", rig)).toBe(false);
    expect(said("Aircraft over 60000 lbs.", weight)).toBe(true);
    expect(said("Aircraft over 60,000 lbs.", weight)).toBe(true);
    expect(said("Aircraft over 60 lbs.", weight)).toBe(false);
    expect(said("Aircraft over 6,000 lbs.", weight)).toBe(false);
  });
});
