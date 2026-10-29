"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { hasHotelQualityDetails, HotelQualityDetails } from "@/components/hotels/HotelQualityDetails";
import { CircadianInfo } from "@/components/results/CircadianInfo";
import { CircadianStars } from "@/components/results/CircadianStars";
import { TimeModeToggle } from "@/components/results/TimeModeToggle";
import { TripCommuteFlights } from "@/components/results/TripCommuteFlights";
import { ChevronDownIcon, StarIcon } from "@/components/ui/icons";
import { TripScorePanel } from "@/components/results/TripScorePanel";
import { RestPlan } from "@/components/results/SleepPlan";
import { TripPicture, tripPictureDays } from "@/components/results/TripPicture";
import { TripDayDetail } from "@/components/results/TripDayDetail";
import { CreditHours } from "@/components/results/TripMarks";
import { planTripSleep, type LayoverSleepPlan } from "@/lib/sleep-plan";
import { tripKey, type TripScore } from "@/lib/scoring-v2/trip-score";
import { hubTurnsOf, summarizeHubTurns } from "@/lib/metrics/hub-turns";
import { Modal } from "@/components/ui/Modal";
import { computeCircadianAssessment } from "@/lib/circadian";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import { fetchHotel } from "@/lib/hotel-client";
import { displayHotelName } from "@/lib/hotels/hotel-names";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import { loadTimeMode, saveTimeMode } from "@/lib/time-mode-storage";
import { computeTripAnalytics } from "@/lib/trip-analytics";
import { dateLabel, dayStats, hm, tripBlockMinutes, tripDayDate, tripDeadheadBlockMinutes } from "@/lib/trip-day-stats";
import { type TimeMode, type TimelineDay } from "@/lib/trip-timeline";
import type { Trip } from "@/types/bidpack";
import type { HotelResult } from "@/types/hotel";
import type { CityMark } from "@/types/preferences";

const REPORT_LABELS: Record<Trip["reportTime"], string> = {
  early: "Early",
  afternoon: "Afternoon",
  evening: "Evening",
};

/** "(L)" after a local clock time, "(Z)" after a Zulu one — so no time on the trip view is ever ambiguous. */
const zoneTag = (mode: TimeMode) => (mode === "zulu" ? "(Z)" : "(L)");

const LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint";

const LAYOVER_TOOLTIP =
  "Layover / hotel — real time from block-in to hotel pickup for the next departure. Not exactly when you’ll sleep, since that’s down to you and the jet lag.";

const STANDBY_TOOLTIP =
  "Hotel standby — you sit on call at the layover hotel for the day. It pays the guaranteed standby credit, but no flight is flown unless you’re called out.";

interface InsightChip {
  label: string;
  value: string;
  title: string;
  tone?: "warn";
}

/**
 * A compact read of `computeTripAnalytics` — real per-leg arithmetic. Each
 * chip only appears when its underlying field is non-null and clears a
 * "worth mentioning" bar, so a plain, unremarkable trip shows nothing rather
 * than a row of zeros.
 */
function TripInsights({ trip, bidPeriodStart, base }: { trip: Trip; bidPeriodStart: string | null; base?: string }) {
  const a = computeTripAnalytics(trip);
  const chips: InsightChip[] = [];

  // Hub turns by name, the way pilots talk about them (lib/metrics/hub-turns.ts).
  const hubs = bidPeriodStart && base ? summarizeHubTurns(hubTurnsOf([trip], { bidPeriodStart, base })) : null;
  if (hubs?.all) {
    chips.push({
      label: "Hub turns",
      value: `×${hubs.all} · ${hubs.hubs.join(", ")}${hubs.night === hubs.all ? ", nights" : hubs.night ? `, ${hubs.night} at night` : ", by day"}${hubs.withRestHotel ? " · crew-rest hotel" : ""}`,
      title: "Flying into a sort hub, sitting while the packages are sorted, then flying back out. A night hub turn sits through the small hours; on long sits the crew gets a crew-rest hotel, a short airport stay for a nap.",
    });
  }

  if (a.creditPerTafbHour !== null) {
    chips.push({
      label: "Credit per day away",
      value: `${(a.creditPerTafbHour * 24).toFixed(1)}h`,
      title: "Credit hours earned per 24 hours away from base — this trip’s own pay-per-day-away rate, independent of how long the trip runs.",
    });
  }

  if (a.totalTimezoneCrossingMinutes !== null && a.totalTimezoneCrossingMinutes >= 60) {
    const netHours = (a.netTimezoneMinutes ?? 0) / 60;
    const direction = netHours > 0.5 ? "eastbound" : netHours < -0.5 ? "westbound" : "round-trip";
    chips.push({
      label: "Time zones",
      value: `${(a.totalTimezoneCrossingMinutes / 60).toFixed(1)}h, ${direction}`,
      title: "Total time-zone distance crossed across every leg (both directions added together), and which way the trip nets out overall.",
    });
  }

  if (a.avgSleepOpportunityHours !== null) {
    chips.push({
      label: "Avg sleep window",
      value: `${a.avgSleepOpportunityHours.toFixed(1)}h`,
      title: "Block-in to the hotel pickup for the next duty, averaged over the trip’s layovers — the real window at the hotel, from the pack’s own printed pickup times.",
    });
  }

  if (a.dutyToBlockRatio !== null && a.dutyToBlockRatio >= 1.1) {
    chips.push({
      label: "Duty ÷ flying",
      value: `${a.dutyToBlockRatio.toFixed(1)}×`,
      title: "Total duty time divided by the block you actually fly (deadheads don’t count as flying) — higher means more of the day is ground time, connections and riding than flying.",
    });
  }

  if (a.backToBackRedEyeDuties > 0) {
    chips.push({
      label: "Back-to-back red-eyes",
      value: String(a.backToBackRedEyeDuties),
      tone: "warn",
      title: "Consecutive duty periods that each include a red-eye (00:00-05:00 local) departure or arrival — compounding fatigue risk rather than one bad night followed by recovery.",
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span
          key={chip.label}
          title={chip.title}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
            chip.tone === "warn" ? "border-warn/40 bg-warn-soft text-warn" : "border-hairline bg-surface-raised/60 text-ink-muted"
          }`}
        >
          {chip.label} <span className="font-mono font-medium text-readout">{chip.value}</span>
        </span>
      ))}
    </div>
  );
}

function Readout({ label, value, note, tone = "text-readout", title }: { label: string; value: string; note?: string; tone?: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className={`${LABEL} truncate`}>{label}</div>
      <div className={`truncate font-mono text-xs font-semibold ${tone}`}>
        {value}
        {note && <span className="ml-1 text-[10px] font-normal text-ink-muted">{note}</span>}
      </div>
    </div>
  );
}

/**
 * Everything about the trip as a whole, above its chart: its number and
 * length, the whole route stop by stop (layover cities lit, through-stops
 * dim), when it reports and when it's done, and the numbers pilots compare
 * trips by.
 */
function TripHeader({
  trip,
  days,
  mode,
  bidPeriodStart,
  homeBaseOffsetMinutes,
  carryOverCreditHours,
}: {
  trip: Trip;
  days: TimelineDay[];
  mode: TimeMode;
  bidPeriodStart: string | null;
  homeBaseOffsetMinutes: number | null;
  /** Credit this trip carries into next month, as the line prints it — on the trip that runs past the month's end. */
  carryOverCreditHours?: number;
}) {
  const circadian = computeCircadianAssessment(trip, homeBaseOffsetMinutes);
  const block = tripBlockMinutes(trip);
  const deadhead = tripDeadheadBlockMinutes(trip);
  const first = days[0] ? dayStats(days[0]) : null;
  const last = days.length ? dayStats(days[days.length - 1]) : null;
  // Each column's own real date — crossing the date line, the last column's date isn't simply the first plus the count.
  const startDate = mode === "local" ? (days[0]?.date ? dateLabel(days[0].date) : tripDayDate(trip, bidPeriodStart, 1)) : null;
  const endDate = mode === "local" ? (days.at(-1)?.date ? dateLabel(days.at(-1)!.date!) : tripDayDate(trip, bidPeriodStart, days.length)) : null;
  const stamp = (d: ReturnType<typeof tripDayDate>, n: number) => (d ? `${d.weekday} ${d.day}` : `day ${n}`);
  const zone = mode === "zulu" ? "Z" : "local";

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* The same oval the calendar puts on a trip's first day: its number and credit. */}
        <span className="rounded-full bg-calendar-accent px-2 py-0.5 font-mono text-sm font-semibold text-on-calendar" title="Trip number and credit in the bid pack">
          {trip.pairingNumber !== null ? `#${trip.pairingNumber} ` : ""}
          <CreditHours hours={trip.creditHours} className="font-normal opacity-85" />
        </span>
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.12em] text-ink">{trip.days}-day</span>
        {trip.international && (
          <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">Intl</span>
        )}
        <CircadianStars assessment={circadian} size="sm" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-4">
        <Readout label="Report" value={first?.onDuty ? `${first.onDuty} ${zoneTag(mode)}` : REPORT_LABELS[trip.reportTime]} note={stamp(startDate, 1)} title={`${REPORT_LABELS[trip.reportTime]} report, ${zone}${startDate ? ` — ${startDate.weekday} ${startDate.day} ${startDate.month}` : ""}`} />
        <Readout label="Last in" value={last?.lastIn ? `${last.lastIn} ${zoneTag(mode)}` : block === null && trip.landings === 0 ? "no flying" : "—"} note={stamp(endDate, days.length)} title={`Last block-in of the trip, ${zone}${endDate ? ` — ${endDate.weekday} ${endDate.day} ${endDate.month}` : ""}`} />
        <Readout label="TAFB" value={hm(trip.tafbHours * 60)} title="Time away from base" />
        <Readout label="Operating block" value={block !== null ? hm(block) : trip.landings === 0 ? "none" : "—"} />
        <Readout label="DH block" value={deadhead > 0 ? hm(deadhead) : "none"} tone={deadhead > 0 ? "text-deadhead" : "text-readout"} />
        <Readout label="Duty periods" value={String(trip.dutyPeriods ?? trip.schedule.length)} />
        <Readout label="Landings" value={String(trip.landings)} />
        {carryOverCreditHours ? <Readout label="C/O CH" value={hm(carryOverCreditHours * 60)} title="Credit hours this trip carries over into next month, as the bid pack prints it" /> : null}
      </div>
    </div>
  );
}

/**
 * Every one of the chart's generic explanations, in one findable reference
 * instead of hover-only tooltips a phone can't reach.
 */
function TripLegendInfo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center text-[11px] font-medium text-ink-faint underline decoration-dotted underline-offset-2 hover:text-ink"
      >
        What do these mean?
      </button>

      {open && (
        <Modal title="Trip calendar key" onClose={() => setOpen(false)}>
          <div className="space-y-4 text-sm leading-relaxed text-ink-muted">
            <div>
              <div className="font-medium text-ink">Reading a day</div>
              <ul className="mt-1.5 space-y-2">
                <li>
                  Each row is one day, midnight at the left to midnight at the right, on the base&rsquo;s clock &mdash; the
                  same days as the month calendar, every day the same height. Under the date,{" "}
                  <span className="font-mono font-semibold text-report">Rpt 13:47L</span> is when the trip reports, and{" "}
                  <span className="font-mono font-semibold text-gt">P/U 02:15L</span> the hotel pickup that starts a later
                  duty. L is local, Z Zulu.
                </li>
                <li>
                  Each flight is a <span className="font-medium text-leg">blue</span> line with a tick at each end, as long as the flight, its times over its
                  ends, its cities and flight number under it. A <span className="font-medium text-deadhead">magenta</span> line is a deadhead, riding
                  along; <span className="font-mono">CAB</span> a ride between airports by road. A <span className="font-medium text-standby">violet</span> bar
                  is hotel standby ({STANDBY_TOOLTIP.split(" — ")[1]}). A flight still in the air at midnight runs off the right edge and on into the next row.
                </li>
                <li>The faint band under the flying is the time on duty, report to release &mdash; a long band with little flying in it is a long wait, like a hub turn.</li>
                <li>
                  <span className="font-medium text-layover">Green line.</span> {LAYOVER_TOOLTIP} It runs under the flying, with the city, the layover&rsquo;s
                  length to the hour and the hotel (<span className="font-mono font-semibold text-layover">L/O SEA 16h</span>). The{" "}
                  <span className="font-medium text-gt">cyan</span> marks at its ends are the hotel van (GT): from the airport after landing, and back at the
                  pickup. A <span className="font-medium text-rest">gold</span> line is a crew-rest hotel during a long sit at a hub, inside the same duty.
                </li>
                <li>
                  <span className="font-medium text-ink">Tap any day</span> for everything the pairing says about it: each duty&rsquo;s report or pickup,
                  duty and block time; every leg&rsquo;s flight number, aircraft, both clocks, block and meal; and the hotel and both rides, each phone a
                  tap away. &ldquo;Open every day&rdquo; shows the whole trip at once.
                </li>
                <li>
                  <span className="font-medium text-ink">Meals</span> are written out from the pack&rsquo;s codes: S snack, DS dinner snack, BS breakfast
                  snack, DH dinner hot, BH breakfast hot.
                </li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-ink">The trip&rsquo;s numbers</div>
              <ul className="mt-1.5 space-y-2">
                <li><span className="font-medium text-ink">TAFB.</span> Time away from base. <span className="font-medium text-ink">C/O CH.</span> Credit hours the trip carries over into next month, as the bid pack prints it.</li>
                <li><span className="font-medium text-ink">Credit per day away.</span> Credit earned per 24 hours away from base.</li>
                <li><span className="font-medium text-ink">Time zones.</span> Total time-zone distance crossed, and which way the trip nets out.</li>
                <li><span className="font-medium text-ink">Avg sleep window.</span> Layover time minus the pickup/ground gap around it &mdash; closer to usable rest than the printed layover.</li>
                <li><span className="font-medium text-ink">Duty ÷ flying.</span> Duty time divided by block time &mdash; higher means more sitting and connecting.</li>
                <li><span className="font-medium text-ink">Back-to-back red-eyes.</span> Consecutive duties that each fly between midnight and 5am.</li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-ink">Other marks</div>
              <ul className="mt-1.5 space-y-2">
                <li><span className="font-medium text-ink">In a day&rsquo;s details.</span> Each time on the main clock first, the other one beside it in gray; &ldquo;airline&rdquo; means a deadhead on another carrier.</li>
              </ul>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

interface TripListProps {
  trips: Trip[];
  /** Real UTC offset derived from the bid pack's own printed times — see lib/circadian.ts. Null when it couldn't be derived. */
  homeBaseOffsetMinutes: number | null;
  /** The bid period's first real day, so each trip day can show its date. */
  bidPeriodStart?: string | null;
  /** The pilot's loved/avoided layover cities, marked on the route and the hotel stays. */
  cityPreferences?: Record<string, CityMark>;
  /** A commuter's looked-up airline flights, shown on each trip that has some. */
  flights?: FlightAnswers | null;
  /** The bid pack's base — where the commute goes. */
  base?: string;
  /** Each trip's own score for this pilot, by `tripKey` (see `lib/scoring-v2/trip-score.ts`); absent before an interview. */
  tripScores?: Map<string, TripScore> | null;
  /** The line's credit carried into next month (`Line.carryOverCreditHours`) — shown on its last trip, the one that carries it. */
  carryOverCreditHours?: number;
}

function TripCommuteFlightsFor({ trip, flights, base }: { trip: Trip; flights: FlightAnswers; base: string }) {
  const f = computeTripFacts(trip);
  return <TripCommuteFlights answers={flights} trip={trip} base={base} frontCity={f.front?.city} backCity={f.back?.city} />;
}

export function TripList({ trips, homeBaseOffsetMinutes, bidPeriodStart = null, cityPreferences, flights, base, tripScores, carryOverCreditHours }: TripListProps) {
  const [ratings, setRatings] = useState<Record<string, HotelResult | null>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  // Starts at the same fixed default the server renders, then syncs to the
  // pilot's stored choice once mounted — reading localStorage during render
  // would mismatch the server's HTML.
  const [mode, setMode] = useState<TimeMode>("local");
  const sleepPlans = useMemo(() => trips.map((t) => planTripSleep(t, homeBaseOffsetMinutes)), [trips, homeBaseOffsetMinutes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(loadTimeMode());
  }, []);

  function handleModeChange(next: TimeMode) {
    setMode(next);
    saveTimeMode(next);
  }

  useEffect(() => {
    const pairs = new Map<string, { code: string; hotelName: string }>();
    for (const trip of trips) {
      for (const layover of trip.layoverDetails) {
        if (!layover.hotelName) continue;
        pairs.set(`${layover.city}|${layover.hotelName}`, { code: layover.city, hotelName: layover.hotelName });
      }
    }
    if (pairs.size === 0) return;

    let cancelled = false;
    Promise.all(
      Array.from(pairs.entries()).map(async ([key, { code, hotelName }]) => {
        const result = await fetchHotel(code, hotelName);
        return [key, result.hotel] as const;
      })
    ).then((entries) => {
      if (!cancelled) setRatings(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [trips]);

  // The line's last trip — the one that runs past the month's end and carries its credit into the next.
  const lastTrip = trips.reduce((best, t, i) => ((t.startDayIndex ?? i) >= (trips[best].startDayIndex ?? best) ? i : best), 0);

  function handleToggleExpand(key: string) {
    setExpandedKey((k) => (k === key ? null : key));
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TimeModeToggle mode={mode} onChange={handleModeChange} />
        </div>
        <div className="flex items-center gap-3">
          <TripLegendInfo />
          <CircadianInfo />
        </div>
      </div>
      <ul className="space-y-3">
        {trips.map((trip, tripIndex) => {
          // `trip.id` alone isn't unique — the same short pairing flown
          // several times in one month legitimately appears more than once
          // in this line's `trips` array.
          const key = `${trip.id}-${tripIndex}`;
          const plans: LayoverSleepPlan[] = sleepPlans[tripIndex] ?? [];
          const days = tripPictureDays(trip, mode);
          const tripScore = tripScores?.get(tripKey(trip));
          return (
            <li key={key} className="rounded-[var(--radius-panel)] border border-hairline bg-surface/60 p-3 shadow-[inset_0_1px_0_var(--panel-highlight)]">
              <TripHeader
                trip={trip}
                days={days}
                mode={mode}
                bidPeriodStart={bidPeriodStart}
                homeBaseOffsetMinutes={homeBaseOffsetMinutes}
                carryOverCreditHours={tripIndex === lastTrip ? carryOverCreditHours : undefined}
              />

              {trip.schedule.length > 0 ? (
                <div className="mt-2.5">
                  <TripPicture
                    trip={trip}
                    mode={mode}
                    bidPeriodStart={bidPeriodStart}
                    cityPreferences={cityPreferences}
                    dayDetail={(day) => <TripDayDetail trip={trip} day={day} mode={mode} ratings={ratings} />}
                  />
                  {/* The picture first; what the trip means for this pilot after it. */}
                  {tripScore && <TripScorePanel score={tripScore} />}
                  <TripInsights trip={trip} bidPeriodStart={bidPeriodStart} base={base} />
                  {flights && base && <TripCommuteFlightsFor trip={trip} flights={flights} base={base} />}
                  <RestPlan plans={plans} />
                </div>
              ) : (
                trip.layoverDetails.some((d) => d.hotelName) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                    {trip.layoverDetails
                      .filter((d) => d.hotelName)
                      .map((layover, i) => {
                        const hotel = ratings[`${layover.city}|${layover.hotelName}`];
                        const detailKey = `${trip.id}-fallback-${layover.city}-${i}`;
                        const canExpand = !!hotel && hasHotelQualityDetails(hotel);
                        const content = (
                          <>
                            <span className="font-mono font-medium text-good">{layover.city}</span>
                            <span className="capitalize">{layover.hotelName ? displayHotelName(layover.hotelName).toLowerCase() : null}</span>
                            {hotel?.rating != null && (
                              <span className="inline-flex items-center gap-0.5 text-accent">
                                <StarIcon className="h-3 w-3 fill-current" />
                                {hotel.rating.toFixed(1)}
                              </span>
                            )}
                            {canExpand && (
                              <ChevronDownIcon className={`h-3 w-3 shrink-0 transition-transform ${expandedKey === detailKey ? "rotate-180" : ""}`} />
                            )}
                          </>
                        );
                        return canExpand ? (
                          <button
                            key={detailKey}
                            type="button"
                            onClick={() => handleToggleExpand(detailKey)}
                            className="inline-flex items-center gap-1 hover:text-ink"
                            aria-expanded={expandedKey === detailKey}
                          >
                            {content}
                          </button>
                        ) : (
                          <span key={detailKey} className="inline-flex items-center gap-1">
                            {content}
                          </span>
                        );
                      })}
                  </div>
                )
              )}

              {trip.schedule.length === 0 && (
                <>
                  {tripScore && <TripScorePanel score={tripScore} />}
                  <TripInsights trip={trip} bidPeriodStart={bidPeriodStart} base={base} />
                  {flights && base && <TripCommuteFlightsFor trip={trip} flights={flights} base={base} />}
                </>
              )}

              {trip.schedule.length === 0 &&
                trip.layoverDetails
                  .filter((d) => d.hotelName)
                  .map((layover, i) => {
                    const detailKey = `${trip.id}-fallback-${layover.city}-${i}`;
                    if (expandedKey !== detailKey) return null;
                    const hotel = ratings[`${layover.city}|${layover.hotelName}`];
                    if (!hotel) return null;
                    return (
                      <div key={detailKey} className="mt-2 rounded-lg border border-hairline bg-canvas p-3">
                        <HotelQualityDetails hotel={hotel} />
                      </div>
                    );
                  })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
