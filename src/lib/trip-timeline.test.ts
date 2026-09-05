import { describe, expect, it } from "vitest";
import { buildTimelineDays } from "@/lib/trip-timeline";
import type { Trip } from "@/types/bidpack";

/** SFO 11:00 Tue local -> NRT 13:30 Wed local, ~10.5h real flight — the same westbound date-line crossing verified by hand in trip-clock.test.ts. */
const westboundTrip: Trip = {
  id: "t",
  pairingNumber: "1",
  days: 1,
  layoverCities: ["NRT"],
  layoverDetails: [{ city: "NRT", hotelName: null }],
  reportTime: "afternoon",
  international: true,
  deadheadLegs: 0,
  creditHours: 12,
  landings: 1,
  tafbHours: 10.5,
  departures: 1,
  zuluAnchor: "2024-07-02T18:00:00.000Z",
  startDayIndex: null,
  schedule: [
    {
      reportTimeLocal: "1100",
      startMinutes: 0,
      legs: [
        {
          flightNumber: "1",
          equipment: "77",
          isDeadhead: false,
          depAirport: "SFO",
          depTimeLocal: "1100",
          depTimeGmt: "1800",
          arrAirport: "NRT",
          arrTimeLocal: "1330",
          arrTimeGmt: "0430",
          blockHours: 10.5,
          startMinutes: 0,
          endMinutes: 630,
          depTimeZulu: "2024-07-02T18:00:00.000Z",
          arrTimeZulu: "2024-07-03T04:30:00.000Z",
        },
      ],
      layover: null,
    },
  ],
};

/** SFO -> LAX, same zone both ends — no date-line effect possible regardless of mode. */
const domesticTrip: Trip = {
  ...westboundTrip,
  id: "t2",
  layoverCities: ["LAX"],
  schedule: [
    {
      reportTimeLocal: "1100",
      startMinutes: 0,
      legs: [
        {
          ...westboundTrip.schedule[0].legs[0],
          arrAirport: "LAX",
          depTimeZulu: "2024-07-02T18:00:00.000Z",
          arrTimeZulu: "2024-07-02T19:15:00.000Z",
          startMinutes: 0,
          endMinutes: 75,
        },
      ],
      layover: null,
    },
  ],
};

describe("buildTimelineDays — zulu mode", () => {
  it("buckets purely by elapsed Zulu day, ignoring local timezones entirely", () => {
    const days = buildTimelineDays(westboundTrip, "zulu");
    // A 630-minute (10.5h) leg starting at elapsed minute 0 never crosses a Zulu midnight.
    expect(days).toHaveLength(1);
    expect(days[0].segments[0].dateLineBadge).toBeUndefined();
    expect(days[0].zuluRulerLabel).toBeUndefined();
  });
});

describe("buildTimelineDays — local mode", () => {
  it("splits a date-line-crossing leg across two local day columns", () => {
    const days = buildTimelineDays(westboundTrip, "local");
    expect(days).toHaveLength(2);
    expect(days[0].segments).toHaveLength(1);
    expect(days[1].segments).toHaveLength(1);
  });

  it("flags the date-line crossing on the fragment that actually lands, not the one that departs", () => {
    const days = buildTimelineDays(westboundTrip, "local");
    expect(days[0].segments[0].dateLineBadge).toBeUndefined();
    expect(days[1].segments[0].dateLineBadge).toBeDefined();
    expect(days[1].segments[0].dateLineBadge!.delta).toBe(1);
    expect(days[1].segments[0].dateLineBadge!.explanation).toContain("NRT");
  });

  it("positions the departure fragment at 11:00 (real SFO local time) and the arrival fragment ending at 13:30 (real NRT local time)", () => {
    const days = buildTimelineDays(westboundTrip, "local");
    expect(days[0].segments[0].startMinuteOfDay).toBe(11 * 60);
    expect(days[1].segments[0].endMinuteOfDay).toBe(13 * 60 + 30);
  });

  it("marks the split fragments as continuing into/from each other, not as two independent segments", () => {
    const days = buildTimelineDays(westboundTrip, "local");
    expect(days[0].segments[0].continuesToNextDay).toBe(true);
    expect(days[1].segments[0].continuesFromPreviousDay).toBe(true);
  });

  it("keeps the always-visible Zulu ruler label present on every local day column", () => {
    const days = buildTimelineDays(westboundTrip, "local");
    for (const day of days) {
      expect(day.zuluRulerLabel).toBeDefined();
      expect(day.zuluRulerLabel).toMatch(/^Z \d{2}:\d{2} → /);
    }
  });

  it("never flags a same-zone domestic hop as a date-line crossing, in either mode", () => {
    expect(buildTimelineDays(domesticTrip, "zulu")[0].segments[0].dateLineBadge).toBeUndefined();
    const local = buildTimelineDays(domesticTrip, "local");
    expect(local.every((d) => d.segments.every((s) => s.dateLineBadge === undefined))).toBe(true);
  });

  it("fits a same-zone domestic hop into a single local day column", () => {
    const local = buildTimelineDays(domesticTrip, "local");
    expect(local).toHaveLength(1);
  });
});

describe("buildTimelineDays — mode-aware time display", () => {
  it("shows local time as primary and Zulu as the secondary label in Local mode", () => {
    const seg = buildTimelineDays(westboundTrip, "local")[0].segments[0];
    expect(seg.inlineStart).toBe("11:00 SFO");
    expect(seg.detail).toContain("11:00 → 13:30 local");
    expect(seg.detail).toContain("(18:00 → 04:30 Z)");
  });

  it("swaps primary/secondary when Zulu mode is selected, without changing which real instants are shown", () => {
    const seg = buildTimelineDays(westboundTrip, "zulu")[0].segments[0];
    expect(seg.inlineStart).toBe("18:00 SFO");
    expect(seg.detail).toContain("18:00 → 04:30 Z");
    expect(seg.detail).toContain("(11:00 → 13:30 local)");
  });

  it("shows the bid pack's own printed GMT clock, not depTimeZulu's — the anchor is arbitrary (see Trip.zuluAnchor) so its own clock reading has no reason to match the real printed time", () => {
    // Same trip, but anchored far from the leg's own startMinutes-derived
    // instant — a real gap, exactly like a real bid pack's shared
    // per-month anchor vs. an individual trip's own report time. If the
    // display ever regresses to reading depTimeZulu's clock directly, this
    // is the case that catches it (westboundTrip's own fixture happens to
    // have startMinutes: 0 land exactly on its anchor, which would hide
    // the bug).
    const misanchoredTrip: Trip = {
      ...westboundTrip,
      zuluAnchor: "2026-09-01T00:00:00.000Z",
      schedule: [
        {
          ...westboundTrip.schedule[0],
          startMinutes: 9999,
          legs: [{ ...westboundTrip.schedule[0].legs[0], startMinutes: 9999, endMinutes: 10629 }],
        },
      ],
    };
    const flyingSeg = buildTimelineDays(misanchoredTrip, "local")
      .flatMap((d) => d.segments)
      .find((s) => s.kind === "flying")!;
    // Still the real printed local/GMT clocks, unaffected by the mismatched anchor.
    expect(flyingSeg.inlineStart).toBe("11:00 SFO");
    expect(flyingSeg.detail).toContain("(18:00 → 04:30 Z)");
  });
});
