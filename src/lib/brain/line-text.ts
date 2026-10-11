import type { BidPack, Line, Trip } from "@/types/bidpack";

/**
 * A line's trips as text a pilot reads at a glance — the headline route with
 * deadheads and standby marked, and the full duty-by-duty detail — for the
 * interview's line choices, the readback, and prompts to the brain.
 */

const hm = (s: string | undefined) => (s && s.length >= 4 ? `${s.slice(0, 2)}:${s.slice(2, 4)}` : "?");

export function tripDateLabel(bidPack: Pick<BidPack, "bidPeriodStart">, dayIndex: number | null): string {
  if (!bidPack.bidPeriodStart || dayIndex === null) return "";
  const d = new Date(`${bidPack.bidPeriodStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "Oct 7 · 10d · 60.6 cr · ANC → DH SEA → DH CDG → … → standby ×3 at KIX → DH ANC" */
export function tripHeadline(bidPack: Pick<BidPack, "bidPeriodStart">, t: Trip): string {
  const stops: string[] = [];
  let standbyRun = 0;
  let standbyAt = "";
  const flush = () => {
    if (standbyRun) stops.push(`standby ×${standbyRun} at ${standbyAt}`);
    standbyRun = 0;
  };
  t.schedule.forEach((d, i) => {
    const legs = d.legs;
    if (legs.length && legs.every((l) => l.isStandby)) {
      standbyRun++;
      standbyAt = legs[0].depAirport;
      return;
    }
    flush();
    legs.filter((l) => !l.isStandby).forEach((l, j) => {
      if (i === 0 && j === 0) stops.push(l.depAirport);
      stops.push(`${l.isDeadhead ? "DH " : ""}${l.arrAirport}`);
    });
  });
  flush();
  const route = stops.length ? stops.join(" → ") : t.layoverCities.join(" · ");
  return [tripDateLabel(bidPack, t.startDayIndex), `${t.days}d`, `${t.creditHours.toFixed(1)} cr`, route].filter(Boolean).join(" · ");
}

/** The trip duty by duty: every leg (deadheads with their airline flight, ground transport named), standby, and each layover's length and hotel. */
export function tripDuties(t: Trip): string[] {
  return t.schedule.map((d, i) => {
    const legs = d.legs.map((l) =>
      l.isStandby
        ? `Hotel standby ${l.depAirport} ${hm(l.depTimeLocal)}–${hm(l.arrTimeLocal)}`
        : `${/^GT/.test(l.flightNumber) ? "Ground transport" : l.isDeadhead ? `DH ${l.flightNumber}` : `FX ${l.flightNumber}`} ${l.depAirport} ${hm(l.depTimeLocal)} → ${l.arrAirport} ${hm(l.arrTimeLocal)}`
    );
    const lay = d.layover ? ` ⇒ ${d.layover.city} ${Math.round(d.layover.hours)}h${d.layover.hotelName ? ` · ${d.layover.hotelName}` : ""}` : "";
    return `${i + 1}. ${legs.join(" · ") || "—"}${lay}`;
  });
}

/** One line in a sentence: days off, credit, and each trip's headline. */
export function lineSummary(bidPack: Pick<BidPack, "bidPeriodStart">, line: Line): string {
  return `${line.daysOff} days off, ${line.totalCreditHours.toFixed(1)} credit, ${line.trips.length} ${line.trips.length === 1 ? "trip" : "trips"}: ${line.trips.map((t) => tripHeadline(bidPack, t)).join(" | ")}`;
}
