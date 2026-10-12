import { describe, expect, it } from "vitest";
import { pairingToTrip, resolveLayoverVariants } from "@/lib/pdf-parser/build-bidpack";
import { parsePairingColumn } from "@/lib/pdf-parser/pairing-parser";
import { buildDetailedMonth } from "@/lib/month-detail";
import { anchorTripToItsDate, tripReportUtc } from "@/lib/trip-anchor";
import { buildHomeDays, buildRawSegments, buildTimelineDays } from "@/lib/trip-timeline";
import type { Trip } from "@/types/bidpack";

// Rows verbatim from the October 2026 FedEx bid packs (hotel/ride lines trimmed where they don't matter).
const start = "2026-09-28";
const tripFrom = (rows: string[], startDayIndex: number, base: string): Trip => {
  const [pairing] = parsePairingColumn(rows, 1, []);
  return anchorTripToItsDate({ bidPeriodStart: start, base }, { ...pairingToTrip(pairing, "OCT26"), startDayIndex });
};
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

describe("a trip pinned to its own real date", () => {
  // IST → CDG on Thu Oct 29 — after Europe's clocks went back on Oct 25.
  const rows = [
    "33 TH REPORT AT 1023 (1323) STANDARD CREW",
    "EFFECTIVE OCTOBER 29 ONLY",
    "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
    "29TH 5025 83 IST 1123(1423) CDG 1456(1556) 03:33 MS 03:33 03:33 05:03",
    "LDGS: 1 BLOCK HRS: 03:33 CREDIT HRS: 03:33 TAFB: 05:03",
  ];

  it("reports at its grid date's printed local time", () => {
    const trip = tripFrom(rows, 31, "IST");
    expect(new Date(tripReportUtc({ bidPeriodStart: start, base: "IST" }, trip)!).toISOString()).toBe("2026-10-29T10:23:00.000Z");
  });

  it("draws each flight at its printed local times, the far side of a clock change included", () => {
    const trip = tripFrom(rows, 31, "IST");
    const flight = buildTimelineDays(trip, "local")
      .flatMap((d) => d.segments)
      .find((s) => s.kind === "flying")!;
    expect(flight.startMinuteOfDay).toBe(minutes("14:23"));
    // Anchored to the 1st of the month this landed at 16:56 — Paris's summer offset — an hour off the printed 15:56.
    expect(flight.endMinuteOfDay).toBe(minutes("15:56"));
  });
});

describe("a trip home across the date line", () => {
  // ANC → ICN → KIX → XMN → ICN → ANC, Oct 3–8: the last leg leaves Seoul on Oct 9 and lands in Anchorage on Oct 8.
  const rows = [
    "38 SA REPORT AT 1745 (0945) STANDARD CREW",
    "EFFECTIVE OCTOBER 3 ONLY",
    "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
    "03SA 5132 83 ANC 1845(1045) ICN 0415(1315) 09:30 DH/BH 09:30 09:30 11:00 ICN 27:40",
    "Hotel: SHERATON GRAND INCHEON HOTEL (ICN), +82 32 745- 1234",
    "05MO 6800 83 ICN 0925(1825) KIX 1120(2020) 01:55 DH",
    "05MO 5162 83 KIX 1255(2155) XMN 1645(0045) 03:50 05:45 05:45 08:50 XMN 48:45",
    "Hotel: SHERATON XIAMEN HOTEL (XMN)",
    "#07WE 5161 83 XMN 1900(0300) ICN 2137(0637) 02:37 02:37 03:12 04:07 ICN 24:33",
    "Hotel: SHERATON GRAND INCHEON HOTEL (ICN), +82 32 745- 1234",
    "#08TH 5163 83 ICN 2340(0840) ANC 0741(2341) 08:01 BH/DH 08:01 08:01 09:31",
    "LDGS: 5 BLOCK HRS: 25:53 CREDIT HRS: 35:51 T TAFB: 134:26",
  ];
  const trip = tripFrom(rows, 5, "ANC");

  it("draws every piece of the trip — the flight home included", () => {
    const days = buildTimelineDays(trip, "local");
    const drawn = new Set(days.flatMap((d) => d.segments.map((s) => `${s.kind}|${s.label}`)));
    for (const s of buildRawSegments(trip, "local")) expect(drawn.has(`${s.kind}|${s.label}`)).toBe(true);
    const home = days.flatMap((d) => d.segments).find((s) => s.leg?.flightNumber === "5163" && !s.continuesToNextDay)!;
    expect(home.endMinuteOfDay).toBe(minutes("23:41"));
    expect(home.dateLineBadge?.delta).toBe(-1);
  });

  it("labels each day with the real date where it is, never running backwards", () => {
    const dates = buildTimelineDays(trip, "local").map((d) => d.date!);
    expect(dates[0]).toBe("2026-10-03");
    // Seoul is a day ahead: the trip's Asian days are Oct 4–9 there.
    expect(dates.at(-1)).toBe("2026-10-09");
    for (let i = 1; i < dates.length; i++) expect(dates[i] >= dates[i - 1]).toBe(true);
  });

  it("lists each day's flying on the month calendar the way a pilot reads it", () => {
    const line = { id: "l", lineNumber: "1012", trips: [trip], daysOff: 22, totalCreditHours: 35.85, totalTafbHours: 134.43, totalLandings: 5, totalDepartures: 5 };
    const days = buildDetailedMonth(line, start, 28).days;
    // Oct 3: report, out to Seoul, a night there.
    // It lands 13:15 Seoul time — still Oct 3 on Anchorage's calendar.
    expect(days[5].flights).toEqual([{ kind: "flying", from: "ANC", to: "ICN", dep: "10:45", arr: "13:15" }]);
    expect(days[5].layoverCode).toBe("ICN");
    // Oct 5 (Anchorage's calendar): Seoul to Osaka to Xiamen.
    expect(days[7].flights.map((f) => `${f.dep} ${f.from}→${f.to}`)).toEqual(["18:25 ICN→KIX", "21:55 KIX→XMN"]);
    // Oct 6: a whole day in Xiamen.
    expect(days[8].flights).toEqual([]);
    expect(days[8].restCity).toBe("XMN");
    // Oct 8: home, landing 23:41 local.
    expect(days[10].flights.at(-1)).toEqual({ kind: "flying", from: "ICN", to: "ANC", dep: "08:40", arr: "23:41" });
  });

  it("fits the base's own calendar the grid counts: Oct 3 to Oct 8, six days", () => {
    const home = buildHomeDays(trip, "local");
    expect(home).toHaveLength(6);
    expect(home.at(-1)!.segments.some((s) => s.leg?.flightNumber === "5163")).toBe(true);
  });
});

describe("a layover whose hotel changes with the trip's date", () => {
  const rows = [
    "116 TU WE TH FR REPORT AT 0724 (0224) STANDARD CREW",
    "EFFECTIVE SEPTEMBER 29 - OCTOBER 23",
    "DAY FLIGHT EQP DEPARTS ARRIVES BLOCK MEAL S BLOCK CREDIT DUTY LAYOVER",
    "1 1433 55 MEM 0824(0324) ORF 1023(0623) 01:59 01:59 03:12 03:29 ORF 13:27",
    "SEP 29 - OCT 01 TRIP(S) ONLY ----------------------------------",
    "Trans To: BESPOKE TRANSPORTATION (ORF), +1-800-905-2103, pickup @1023 (0623)",
    "Hotel: SHERATON NORFOLK WATERSIDE (ORF), +1-757-622-6664",
    "Trans From: BESPOKE TRANSPORTATION (ORF), +1-800-905-2103, pickup @0000 (*2000)",
    "OCT 02 - 23 TRIP(S) ONLY --------------------------------------",
    "Trans To: BESPOKE TRANSPORTATION (ORF), +1-800-905-2103, pickup @1023 (0623)",
    "Hotel: DELTA MARRIOTT CHESAPEAKE ORF (ORF), +1-757-523-1500",
    "Trans From: BESPOKE TRANSPORTATION (ORF), +1-800-905-2103, pickup @2355 (1955)",
    "*2 2338 55 ORF 0120(2120) MEM 0342(2242) 02:22 02:22 03:12 03:52",
    "LDGS: 2 BLOCK HRS: 04:21 CREDIT HRS: 06:24 TAFB: 20:48",
  ];
  const [pairing] = parsePairingColumn(rows, 12, []);
  const trip = pairingToTrip(pairing, "OCT26");

  it("gives a Sep 30 trip the Sheraton and its 20:00 pickup, an Oct 6 trip the Delta Marriott and its 19:55", () => {
    const early = resolveLayoverVariants(trip, Date.UTC(2026, 8, 30, 7, 24));
    const late = resolveLayoverVariants(trip, Date.UTC(2026, 9, 6, 7, 24));
    expect(early.schedule[0].layover!.hotelName).toBe("SHERATON NORFOLK WATERSIDE");
    expect(early.schedule[0].layover!.pickupTimeLocal).toBe("2000");
    expect(early.layoverDetails[0].hotelName).toBe("SHERATON NORFOLK WATERSIDE");
    expect(late.schedule[0].layover!.hotelName).toBe("DELTA MARRIOTT CHESAPEAKE ORF");
    expect(late.schedule[0].layover!.pickupTimeLocal).toBe("1955");
    // The next duty starts at that version's pickup: five minutes apart.
    expect(early.schedule[1].startMinutes - late.schedule[1].startMinutes).toBe(5);
  });
});
