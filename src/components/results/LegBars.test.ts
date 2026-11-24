import { describe, expect, it } from "vitest";
import { laneWords } from "@/components/results/LegBars";
import { dayBars, LABEL_CHAR_PX } from "@/lib/leg-bars";
import type { TimelineSegment } from "@/lib/trip-timeline";

const H = 60;
const piece = (kind: TimelineSegment["kind"], start: number, end: number, extra: Partial<TimelineSegment> = {}): TimelineSegment => ({
  kind,
  label: "",
  detail: "",
  inlineStart: "",
  inlineEnd: "",
  startMinuteOfDay: start,
  endMinuteOfDay: end,
  continuesFromPreviousDay: false,
  continuesToNextDay: false,
  ...extra,
});
const hotel = (city: string, hours: number) => ({ stay: { city, hotel: "Hotel", hours, transportTo: null, transportFrom: null } });
const right = (w: { center: number; text: string }) => w.center + (w.text.length * LABEL_CHAR_PX) / 2;
const left = (w: { center: number; text: string }) => w.center - (w.text.length * LABEL_CHAR_PX) / 2;

describe("laneWords", () => {
  // B757 MEM: a crew-rest hotel at IND through the sort (00:00–03:00), then a layover from 04:30 — on a phone's row.
  const width = 207;
  const gap = (w: number) => (40 * 24 * H) / w;
  const morning = [piece("connection", 0, 3 * H, { ...hotel("IND", 4.32), continuesFromPreviousDay: true }), piece("layover", 4.5 * H, 24 * H, { ...hotel("BUF", 21), continuesToNextDay: true })];

  it("keeps the rest hotel's words off the layover's", () => {
    // Before, "Rest HTL IND 4h19" (116px) sat at the row's left edge and ran over "L/O BUF 21h", which starts at 51px.
    const words = laneWords(dayBars(morning, gap(width), undefined, width), width);
    const stay = words.stays[0]!;
    const rest = words.rests[0];
    if (rest) expect(right(rest)).toBeLessThanOrEqual(stay.left);
    expect(stay.maxWidth).toBeGreaterThanOrEqual("L/O BUF 21h".length * LABEL_CHAR_PX);
  });

  it("stops a layover's words before a rest hotel's words after them", () => {
    const evening = [piece("layover", 1 * H, 20 * H, hotel("SAN", 15)), piece("connection", 21 * H, 24 * H, { ...hotel("OAK", 5.2), continuesToNextDay: true })];
    const words = laneWords(dayBars(evening, gap(width), undefined, width), width);
    const stay = words.stays[0]!;
    const rest = words.rests[0]!;
    expect(stay.left + stay.maxWidth).toBeLessThanOrEqual(left(rest));
    // The layover keeps its city and hours; the rest hotel's words give way.
    expect(stay.maxWidth).toBeGreaterThanOrEqual("L/O SAN 15h".length * LABEL_CHAR_PX);
  });

  it("drops L/O, not the hours, when a late stay leaves too little room before the day's edge", () => {
    // B767 MEM on a 375 phone: a 12h CDG stay from 16:53 on a 215px day; "L/O CDG 12h" lost the end of its "12h".
    const late = [piece("layover", 16.9 * H, 24 * H, { ...hotel("CDG", 12), continuesToNextDay: true })];
    const stay = laneWords(dayBars(late, gap(215), undefined, 215), 215).stays[0]!;
    expect(stay.left + stay.maxWidth).toBeLessThanOrEqual(215);
    expect(stay.fit).toMatchObject({ lo: false, hours: true });
    expect(laneWords(dayBars(late, gap(900), undefined, 900), 900).stays[0]!.fit).toMatchObject({ lo: true, hours: true });
  });

  it("writes it all out when there's room", () => {
    const words = laneWords(dayBars(morning, gap(900), undefined, 900), 900);
    expect(words.rests[0]?.text).toBe("Rest HTL IND 4h19");
    expect(words.stays[0]?.maxWidth).toBeGreaterThan(600);
  });
});
