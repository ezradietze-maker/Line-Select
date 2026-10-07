import type { Trip } from "@/types/bidpack";

/**
 * Whether a leg is a deadhead, from its flight number alone — the only way
 * the bid pack ever says so. A FedEx flight is a bare number ("2681"); a
 * ride on another carrier carries that carrier's two-character code in
 * front ("DL2939", "UA5780", or "GT9999" for a cab between airports). Across
 * every leg of seven real packs those are the only two shapes.
 *
 * The "DH" printed in the MEAL column is not a deadhead flag — it means
 * dinner, hot (as "BH" is breakfast, hot). Reading it as a deadhead used to
 * turn real FedEx flying into deadheads.
 */
export function isDeadheadFlightNumber(flightNumber: string): boolean {
  return /^(?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\d{1,5}$/i.test(flightNumber.trim());
}

/**
 * Re-applies the rule above to a trip saved by an older version of the
 * reader, which took the meal column's "DH" for a deadhead. Saved packs
 * aren't re-read from the PDF, so without this a pilot who uploaded before
 * the fix would keep seeing FedEx flights marked as deadheads. Ground-duty
 * rows (hotel standby) are never deadheads.
 */
export function backfillDeadheads(trip: Trip): Trip {
  if (trip.schedule.length === 0) return trip;
  let changed = false;
  const schedule = trip.schedule.map((duty) => ({
    ...duty,
    legs: duty.legs.map((leg) => {
      const isDeadhead = !leg.isStandby && isDeadheadFlightNumber(leg.flightNumber);
      if (isDeadhead !== leg.isDeadhead) changed = true;
      return isDeadhead === leg.isDeadhead ? leg : { ...leg, isDeadhead };
    }),
  }));
  const deadheadLegs = schedule.flatMap((d) => d.legs).filter((l) => l.isDeadhead).length;
  if (!changed && deadheadLegs === trip.deadheadLegs) return trip;
  return { ...trip, schedule, deadheadLegs };
}
