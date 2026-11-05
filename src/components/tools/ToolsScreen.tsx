"use client";

import { DateTime } from "luxon";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { TripCommuteFlights } from "@/components/results/TripCommuteFlights";
import { FlipText } from "@/components/ui/FlipText";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { WorldMap } from "@/components/ui/WorldMap";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { isDaylight, nightPath, project } from "@/lib/globe/flat-map";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { tripDateLabel } from "@/lib/brain/line-text";
import { cityDaylight, offsetWords } from "@/lib/city-guide";
import { cityName } from "@/lib/city-names";
import { packCityFacts } from "@/lib/city-ratings";
import { cachedFlightAnswers, lookUpFlights, travelParamsFor } from "@/lib/flights/client";
import { flightsForTrip, type FlightAnswers } from "@/lib/flights/trip-travel";
import { tripReportUtc } from "@/lib/trip-anchor";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import { rankLinesWithTrips } from "@/lib/scoring-v2/trip-score";
import type { BidPack, Trip } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

const LABEL = "font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint";

/** The time now, ticking each minute on the minute. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let interval: number | undefined;
    const first = window.setTimeout(() => {
      setNow(Date.now());
      interval = window.setInterval(() => setNow(Date.now()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(first);
      if (interval) window.clearInterval(interval);
    };
  }, []);
  return now;
}

/** A pilot's tools: the time everywhere the pack goes, and the airline flights to and from each trip. */
export function ToolsScreen({ bidPack, profile }: { bidPack: BidPack | null; profile: PreferenceProfile | null }) {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeader eyebrow={packEyebrow(bidPack) ?? "Tools"} title="Tools" description="The time everywhere your pack goes, and the airline flights to and from each trip." />
      <WorldClock bidPack={bidPack} profile={profile} />
      <CommutePlanner bidPack={bidPack} profile={profile} />
    </div>
  );
}

/** Base, home, Zulu and every layover city — what time it is there now, or at a time you pick. */
function WorldClock({ bidPack, profile }: { bidPack: BidPack | null; profile: PreferenceProfile | null }) {
  const now = useNow();
  const base = bidPack?.base ?? "MEM";
  const home = profile?.isCommuter && profile.commuteFrom ? profile.commuteFrom : null;
  const codes = useMemo(() => {
    const cities = bidPack ? packCityFacts(bidPack).map((c) => c.code) : [];
    return [...new Set([base, ...(home ? [home] : []), ...cities])].filter((c) => timezoneForAirport(c));
  }, [bidPack, base, home]);
  // A time to look at instead of now: entered on one clock (a city's or Zulu's).
  const [pickClock, setPickClock] = useState<string>(base);
  const [pickTime, setPickTime] = useState("");
  const at = useMemo(() => {
    if (!pickTime) return now;
    const zone = pickClock === "Z" ? "utc" : (timezoneForAirport(pickClock) ?? "utc");
    const [h, m] = pickTime.split(":").map(Number);
    return DateTime.fromMillis(now, { zone }).set({ hour: h, minute: m, second: 0, millisecond: 0 }).toMillis();
  }, [pickTime, pickClock, now]);
  const baseOffset = (zone: string) => (DateTime.fromMillis(at, { zone }).offset - DateTime.fromMillis(at, { zone: timezoneForAirport(base) ?? "utc" }).offset) / 60;

  return (
    <section className="panel-glass mt-6 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">World clock</h2>
          <p className="mt-0.5 text-sm text-ink-muted">{pickTime ? "At the time you picked." : "Now, everywhere your pack goes."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">What time is it when it&rsquo;s</span>
          <input type="time" value={pickTime} onChange={(e) => setPickTime(e.target.value)} className="rounded-md border border-hairline bg-surface px-2 py-1.5 font-mono text-sm text-ink" aria-label="Time to convert" />
          <span className="text-ink-muted">in</span>
          <select value={pickClock} onChange={(e) => setPickClock(e.target.value)} className="rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-ink" aria-label="Whose clock">
            <option value="Z">Zulu</option>
            {codes.map((c) => (
              <option key={c} value={c}>
                {c} · {cityName(c)}
              </option>
            ))}
          </select>
          {pickTime && (
            <button type="button" onClick={() => setPickTime("")} className="text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink">
              Back to now
            </button>
          )}
        </div>
      </div>

      <DayNightMap codes={codes} base={base} home={home} at={at} />

      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <ClockTile code="Z" name="Zulu" time={DateTime.fromMillis(at, { zone: "utc" })} note="UTC" />
        {codes.map((c) => {
          const zone = timezoneForAirport(c)!;
          const t = DateTime.fromMillis(at, { zone });
          const sun = cityDaylight(c, t.toISODate()!);
          const daylight = sun ? t.toFormat("HH:mm") >= sun.sunrise && t.toFormat("HH:mm") < sun.sunset : null;
          const tag = c === base ? "base" : c === home ? "home" : null;
          return <ClockTile key={c} code={c} name={cityName(c)} time={t} note={tag ? `${tag}${c === base ? "" : ` · ${offsetWords(baseOffset(zone)).replace(" from base", "")}`}` : offsetWords(baseOffset(zone))} daylight={daylight} />;
        })}
      </ul>
    </section>
  );
}

/** The world at that moment: the real night side, and every pack city lit or in the dark. */
function DayNightMap({ codes, base, home, at }: { codes: string[]; base: string; home: string | null; at: number }) {
  const places = codes.flatMap((c) => {
    const p = coordinatesForAirport(c);
    return p ? [{ code: c, at: { lat: p[0], lon: p[1] } }] : [];
  });
  const lit = places.filter((p) => isDaylight(p.at, at)).length;
  return (
    <div className="mx-auto mt-4 max-w-2xl">
      <WorldMap label={`Day and night across the world: ${lit} of your ${places.length} cities in daylight`}>
        <path d={nightPath(at)} fill="#000" opacity={0.26} />
        {places.map((p) => {
          const [x, y] = project(p.at);
          const day = isDaylight(p.at, at);
          const mine = p.code === base || p.code === home;
          return (
            <g key={p.code}>
              {day && <circle cx={x} cy={y} r={mine ? 5.5 : 4} fill="var(--color-accent)" opacity={0.22} />}
              <circle cx={x} cy={y} r={mine ? 2.6 : 1.8} fill={day ? "var(--color-accent)" : "var(--color-ink-muted)"} />
              {mine && (
                <text x={x + 4} y={y - 3} fontSize={7} fontFamily="var(--font-mono)" fill="var(--color-ink)">
                  {p.code}
                </text>
              )}
            </g>
          );
        })}
      </WorldMap>
      <p className="mt-1.5 text-xs text-ink-faint">
        {lit} of your {places.length} cities in daylight &middot; the shaded side is night
      </p>
    </div>
  );
}

function ClockTile({ code, name, time, note, daylight = null }: { code: string; name: string; time: DateTime; note: string; daylight?: boolean | null }) {
  return (
    <li className="rounded-lg border border-hairline bg-canvas/50 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-ink">{code}</span>
        {daylight !== null && <span className="text-xs text-ink-faint" title={daylight ? "Sun's up there" : "Dark there"}>{daylight ? "☀" : "☾"}</span>}
      </div>
      <div className="mt-0.5 font-mono text-2xl font-semibold tabular-nums text-ink">
        <FlipText text={time.toFormat("HH:mm")} />
      </div>
      <div className="truncate text-xs text-ink-muted">
        {time.toFormat("ccc d")} &middot; {name}
      </div>
      <div className="truncate text-[11px] text-ink-faint">{note}</div>
    </li>
  );
}

/** Why a trip shows no flights: it's already flown, or it can't be placed on a date, or the lookup found nothing. */
function whyNoFlights(bidPack: BidPack, trip: Trip): string {
  const report = tripReportUtc(bidPack, trip);
  if (report === null) return "This trip can’t be placed on a date, so there are no flights to look up.";
  if (report < Date.now()) return "This trip is already in the past — flights are looked up for trips still to come.";
  return "No airline flights found for this trip yet.";
}

/** Each trip of a chosen line, with the airline flights from home to its report and from its release back home. */
function CommutePlanner({ bidPack, profile }: { bidPack: BidPack | null; profile: PreferenceProfile | null }) {
  const model = profile?.pilotModel ?? null;
  const params = useMemo(() => (bidPack && model ? travelParamsFor(bidPack, model) : null), [bidPack, model]);
  const ranked = useMemo(() => (bidPack && model ? rankLinesWithTrips(bidPack, model).slice(0, 30) : []), [bidPack, model]);
  const [lineId, setLineId] = useState<string | null>(null);
  const line = bidPack?.lines.find((l) => l.id === (lineId ?? ranked[0]?.lineId)) ?? null;
  const [answers, setAnswers] = useState<FlightAnswers | null>(() => (bidPack && model && typeof window !== "undefined" ? cachedFlightAnswers(bidPack, model) : null));
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    if (!bidPack || !model || !params) return;
    let alive = true;
    // The same lookup the rankings run — the pilot's best lines, kept on this device for a few days.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLooking(true);
    lookUpFlights(bidPack, model).then((a) => {
      if (!alive) return;
      setLooking(false);
      if (a) setAnswers(a);
    });
    return () => {
      alive = false;
    };
  }, [bidPack, model, params]);

  return (
    <section className="panel-glass mt-6 p-4 sm:p-5">
      <h2 className="font-display text-xl font-semibold text-ink">Commute planner</h2>
      {!bidPack ? (
        <p className="mt-1 text-sm text-ink-muted">
          <Link href="/upload" className="text-accent underline decoration-dotted underline-offset-4">
            Upload this month&rsquo;s bid pack
          </Link>{" "}
          to plan its commutes.
        </p>
      ) : !model ? (
        <p className="mt-1 text-sm text-ink-muted">
          Finish the{" "}
          <Link href="/preferences" className="text-accent underline decoration-dotted underline-offset-4">
            interview
          </Link>{" "}
          first &mdash; it&rsquo;s where your home airport and commute buffers come from.
        </p>
      ) : !params ? (
        <p className="mt-1 text-sm text-ink-muted">
          You live at base, so there&rsquo;s no commute to plan. If you commute, add your home airport in{" "}
          <Link href="/preferences" className="text-accent underline decoration-dotted underline-offset-4">
            Preferences
          </Link>
          .
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-muted">
            Real airline flights from {params.homeAirports.join(" or ")} to each trip&rsquo;s report at {bidPack.base} &mdash; or straight to where its flying starts after a
            front-end deadhead &mdash; and back home after release, with backups. Your top {ranked.length} lines are covered.
          </p>
          <label className="mt-4 block text-sm">
            <span className="text-ink-muted">Line</span>
            <select value={line?.id ?? ""} onChange={(e) => setLineId(e.target.value)} className="mt-1 block w-full max-w-sm rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink">
              {ranked.map((r, i) => (
                <option key={r.lineId} value={r.lineId}>
                  Line {r.lineNumber} — your #{i + 1}
                </option>
              ))}
            </select>
          </label>
          {looking && !answers && <p className="mt-3 text-sm text-ink-faint">Checking the airline schedules…</p>}
          {line && (
            <ul className="mt-4 space-y-3">
              {line.trips.map((t, i) => {
                const f = computeTripFacts(t);
                return (
                  <li key={`${t.id}-${i}`} className="rounded-lg border border-hairline p-3">
                    <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                      <span className="font-mono font-semibold text-ink">#{t.pairingNumber ?? "—"}</span>
                      <span className="text-ink-muted">{tripDateLabel(bidPack, t.startDayIndex)}</span>
                      <span className="text-ink-muted">{t.days}-day</span>
                      <span className="text-ink-faint">{t.layoverCities.join(" · ")}</span>
                    </div>
                    {answers && flightsForTrip(answers, t) ? (
                      <TripCommuteFlights answers={answers} trip={t} base={bidPack.base} frontCity={f.front?.city} backCity={f.back?.city} />
                    ) : !looking ? (
                      <p className="mt-1 text-xs text-ink-faint">{whyNoFlights(bidPack, t)}</p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      <div className={`mt-4 ${LABEL}`}>Airline schedules move &mdash; check with the airline before you go.</div>
    </section>
  );
}
