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

describe("the contract validator, held to where each claim is made", () => {
  type Q = RawAnswer["quotes"][number];
  const SWW: Q = { section: "25.E.6", version: "2026", quote: QUOTE };
  const STUDENT: Q = { section: "25.C.13.a", version: "2026", quote: "specific regular lines awarded to LCAs may be designated as student lines." };
  const BHS: Q = { section: "25.M.3.a.vii", version: "2026", quote: "the Company may assign a pilot once per bid period to base hotel standby for a block or a portion of a block of R-days" };
  const RES: Q = { section: "25.M.3.b.i", version: "2026", quote: "Except for R-24, pilots shall be scheduled for either R-1.5, R-2, or R-3 status for an entire RP block." };
  const FACTS = "The pilot's bid pack: OCT26, IND B767 CAP, a 28-day bid period.\nLine 1001 as printed: 15 days off, 78.6 CH, 294.73 hours TAFB, 1 trips.";
  const ok = (answer: string, quotes: Q[], ctx: { question?: string; facts?: string; bidMonth?: string } = {}) =>
    validateAnswer({ found: true, answer, quotes }, { question: "q", bidMonth: "2026-11", ...ctx }).ok;

  it("reads a date however it's written, and checks a month with no year", () => {
    for (const date of ["Oct 2027", "Dec. 2027", "October of 2027", "October 2027", "the July bid period"]) expect(ok(`The 115-hour SWW starts by ${date}.`, [SWW])).toBe(false);
    expect(ok("The 115-hour SWW does not start until 2027.", [SWW])).toBe(false);
    expect(ok("The 115-hour SWW starts by Dec. 2026.", [SWW])).toBe(true);
    expect(ok("The 115-hour SWW starts with the December bid period.", [SWW])).toBe(true);
    expect(ok("The once-per-bid-period limit has applied since 29 June 2026.", [BHS])).toBe(true);
    expect(ok("The once-per-bid-period limit has applied since June 29th, 2026.", [BHS])).toBe(true);
    expect(ok("The once-per-bid-period limit starts with the December bid period.", [BHS])).toBe(false);
    for (const phase of ["phase 3", "Phase Three", "Phase III", "the third phase"]) expect(ok(`The once-per-bid-period limit is a ${phase} change.`, [BHS])).toBe(false);
    expect(ok("The 115-hour SWW is a Phase II change.", [SWW])).toBe(true);
    expect(ok("A phase-in conflict doesn't change the 115-hour SWW.", [SWW])).toBe(true);
  });

  it("holds a date to the rule its clause speaks of, and the bid month only to the period asked about", () => {
    expect(ok("The 115-hour SWW starts by the October 2027 bid period.", [SWW, STUDENT])).toBe(false);
    expect(ok("Student lines start by the October 2027 bid period, and the 115-hour SWW by the December 2026 bid period.", [SWW, STUDENT])).toBe(true);
    expect(ok("The 115-hour SWW starts by the October 2027 bid period.", [SWW, { ...STUDENT, quote: "student lines" }])).toBe(false);
    expect(ok("The 115-hour SWW has applied since the November 2026 bid period.", [SWW])).toBe(false);
    expect(ok("The 115-hour SWW isn't in force for the November 2026 bid period.", [SWW])).toBe(true);
    const march = "Yes. The 115-hour SWW starts by the December 2026 bid period, so it applies in the March 2027 bid period.";
    expect(ok(march, [SWW], { question: "Will the 115-hour SWW apply in the March 2027 bid period?" })).toBe(true);
    expect(ok(march, [SWW])).toBe(false);
    expect(ok("The 115-hour SWW starts by the March 2027 bid period.", [SWW], { question: "Will the 115-hour SWW apply in the March 2027 bid period?" })).toBe(false);
    // A rule in force by hand since signing and automated later: each date stays with its own word.
    const disruption: Q = { section: "25.S.2.a", version: "2026", quote: contractNode("25.S.2.a")!.text.split(/\s+/).slice(0, 12).join(" ") };
    expect(ok("This has been in force since June 29, 2026, applied by hand until automated by the December 2026 bid period.", [disruption])).toBe(true);
    expect(ok("This has been in force since December 2026, applied by hand until automated by the June 2026 bid period.", [disruption])).toBe(false);
  });

  it("lets no pack figure back a rule, however the sentence is cut", () => {
    const facts = { facts: FACTS };
    for (const answer of [
      "Line 1001 meets the contract's minimum of 15 days off.",
      "Unlike line 1001, the contract requires at least 15 days off in every bid period.",
      "Line 1001 has 15 days off — the contract requires at least 15 days off.",
      "Line 1001 has 15 days off: the contract requires at least 15 days off.",
      "Line 1001\n- 15 days off\n- The contract requires at least 15 days off",
      "Line 1001 has 15 days off (the contract minimum is 15 days off).",
      "The contract allows at most 26 work days on line 1001.",
      "On line 1001 the contract caps duty at 28 days in a row.",
    ])
      expect(ok(answer, [SWW], facts)).toBe(false);
    for (const answer of [
      "Line 1001 has 15 days off, and 78.6 CH.",
      "Line 1001 has 15 days off. It has 78.6 CH and 294.73 hours TAFB.",
      "Line 1001 has 1 trip, which totals 78.6 CH.",
      "Line 1001\n- 15 days off\n- 78.6 CH",
      "Line 1001 has 15 days off in a 28-day bid period.",
    ])
      expect(ok(answer, [SWW], facts)).toBe(true);
  });

  it("reads no quantity from a reserve status, and hides none behind one", () => {
    expect(ok("A reserve pilot's status can be changed with 24 hours' notice.", [RES])).toBe(false);
    expect(ok("CRS must give 1.5 hours' notice before changing a reserve status.", [RES])).toBe(false);
    expect(ok("An R-3 pilot must be reachable for R-24 hours.", [RES])).toBe(false);
    expect(ok("Except for R‑24, reserve pilots hold R-1.5, R-2 or R-3 status for an entire RP block.", [RES])).toBe(true);
    const nonR24: Q = {
      section: "25.M.3.a.vii",
      version: "2026",
      quote: "If, due to a shortage of non R-24 pilots, an R-24 pilot is needed in the pilot’s base for shorter notification, the Company may assign a pilot once per bid period to base hotel standby",
    };
    expect(ok("The Company may hold a reserve pilot on base hotel standby for up to 24 hours once per bid period.", [nonR24])).toBe(false);
  });

  it("lets a section a quote names in, exactly, and not what's above it", () => {
    const smu: Q = { section: "25.L.6.f", version: "2026", quote: "If a SMU trip is dropped as provided in Section 25.L.3.a., those CH revert to general make up (M/U)." };
    expect(ok("Dropped as provided in 25.L.3.a, a SMU trip's CH revert to general make up (M/U).", [smu])).toBe(true);
    expect(ok("Under Section 25.L.3, a dropped SMU trip's CH revert to general make up (M/U).", [smu])).toBe(false);
    const cancel: Q = { section: "7.I.1", version: "2026", quote: "The Company will not use vacation cancelations (Section 7.I.2. and 3) in a crew position (including BPO pilots) which has been bought up to the Section 4.A.1. Minimum Bid Period Guarantee." };
    expect(ok("The Company will not use the cancelations in 7.I.2 and 7.I.3 in a crew position bought up to the Section 4.A.1 guarantee.", [cancel])).toBe(true);
    expect(ok("The Company will not use the cancelations in 7.I.4 in a crew position bought up to the Section 4.A.1 guarantee.", [cancel])).toBe(false);
  });

  it("reads 'one' standing for a thing named before as no count", () => {
    expect(ok("The Company may assign base hotel standby once per bid period, and each one beyond that needs the pilot's consent.", [BHS])).toBe(true);
    expect(ok("A trip in open time, including a dropped one, may go to base hotel standby once per bid period.", [BHS])).toBe(true);
    expect(ok("Only one is allowed per block of R-days.", [BHS])).toBe(false);
    expect(ok("The Company may assign the one day of base hotel standby per bid period.", [BHS])).toBe(false);
  });

  it("checks a month that ends a sentence, and reads 'the bid period after November' as no start", () => {
    expect(ok("The 115-hour SWW starts by August.", [SWW])).toBe(false);
    expect(ok("The 115-hour SWW starts by December.", [SWW])).toBe(true);
    expect(ok("The once-per-bid-period limit has applied since December.", [BHS])).toBe(false);
    expect(ok("The 115-hour SWW does not take effect until the bid period after November.", [SWW])).toBe(true);
    expect(ok("The 115-hour SWW takes effect after August 2027.", [SWW])).toBe(false);
  });

  it("dates a rule by its own quote, not by the implementation chart's line beside it", () => {
    const opening = (id: string, words: number): Q => ({ section: id, version: "2026", quote: contractNode(id)!.text.split(/\s+/).slice(0, words).join(" ") });
    const chart = contractNode("LOA-Implementation")!.text;
    const phase2: Q = { section: "LOA-Implementation", version: "2026", quote: chart.slice(chart.indexOf("Phase 2"), chart.indexOf("\n", chart.indexOf("Phase 2"))) };
    const cap = opening("25.L.8.a", 60);
    expect(ok("The 2026 wording raises that cap to 13 CH, effective the first day of the December 2026 bid period.", [cap, phase2])).toBe(true);
    expect(ok("The 2026 wording raises that cap to 13 CH, effective the first day of the June 2026 bid period.", [cap, phase2])).toBe(false);
    // Both quotes share "hours" with the clause; only the Phase 2 one holds its 3.
    const upTo = (id: string, words: string): Q => {
      const text = contractNode(id)!.text;
      return { section: id, version: "2026", quote: text.slice(0, text.indexOf(words) + words.length) };
    };
    const quotes = [upTo("25.G.2.c", "3 hours"), upTo("25.G.1", "12 hours")];
    expect(ok("The 3-hour pilots-only rule doesn't start until the December 2026 bid period.", quotes)).toBe(true);
    expect(ok("The 3-hour pilots-only rule doesn't start until the June 2026 bid period.", quotes)).toBe(false);
    // 25.L.10's one change waits on 25.L.1.a: naming the heading doesn't bring in the general effective date.
    const pickUp: Q = { section: "25.L.10.c", version: "2026", quote: contractNode("25.L.10.c")!.text.trim() };
    expect(ok("Under 25.L.10, a trip pick-up is processed this way by the August 2027 bid period.", [pickUp])).toBe(true);
    expect(ok("Under 25.L.10, a trip pick-up has been processed this way since June 29, 2026.", [pickUp])).toBe(false);
  });

  it("reads a number in wide or other digits, or refuses it", () => {
    expect(ok("The SWW runs at least １２０ hours.", [SWW])).toBe(false);
    expect(ok("The 115-hour SWW is a Phase ４ change.", [SWW])).toBe(false);
    expect(ok("The SWW runs at least 115½ hours.", [SWW])).toBe(false);
    expect(ok("The SWW runs at least ١١٥ hours.", [SWW])).toBe(false);
    expect(validateAnswer({ found: true, answer: "It runs at least １１５ hours.", quotes: [SWW] }, { question: "q" })).toMatchObject({ ok: true, answer: "It runs at least １１５ hours." });
  });

  it("refuses more quotes than an answer needs", () => {
    expect(validateAnswer({ found: true, answer: "It runs 115 hours.", quotes: Array.from({ length: 31 }, () => SWW) }, { question: "q" })).toMatchObject({ ok: false, reason: expect.stringContaining("at most 30") });
    expect(ok("It runs 115 hours.", Array.from({ length: 30 }, () => SWW))).toBe(true);
  });
});
