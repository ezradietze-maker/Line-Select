import { DateTime } from "luxon";
import { pairingDate } from "@/lib/view-add";
import type { BidPack, Trip } from "@/types/bidpack";

/**
 * A made-up open-time list for this pack, for trying the page. It is NOT what VIPS prints: nobody here has seen that. It
 * mixes the formats the parser reads, and adds a row of each kind it can't use, so the pilot sees how those come back.
 */
export function samplePaste(pack: BidPack, count = 12): string {
  const seen = new Set<string>();
  const trips: Trip[] = [];
  for (const t of [...(pack.openPairings ?? []), ...pack.lines.flatMap((l) => l.trips)]) {
    if (!t.pairingNumber || !t.schedule.length || !pairingDate(t, pack)) continue;
    const key = `${t.pairingNumber}@${t.startDayIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    trips.push(t);
  }
  // Spread across the pack, not the first line's trips.
  const step = Math.max(1, Math.floor(trips.length / count));
  const rows = trips
    .filter((_, i) => i % step === 0)
    .slice(0, count)
    .map((t, i) => {
      const date = DateTime.fromISO(pairingDate(t, pack)!, { zone: "utc" });
      const number = t.pairingNumber!;
      if (i % 3 === 0) return `Trip ${number}  ${date.toFormat("ddLLL").toUpperCase()}  CH ${t.creditHours.toFixed(1)}  TAFB ${t.tafbHours.toFixed(1)}`;
      if (i % 3 === 1) return `${date.toFormat("LLL d")} ${number}`;
      return `${number} ${date.toFormat("L/d")}`;
    });
  return ["OPEN TIME (made-up sample, not a real VIPS list)", ...rows, "BAS 0800-2000 Tuesday", "9999 12/31", "TRIP ?? sometime next week"].join("\n");
}
