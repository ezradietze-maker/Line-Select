import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { backupsOf, type ScheduledFlight, type TravelAnswer } from "@/lib/flights/itineraries";
import { flightsForTrip, type FlightAnswers } from "@/lib/flights/trip-travel";
import type { Trip } from "@/types/bidpack";

/**
 * A trip's real airline commute, for a commuter whose flights were looked
 * up: how many flights still get them to work in time (to base, or straight
 * to where the flying starts) and the last one that does, and when the first
 * flight home lands — airlines and, from the pilot's own bid pack, FedEx
 * flights on the jumpseat. Times are local at the airport they happen at.
 */

function at(ms: number, airport: string | undefined): string {
  const zone = (airport && timezoneForAirport(airport)) || "UTC";
  return `${DateTime.fromMillis(ms, { zone }).toFormat("ccc LLL d, HH:mm")} (L)`;
}

const route = (it: ScheduledFlight[]) => [it[0].from, ...it.map((f) => f.to)].join("–");
const flights = (it: ScheduledFlight[]) => it.map((f) => f.n).join(" + ");

/** "· 2 on the FedEx jumpseat", when any way rides one. */
function Jumpseats({ a }: { a: TravelAnswer }) {
  if (!a.jumpseatWays) return null;
  return (
    <span className="text-accent">
      {" "}
      &middot; {a.jumpseatWays === a.options ? (a.options === 1 ? "on the FedEx jumpseat" : "all on the FedEx jumpseat") : `${a.jumpseatWays} on the FedEx jumpseat`}
    </span>
  );
}

function Row({ label, children, warn = false }: { label: string; children: React.ReactNode; warn?: boolean }) {
  return (
    <li className="flex gap-2">
      <span className="w-28 shrink-0 text-ink-muted">{label}</span>
      <span className={warn ? "text-bad" : "text-ink"}>{children}</span>
    </li>
  );
}

function Getting({ label, a, to }: { label: string; a: TravelAnswer; to: string }) {
  if (a.options === 0 || a.lastDeparture === null)
    return (
      <Row label={label} warn>
        Nothing on the airlines or the FedEx flights in this pack gets you to {to} in time &mdash; go a day early, or find another jumpseat.
      </Row>
    );
  const b = backupsOf(a);
  return (
    <Row label={label} warn={b < 2}>
      {b === 0 ? `Only one flight into ${to} makes it — no backup` : `${b + 1} flights into ${to} make it — ${b} backup${b === 1 ? "" : "s"}`}
      <Jumpseats a={a} />
      <span className="text-ink-muted"> &middot; last that makes it leaves {at(a.lastDeparture, a.best?.[0].from)}</span>
      {a.best && (
        <span className="text-ink-muted">
          {" "}
          &middot; quickest {route(a.best)} ({flights(a.best)}){a.best.at(-1)!.to !== to && `, then drive to ${to}`}
        </span>
      )}
    </Row>
  );
}

function Going({ label, a, from }: { label: string; a: TravelAnswer; from?: string }) {
  if (a.options === 0 || a.firstArrival === null)
    return (
      <Row label={label} warn>
        Nothing home on the airlines or this pack&rsquo;s FedEx flights within a day of being free.
      </Row>
    );
  const last = a.best?.at(-1);
  return (
    <Row label={label}>
      First lands home {at(a.firstArrival, last?.to)}
      <span className="text-ink-muted">
        {" "}
        &middot; {a.options} way{a.options === 1 ? "" : "s"} home
      </span>
      <Jumpseats a={a} />
      {a.best && (
        <span className="text-ink-muted">
          {" "}
          &middot; quickest {from && a.best[0].from !== from && `drive to ${a.best[0].from}, then `}
          {route(a.best)} ({flights(a.best)})
        </span>
      )}
    </Row>
  );
}

export function TripCommuteFlights({
  answers,
  trip,
  base,
  frontCity,
  backCity,
}: {
  answers: FlightAnswers | null | undefined;
  trip: Trip;
  base: string;
  frontCity?: string | null;
  backCity?: string | null;
}) {
  const t = flightsForTrip(answers ?? undefined, trip);
  if (!t) return null;
  return (
    <div className="mt-2 rounded-lg border border-hairline bg-canvas/60 px-3 py-2 text-xs">
      <p className="mb-1 font-medium text-ink">Commute flights</p>
      <ul className="space-y-0.5">
        {t.toBase && <Getting label={`To ${base}`} a={t.toBase} to={base} />}
        {t.deviateOut && frontCity && <Getting label={`Straight to ${frontCity}`} a={t.deviateOut} to={frontCity} />}
        {t.homeFromBase && <Going label={`Home from ${base}`} a={t.homeFromBase} />}
        {t.deviateHome && backCity && <Going label={`Home from ${backCity}`} a={t.deviateHome} from={backCity} />}
      </ul>
    </div>
  );
}
