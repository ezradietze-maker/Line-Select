import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { commuteBlocks, commuteNeedsForPack, commuteStatuses, type CommuteSettings } from "@/lib/commute-filter";
import { weekendDaysOff } from "@/lib/days-off-pattern";
import { METRICS } from "@/lib/metrics/catalog";
import { measureAll, prepareMetrics } from "@/lib/metrics/compute";
import { tripFactsOf } from "@/lib/metrics/trip-facts";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";
import { tripReportUtc } from "@/lib/trip-anchor";
import type { BidPack } from "@/types/bidpack";

/**
 * What's kept to save working it out again (each line's commute ways, each trip's facts and report, a pack's measures)
 * is kept beside the pack it came from, and goes with it: a tab open while the pilot loads pack after pack holds only
 * the one in use.
 */

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;
// A WeakRef holds its pack until the work that made it is done: collected only after the test hands back control.
const settle = () => new Promise((r) => setTimeout(r, 0));

const SETTINGS: CommuteSettings = { homeAirport: "DEN", arriveBeforeReportHours: 2, releaseToDepartureHours: 1, jumpseats: true };
const template = JSON.stringify(SAMPLE_BID_PACK);

/** The sample pack as a new month's upload: the same line and trip ids, dated four weeks on each time. */
function upload(month: number): BidPack {
  const pack = JSON.parse(template) as BidPack;
  pack.bidPeriodStart = new Date(Date.parse(`${pack.bidPeriodStart}T00:00:00Z`) + month * 28 * 86_400_000).toISOString().slice(0, 10);
  return pack;
}

function runEverything(pack: BidPack) {
  const pm = prepareMetrics(pack);
  for (const m of METRICS) measureAll(m.id, pack.lines, pm, { homeAirports: ["DEN"], minHomeHours: 30 });
  commuteNeedsForPack(pack, SETTINGS, 0);
  commuteStatuses(pack, SETTINGS, {}, 0);
  commuteBlocks(pack, { ...SETTINGS, minHomeHours: 48 }, {}, 0);
  for (const line of pack.lines) {
    weekendDaysOff(line, pack.bidPeriodStart);
    for (const trip of line.trips) {
      tripFactsOf(trip);
      tripReportUtc(pack, trip);
    }
  }
}

describe("results kept for speed", () => {
  it("let go of each pack once it's replaced, however many are loaded", async () => {
    // Each upload in its own call, so nothing but what's kept can still hold it.
    const load = (month: number) => {
      const pack = upload(month);
      runEverything(pack);
      return [new WeakRef(pack), new WeakRef(pack.lines[0]), new WeakRef(pack.lines[0].trips[0])];
    };
    const refs: WeakRef<object>[] = [];
    for (let month = 0; month < 6; month++) refs.push(...load(month));
    await settle();
    gc();
    await settle();
    gc();
    expect(refs.flatMap((r, i) => (r.deref() !== undefined ? [i] : []))).toEqual([]);
  });
});
