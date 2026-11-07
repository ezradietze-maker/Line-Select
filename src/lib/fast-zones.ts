import { IANAZone } from "luxon";

/**
 * Time-zone offsets, remembered. Luxon works out a zone's offset at an instant by asking the browser's date
 * formatter, which is slow — and re-ranking a big pack asks it hundreds of thousands of times for the same few
 * airports and days (a 489-line pack's swap spent about 4 of its 5 seconds here on a slowed phone). Every real
 * time-zone change happens on a 15-minute boundary, so a zone's offset is the same for a whole quarter hour: the
 * first answer in each quarter hour is kept and reused. The answers are exactly Luxon's own (`fast-zones.test.ts`
 * checks every airport around every clock change).
 *
 * Installed once, by importing this module: `airport-timezones.ts` does, so every zone lookup in the app goes
 * through it.
 */

const QUARTER_HOUR = 15 * 60 * 1000;
type OffsetFn = (this: IANAZone, ts: number) => number;
const proto = IANAZone.prototype as IANAZone & { offset: OffsetFn; __offsetsRemembered?: OffsetFn };

if (!proto.__offsetsRemembered) {
  const original = proto.offset;
  const byZone = new Map<string, Map<number, number>>();
  proto.__offsetsRemembered = original;
  proto.offset = function (this: IANAZone, ts: number): number {
    if (!Number.isFinite(ts)) return original.call(this, ts);
    let zone = byZone.get(this.name);
    if (!zone) byZone.set(this.name, (zone = new Map()));
    const slot = Math.floor(ts / QUARTER_HOUR);
    let offset = zone.get(slot);
    if (offset === undefined) {
      offset = original.call(this, ts);
      zone.set(slot, offset);
    }
    return offset;
  };
}

/** Luxon's own, uncached offset — for checking the cache against. */
export function originalOffset(zone: IANAZone, ts: number): number {
  return (proto.__offsetsRemembered ?? proto.offset).call(zone, ts);
}
