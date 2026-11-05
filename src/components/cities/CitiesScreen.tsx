"use client";

import { DateTime } from "luxon";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { RouteArc, SunDial } from "@/components/cities/CitySky";
import { CityMarkGlyph } from "@/components/results/CityMarkGlyph";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { ReadingProgress } from "@/components/ui/ReadingProgress";
import { coordinatesForAirport } from "@/lib/airport-coordinates";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { greatCircleNm } from "@/lib/globe/routes";
import { cityDaylight, cityStays, hoursFromBase, offsetWords, type CityStay } from "@/lib/city-guide";
import { bidMonthOf, cityMarks, CITY_RATING_STEPS, CITY_REASONS, hasSeasons, packCityFacts, seasonWords, type CityFacts } from "@/lib/city-ratings";
import { monthsWords, seasonMonths } from "@/lib/seasons";
import { fetchHotel } from "@/lib/hotel-client";
import { cityName } from "@/lib/city-names";
import { forecastWeather, typicalWeather, type DailyWeather, type TypicalWeather } from "@/lib/weather-client";
import type { BidPack } from "@/types/bidpack";
import type { HotelResult } from "@/types/hotel";
import type { CityMark, PreferenceProfile } from "@/types/preferences";

const gradeLabel = (score: number) => CITY_RATING_STEPS.find((x) => x.score === score)?.label ?? String(score);

const LABEL = "font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint";

/** The time now, ticking each minute (on the minute), for clocks. */
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

const localClock = (code: string, at: number) => {
  const zone = timezoneForAirport(code);
  return zone ? DateTime.fromMillis(at, { zone }).toFormat("HH:mm") : null;
};

/** Great-circle distance between two airports, nautical miles; null when either can't be placed. */
function routeNm(from: string, to: string): number | null {
  const a = coordinatesForAirport(from);
  const b = coordinatesForAirport(to);
  return a && b ? greatCircleNm({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }) : null;
}

type SortBy = "lines" | "rating" | "name";
const MARK_ORDER: Record<CityMark, number> = { love: 0, like: 1, dislike: 3, avoid: 4 };

/**
 * Every layover city in the pack — what it's like there now, its daylight, how the pack sends you there, and how you
 * rated it — with the whole story a tap away: weather, the hotel, every stay and which lines fly it.
 */
export function CitiesScreen({ bidPack, profile }: { bidPack: BidPack | null; profile: PreferenceProfile | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("city");
  const [sort, setSort] = useState<SortBy>("lines");
  const now = useNow();
  const facts = useMemo(() => (bidPack ? packCityFacts(bidPack) : []), [bidPack]);
  const bidMonth = bidPack ? bidMonthOf(bidPack) : null;
  const marks = useMemo(() => cityMarks(profile?.cityRatings, profile?.cityPreferences, bidMonth), [profile?.cityRatings, profile?.cityPreferences, bidMonth]);

  if (!bidPack) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <EmptyState title="No bid pack loaded" description="Upload this month’s bid pack to see its layover cities." actionLabel="Upload a bid pack" onAction={() => router.push("/upload")} />
      </div>
    );
  }

  const sorted = [...facts].sort((a, b) => {
    if (sort === "name") return cityName(a.code).localeCompare(cityName(b.code));
    if (sort === "rating") return (MARK_ORDER[marks[a.code] as CityMark] ?? 2) - (MARK_ORDER[marks[b.code] as CityMark] ?? 2) || b.lines - a.lines;
    return b.lines - a.lines || b.trips - a.trips;
  });
  const open = (code: string | null) => router.replace(code ? `/cities?city=${code}` : "/cities", { scroll: false });
  const selectedFacts = facts.find((f) => f.code === selected) ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <ReadingProgress />
      <PageHeader
        eyebrow={packEyebrow(bidPack)}
        title="Layover cities"
        description={`The ${facts.length} cities this pack lays you over in — the local time and daylight there, how often you'd go, and the whole picture a tap away.`}
        actions={
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SortBy)} className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-sm text-ink">
              <option value="lines">Most flown</option>
              <option value="rating">Your rating</option>
              <option value="name">Name</option>
            </select>
          </label>
        }
      />

      <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((f) => (
          <li key={f.code}>
            <CityCard facts={f} base={bidPack.base} mark={marks[f.code] ?? null} now={now} onOpen={() => open(f.code)} />
          </li>
        ))}
      </ul>

      {selectedFacts && (
        <Modal title={`${selectedFacts.code} · ${cityName(selectedFacts.code)}`} onClose={() => open(null)} wide>
          <CityPanel facts={selectedFacts} bidPack={bidPack} profile={profile} mark={marks[selectedFacts.code] ?? null} now={now} />
        </Modal>
      )}
    </div>
  );
}

function CityCard({ facts: f, base, mark, now, onOpen }: { facts: CityFacts; base: string; mark: CityMark | null; now: number; onOpen: () => void }) {
  const clock = localClock(f.code, now);
  const offset = hoursFromBase(f.code, base, now);
  const zone = timezoneForAirport(f.code);
  const sun = zone ? cityDaylight(f.code, DateTime.fromMillis(now, { zone }).toISODate()!) : null;
  return (
    <button type="button" onClick={onOpen} className="panel-glass hover-lift flex h-full w-full flex-col p-4 text-left">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-baseline gap-2">
          <span className="font-mono text-xl font-semibold text-ink">{f.code}</span>
          <CityMarkGlyph mark={mark} />
        </span>
        {clock && <span className="font-mono text-sm tabular-nums text-ink">{clock}</span>}
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate text-ink-muted">{cityName(f.code)}</span>
        <span className="shrink-0 text-xs text-ink-faint">{offsetWords(offset)}</span>
      </div>
      {sun && (
        <div className="mt-2 text-xs text-ink-muted">
          Sun up {sun.sunrise} &ndash; down {sun.sunset}
        </div>
      )}
      <div className="mt-auto pt-3 text-xs text-ink-muted">
        <span className="font-medium text-ink">{f.lines}</span> line{f.lines === 1 ? "" : "s"} &middot; {f.trips} trip{f.trips === 1 ? "" : "s"} &middot; usually {Math.round(f.medianHours)}h
      </div>
      {f.hotel && <div className="mt-1 truncate text-xs text-ink-faint">{f.hotel}</div>}
    </button>
  );
}

function CityPanel({ facts: f, bidPack, profile, mark, now }: { facts: CityFacts; bidPack: BidPack; profile: PreferenceProfile | null; mark: CityMark | null; now: number }) {
  const stays = useMemo(() => cityStays(bidPack, f.code), [bidPack, f.code]);
  const zone = timezoneForAirport(f.code);
  const today = zone ? DateTime.fromMillis(now, { zone }).toISODate()! : null;
  const sun = today ? cityDaylight(f.code, today) : null;
  const rating = profile?.cityRatings?.[f.code];
  const seasonal = hasSeasons(rating?.seasons);
  const bidMonth = bidMonthOf(bidPack);
  const fullDays = stays.reduce((a, s) => a + s.fullDays, 0);

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Fact label="Local time" value={localClock(f.code, now) ?? "—"} note={offsetWords(hoursFromBase(f.code, bidPack.base, now))} />
        <Fact label="Zulu" value={DateTime.fromMillis(now, { zone: "utc" }).toFormat("HH:mm")} note="UTC" />
        <Fact label="Sunrise" value={sun?.sunrise ?? "—"} note="today, local" />
        <Fact label="Sunset" value={sun?.sunset ?? "—"} note={sun ? `${sun.hours.toFixed(1)}h of daylight` : ""} />
      </section>

      <section className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div>
          <div className={LABEL}>
            From {bidPack.base}, {Math.round(routeNm(bidPack.base, f.code) ?? 0).toLocaleString()} nm
          </div>
          <div className="mt-2">
            <RouteArc from={bidPack.base} to={f.code} />
          </div>
        </div>
        <div className="flex flex-col items-center">
          <div className={LABEL}>The sky there now</div>
          <SunDial code={f.code} now={now} />
        </div>
      </section>

      <Weather code={f.code} bidPack={bidPack} stays={stays} now={now} />

      {f.hotel && <Hotel code={f.code} name={f.hotel} />}

      <section>
        <div className={LABEL}>In this pack</div>
        <p className="mt-1 text-sm text-ink-muted">
          {stays.length} stay{stays.length === 1 ? "" : "s"} on {f.trips} trip{f.trips === 1 ? "" : "s"}, flown by {f.lines} line{f.lines === 1 ? "" : "s"} &middot; {Math.round(f.minHours)}&ndash;{Math.round(f.maxHours)}h, usually {Math.round(f.medianHours)}h
          {fullDays > 0 ? ` · ${fullDays} full day${fullDays === 1 ? "" : "s"} there in all` : ""}
          {f.standbyDays > 0 ? ` · ${f.standbyDays} hotel standby day${f.standbyDays === 1 ? "" : "s"}` : ""}
        </p>
        <ul className="mt-3 divide-y divide-hairline rounded-lg border border-hairline">
          {stays.slice(0, 40).map((s, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-sm">
              <span className="font-mono font-semibold text-ink">#{s.tripNumber ?? "—"}</span>
              <span className="text-ink-muted">{s.arrive !== null && zone ? DateTime.fromMillis(s.arrive, { zone }).toFormat("ccc LLL d, HH:mm") : "date not placed"}</span>
              <span className="text-ink">{Math.round(s.hours)}h</span>
              {s.fullDays > 0 && <span className="text-layover">{s.fullDays} full day{s.fullDays === 1 ? "" : "s"}</span>}
              <span className="ml-auto text-xs text-ink-faint">
                Line{s.lineNumbers.length === 1 ? "" : "s"}{" "}
                {s.lineNumbers.slice(0, 8).map((n, k) => (
                  <span key={n}>
                    {k > 0 ? ", " : ""}
                    <Link href={`/results?line=${n}`} className="underline decoration-dotted underline-offset-2 hover:text-ink">
                      {n}
                    </Link>
                  </span>
                ))}
                {s.lineNumbers.length > 8 ? ` +${s.lineNumbers.length - 8}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className={LABEL}>Your take</div>
        <div className="mt-1 text-sm text-ink">
          {mark ? (
            <span className="inline-flex items-center gap-1.5">
              <CityMarkGlyph mark={mark} /> You {mark === "avoid" ? "avoid" : mark} {f.code}
            </span>
          ) : (
            <span className="text-ink-muted">You haven&rsquo;t rated {f.code}.</span>
          )}
          {seasonal && bidMonth !== null ? <span className="text-ink-muted"> in {DateTime.utc(2026, bidMonth, 1).toFormat("LLLL")}</span> : null}
          {rating?.reasons?.length ? <span className="text-ink-muted"> &middot; {rating.reasons.map((r) => CITY_REASONS.find((x) => x.tag === r)?.label ?? r).join(", ")}</span> : null}
        </div>
        {seasonal && <p className="mt-1 text-sm text-ink-muted">Usually {gradeLabel(rating!.score)}{seasonWords(f.code, rating!.seasons, gradeLabel)}.</p>}
        {rating?.note && <p className="mt-1.5 rounded-md bg-canvas/60 px-3 py-2 text-sm italic text-ink-muted">&ldquo;{rating.note}&rdquo;</p>}
        <Link href="/preferences" className="mt-2 inline-block text-sm font-medium text-accent underline decoration-dotted underline-offset-4">
          {mark ? "Change your rating" : "Rate it"} in Preferences
        </Link>
      </section>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      <div className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-ink">{value}</div>
      {note && <div className="text-xs text-ink-faint">{note}</div>}
    </div>
  );
}

function Weather({ code, bidPack, stays, now }: { code: string; bidPack: BidPack; stays: CityStay[]; now: number }) {
  const [typical, setTypical] = useState<TypicalWeather | null | undefined>(undefined);
  const [forecast, setForecast] = useState<DailyWeather[] | null>(null);
  const zone = timezoneForAirport(code);
  // Stays landing within the forecast's reach, by local date.
  const soonDates = useMemo(() => {
    const until = now + 15 * 86_400_000;
    return new Set(stays.filter((s) => s.arrive !== null && s.arrive >= now - 86_400_000 && s.arrive <= until && zone).map((s) => DateTime.fromMillis(s.arrive!, { zone: zone! }).toISODate()!));
  }, [stays, now, zone]);
  useEffect(() => {
    let alive = true;
    (bidPack.bidPeriodStart ? typicalWeather(code, bidPack.bidPeriodStart, bidPack.bidPeriodDays) : Promise.resolve(null)).then((t) => alive && setTypical(t));
    if (soonDates.size) forecastWeather(code).then((f) => alive && setForecast(f));
    return () => {
      alive = false;
    };
  }, [code, bidPack.bidPeriodStart, bidPack.bidPeriodDays, soonDates]);
  const upcoming = forecast?.filter((d) => soonDates.has(d.date)) ?? [];

  return (
    <section>
      <div className={LABEL}>Weather</div>
      {typical === undefined ? (
        <p className="mt-1 text-sm text-ink-faint">Looking it up…</p>
      ) : typical === null ? (
        <p className="mt-1 text-sm text-ink-faint">No weather on record for {code}.</p>
      ) : (
        <p className="mt-1 text-sm text-ink">
          Over this bid month&rsquo;s dates last year: highs around <span className="font-semibold">{typical.avgHighF}°F</span>, lows around{" "}
          <span className="font-semibold">{typical.avgLowF}°F</span>; rain on {typical.wetDays} of {typical.days} days
          {typical.snowDays > 0 ? `, snow on ${typical.snowDays}` : ""}.
        </p>
      )}
      {upcoming.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {upcoming.map((d) => (
            <li key={d.date} className="rounded-md border border-hairline bg-canvas/50 px-2.5 py-1.5 text-sm">
              <span className="text-ink-muted">{DateTime.fromISO(d.date).toFormat("ccc LLL d")}</span>{" "}
              <span className="font-mono font-semibold text-ink">
                {Math.round(d.highF ?? 0)}° / {Math.round(d.lowF ?? 0)}°
              </span>
              {(d.precipIn ?? 0) >= 0.1 && <span className="text-ink-muted"> · rain</span>}
              {(d.snowIn ?? 0) > 0 && <span className="text-ink-muted"> · snow</span>}
            </li>
          ))}
        </ul>
      )}
      <SeasonsHere code={code} />
      <p className="mt-1.5 text-[11px] text-ink-faint">Weather from Open-Meteo; seasons from NOAA station records, 2006–2025.</p>
    </section>
  );
}

/** Which months are winter and summer here — what a seasonal grade covers in this city. */
function SeasonsHere({ code }: { code: string }) {
  const s = seasonMonths(code);
  if (!s) return null;
  return (
    <p className="mt-1.5 text-sm text-ink-muted">
      {s.winter.length ? <>Winter here is {monthsWords(s.winter)}, when most nights freeze</> : <>No winter to speak of here &mdash; nights rarely freeze</>}; summer is {monthsWords(s.summer)}.
    </p>
  );
}

function Hotel({ code, name }: { code: string; name: string }) {
  const [hotel, setHotel] = useState<HotelResult | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchHotel(code, name).then((r) => alive && setHotel(r.hotel));
    return () => {
      alive = false;
    };
  }, [code, name]);
  return (
    <section>
      <div className={LABEL}>Hotel</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium text-ink">{hotel?.name ?? name}</span>
        {hotel?.rating != null && (
          <span className="text-ink-muted">
            ★ {hotel.rating.toFixed(1)}
            {hotel.userRatingCount ? ` (${hotel.userRatingCount.toLocaleString()})` : ""}
          </span>
        )}
        {hotel?.formattedAddress && <span className="text-ink-faint">{hotel.formattedAddress}</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 text-sm">
        {hotel?.googleMapsUri && (
          <a href={hotel.googleMapsUri} target="_blank" rel="noreferrer" className="font-medium text-accent underline decoration-dotted underline-offset-4">
            Map ↗
          </a>
        )}
        <Link href="/hotel-ratings" className="font-medium text-accent underline decoration-dotted underline-offset-4">
          What&rsquo;s nearby and what reviewers say
        </Link>
      </div>
    </section>
  );
}
