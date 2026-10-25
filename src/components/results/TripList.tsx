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
import { planTripSleep, type LayoverSleepPlan } from "@/lib/sleep-plan";
import { tripKey, type TripScore } from "@/lib/scoring-v2/trip-score";
import { hubTurnsOf, summarizeHubTurns } from "@/lib/metrics/hub-turns";
import { Modal } from "@/components/ui/Modal";
import { computeCircadianAssessment } from "@/lib/circadian";
import type { FlightAnswers } from "@/lib/flights/trip-travel";
import { fetchHotel } from "@/lib/hotel-client";
import { standbyPlace } from "@/lib/standby";
import { displayHotelName } from "@/lib/hotels/hotel-names";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import { loadTimeMode, saveTimeMode } from "@/lib/time-mode-storage";
import { computeTripAnalytics } from "@/lib/trip-analytics";
import { clock, dateLabel, dayStats, equipmentLabel, hm, tripBlockMinutes, tripDayDate } from "@/lib/trip-day-stats";
import { type TimeMode, type TimelineDay } from "@/lib/trip-timeline";
import type { Trip } from "@/types/bidpack";
import type { HotelResult } from "@/types/hotel";
import type { CityMark } from "@/types/preferences";

const REPORT_LABELS: Record<Trip["reportTime"], string> = {
  early: "Early",
  afternoon: "Afternoon",
  evening: "Evening",
};

const MINUTES_PER_DAY = 24 * 60;
/** "(L)" after a local clock time, "(Z)" after a Zulu one — so no time on the trip view is ever ambiguous. */
const zoneTag = (mode: TimeMode) => (mode === "zulu" ? "(Z)" : "(L)");

const LABEL = "font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint";

function formatHHMM(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

function formatDuration(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

const LAYOVER_TOOLTIP =
  "Layover / hotel — real time from block-in to hotel pickup for the next departure. Not exactly when you’ll sleep, since that’s down to you and the jet lag.";

const STANDBY_TOOLTIP =
  "Hotel standby — you sit on call at the layover hotel for the day. It pays the guaranteed standby credit, but no flight is flown unless you’re called out.";

interface ItineraryProps {
  trip: Trip;
  mode: TimeMode;
  ratings: Record<string, HotelResult | null>;
  expandedKey: string | null;
  onToggleExpand: (key: string) => void;
}

/**
 * The precise, textual counterpart to the chart above — every leg in an
 * aligned table, grouped by duty period, with the other clock system beside
 * each time. Both clocks always come from the bid pack's own printed HHMM
 * pair (`depTimeLocal`/`depTimeGmt`), never `leg.depTimeZulu` — that field
 * is anchored to an arbitrary reference instant purely for internally-
 * consistent day-math (see `Trip.zuluAnchor`).
 */
function Itinerary({ trip, mode, ratings, expandedKey, onToggleExpand }: ItineraryProps) {
  const clocks = mode === "zulu" ? "Z / L" : "L / Z";
  const other: TimeMode = mode === "zulu" ? "local" : "zulu";
  return (
    <div className="mt-2 overflow-x-auto rounded-md border border-hairline">
      <table className="w-full min-w-[30rem] border-collapse text-[11px]">
        <thead>
          <tr className={`${LABEL} bg-surface-raised/70 text-left`}>
            <th className="px-2 py-1 font-normal">Flight</th>
            <th className="px-2 py-1 font-normal">Route</th>
            <th className="px-2 py-1 font-normal">Out · {clocks}</th>
            <th className="px-2 py-1 font-normal">In · {clocks}</th>
            <th className="px-2 py-1 text-right font-normal">Block</th>
            <th className="px-2 py-1 font-normal">Equip</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {trip.schedule.map((duty, dutyIndex) => {
            const flown = duty.legs.filter((l) => !l.isDeadhead && !l.isStandby);
            const block = flown.reduce((a, l) => a + (l.blockHours ?? 0) * 60, 0);
            return (
              <Fragment key={dutyIndex}>
                <tr className="border-t border-hairline bg-calendar-accent/[0.06]">
                  <td colSpan={6} className="px-2 py-1 font-sans text-[11px] text-ink-muted">
                    <span className="font-mono font-semibold text-readout">Duty {dutyIndex + 1}</span>
                    {" · "}
                    {dutyStartLabel(duty, dutyIndex, mode, trip.schedule[dutyIndex - 1] ?? null)}
                    {flown.length > 0 && ` · ${flown.length} landing${flown.length === 1 ? "" : "s"} · ${hm(block)} block`}
                  </td>
                </tr>
                {duty.legs.map((leg, legIndex) => {
                  if (leg.isStandby) {
                    return (
                      <tr key={legIndex} className="border-t border-hairline/60">
                        <td className="px-2 py-1 text-standby">SBY</td>
                        <td className="px-2 py-1 text-ink">{leg.depAirport}</td>
                        <td className="px-2 py-1 text-ink">
                          {formatHHMM(mode === "zulu" ? leg.depTimeGmt : leg.depTimeLocal)} <span className="text-ink-faint">{zoneTag(mode)}</span>
                        </td>
                        <td className="px-2 py-1 text-ink">
                          {formatHHMM(mode === "zulu" ? leg.arrTimeGmt : leg.arrTimeLocal)} <span className="text-ink-faint">{zoneTag(mode)}</span>
                        </td>
                        <td colSpan={2} className="px-2 py-1 font-sans text-ink-muted">on call at the {standbyPlace(leg.flightNumber)} — paid, not flying</td>
                      </tr>
                    );
                  }
                  const dep = mode === "zulu" ? [leg.depTimeGmt, leg.depTimeLocal] : [leg.depTimeLocal, leg.depTimeGmt];
                  const arr = mode === "zulu" ? [leg.arrTimeGmt, leg.arrTimeLocal] : [leg.arrTimeLocal, leg.arrTimeGmt];
                  return [
                    <tr key={legIndex} className="border-t border-hairline/60">
                      <td className="whitespace-nowrap px-2 py-1">
                        <span className={leg.isDeadhead ? "text-ink-muted" : "font-semibold text-ink"}>{leg.flightNumber}</span>
                        {leg.isDeadhead && <span className="ml-1 rounded bg-calendar-accent/15 px-1 text-[10px] text-ink-muted">DH</span>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-ink">
                        {leg.depAirport}<span className="text-ink-faint">–</span>{leg.arrAirport}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-readout">
                        {formatHHMM(dep[0])} {zoneTag(mode)} <span className="text-ink-faint">{formatHHMM(dep[1])} {zoneTag(other)}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-readout">
                        {formatHHMM(arr[0])} {zoneTag(mode)} <span className="text-ink-faint">{formatHHMM(arr[1])} {zoneTag(other)}</span>
                      </td>
                      <td className="px-2 py-1 text-right text-ink">{leg.blockHours !== null ? hm(leg.blockHours * 60) : "—"}</td>
                      <td className="px-2 py-1 text-ink-muted">{equipmentLabel(leg.equipment, leg.isDeadhead)}</td>
                    </tr>,
                    leg.dayRoomHotel && duty.legs[legIndex + 1] ? (
                      <tr key={`${legIndex}-dayroom`} className="border-t border-hairline/60 bg-good/[0.04]">
                        <td colSpan={6} className="px-2 py-1 font-sans text-ink-muted">
                          <span className={LABEL}>Day room</span>{" "}
                          <span className="font-mono font-semibold text-good">{leg.arrAirport}</span>{" "}
                          <span className="font-mono text-readout">{hm(duty.legs[legIndex + 1].startMinutes - leg.endMinutes)}</span>{" "}
                          <span className="capitalize text-ink">{displayHotelName(leg.dayRoomHotel).toLowerCase()}</span>
                          <span className="text-ink-faint"> · a hotel between legs, same duty</span>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
                {duty.layover && (
                  <LayoverRow
                    tripId={trip.id}
                    dutyIndex={dutyIndex}
                    city={duty.layover.city}
                    hotelName={duty.layover.hotelName}
                    hours={duty.layover.hours}
                    transport={duty.layover.transportToHotel}
                    ratings={ratings}
                    expandedKey={expandedKey}
                    onToggleExpand={onToggleExpand}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * When a duty starts, in the mode's clock. The first duty has a printed
 * report time; every later one starts at the hotel pickup the pack prints
 * on its "Trans From:" line (or, without one, where the previous layover's
 * printed length ends) — never the first departure mislabeled "report".
 */
function dutyStartLabel(duty: Trip["schedule"][number], dutyIndex: number, mode: TimeMode, previous: Trip["schedule"][number] | null): string {
  const printed = mode === "zulu" ? previous?.layover?.pickupTimeGmt : previous?.layover?.pickupTimeLocal;
  if (dutyIndex > 0 && printed) return `hotel pickup ${formatHHMM(printed)} ${zoneTag(mode)}`;
  const first = duty.legs[0];
  if (!first) return "";
  const dep = mode === "zulu" ? first.depTimeGmt : first.depTimeLocal;
  const lead = first.startMinutes - duty.startMinutes;
  const depMinutes = Number(dep.slice(0, 2)) * 60 + Number(dep.slice(2, 4));
  const start = clock((((depMinutes - lead) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  return dutyIndex === 0 ? `report ${start} ${zoneTag(mode)}` : `hotel pickup ${start} ${zoneTag(mode)}`;
}

function LayoverRow({
  tripId,
  dutyIndex,
  city,
  hotelName,
  hours,
  transport,
  ratings,
  expandedKey,
  onToggleExpand,
}: {
  tripId: string;
  dutyIndex: number;
  city: string;
  hotelName: string | null;
  hours: number;
  transport: string | null;
  ratings: Record<string, HotelResult | null>;
  expandedKey: string | null;
  onToggleExpand: (key: string) => void;
}) {
  const hotel = hotelName ? ratings[`${city}|${hotelName}`] : undefined;
  const detailKey = `${tripId}-${dutyIndex}`;
  const canExpand = !!hotel && hasHotelQualityDetails(hotel);
  const expanded = expandedKey === detailKey;

  const content = (
    <>
      <span className="font-mono font-semibold text-good">{city}</span>
      <span className="font-mono text-readout">{formatDuration(hours)}</span>
      {hotelName && <span className="capitalize text-ink">{displayHotelName(hotelName).toLowerCase()}</span>}
      {hotel?.rating != null && (
        <span className="inline-flex items-center gap-0.5 text-accent">
          <StarIcon className="h-2.5 w-2.5 fill-current" />
          {hotel.rating.toFixed(1)}
        </span>
      )}
      {transport && (
        <span className="capitalize text-ink-faint">
          · {hotelName && transport.toUpperCase() === hotelName.toUpperCase() ? "hotel shuttle" : transport.toLowerCase()}
        </span>
      )}
      {canExpand && <ChevronDownIcon className={`h-2.5 w-2.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />}
    </>
  );

  return (
    <tr className="border-t border-hairline/60 bg-good/[0.06]">
      <td colSpan={6} className="px-2 py-1 font-sans">
        {canExpand ? (
          <button type="button" onClick={() => onToggleExpand(detailKey)} className="flex flex-wrap items-center gap-x-1.5 text-left hover:text-ink" aria-expanded={expanded}>
            <span className={LABEL}>Hotel</span>
            {content}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-x-1.5">
            <span className={LABEL}>Hotel</span>
            {content}
          </div>
        )}
        {expanded && hotel && (
          <div className="mt-1.5 rounded-lg border border-hairline bg-surface p-2.5">
            <HotelQualityDetails hotel={hotel} />
          </div>
        )}
      </td>
    </tr>
  );
}

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
      title: "Flying into a sort hub, sitting while the packages are sorted, then flying back out. A night hub turn sits through the small hours; on long sits the crew gets a short airport hotel for a nap.",
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
}: {
  trip: Trip;
  days: TimelineDay[];
  mode: TimeMode;
  bidPeriodStart: string | null;
  homeBaseOffsetMinutes: number | null;
}) {
  const circadian = computeCircadianAssessment(trip, homeBaseOffsetMinutes);
  const block = tripBlockMinutes(trip);
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
          <span className="font-normal opacity-85">{hm(trip.creditHours * 60)}</span>
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
        <Readout label="Block" value={block !== null ? hm(block) : trip.landings === 0 ? "none" : "—"} title="Operated flying time, deadheads excluded" />
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
                  same days as the month calendar. Under the date, <span className="font-mono text-ink">Rpt 06:30</span> is
                  when that day&rsquo;s duty starts (report, or hotel pickup).
                </li>
                <li>
                  Each flight is a line with a tick at each end, as long as the flight. The cities are under its ends and
                  its times over them, local where it happens as the bid pack prints them (or Zulu, with the toggle). A
                  dashed line is a deadhead, riding along. A flight still in the air at midnight runs off the right edge
                  (▸) and on into the next row.
                </li>
                <li>The faint band under the flying is the time on duty, report to release &mdash; a long band with little flying in it is a long wait, like a hub turn.</li>
                <li><span className="font-medium text-ink">Green line.</span> {LAYOVER_TOOLTIP} The city and the layover&rsquo;s full length are written on it, with the hotel.</li>
                <li><span className="font-medium text-ink">Violet band.</span> {STANDBY_TOOLTIP}</li>
              </ul>
            </div>
            <div>
              <div className="font-medium text-ink">The trip&rsquo;s numbers</div>
              <ul className="mt-1.5 space-y-2">
                <li><span className="font-medium text-ink">TAFB.</span> Time away from base. <span className="font-medium text-ink">Block.</span> Flying you operate, deadheads excluded.</li>
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
                <li><span className="font-medium text-ink">Itinerary.</span> Every leg as a table: the main clock first, the other one beside it in gray; &ldquo;airline&rdquo; means a deadhead on another carrier, &ldquo;ground&rdquo; a car or cab.</li>
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
}

function TripCommuteFlightsFor({ trip, flights, base }: { trip: Trip; flights: FlightAnswers; base: string }) {
  const f = computeTripFacts(trip);
  return <TripCommuteFlights answers={flights} trip={trip} base={base} frontCity={f.front?.city} backCity={f.back?.city} />;
}

export function TripList({ trips, homeBaseOffsetMinutes, bidPeriodStart = null, cityPreferences, flights, base, tripScores }: TripListProps) {
  const [ratings, setRatings] = useState<Record<string, HotelResult | null>>({});
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [openItineraries, setOpenItineraries] = useState<Set<string>>(new Set());
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

  function handleToggleExpand(key: string) {
    setExpandedKey((k) => (k === key ? null : key));
  }

  function toggleItinerary(key: string) {
    setOpenItineraries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
              />

              {trip.schedule.length > 0 ? (
                <div className="mt-2.5">
                  <TripPicture trip={trip} mode={mode} bidPeriodStart={bidPeriodStart} cityPreferences={cityPreferences} />
                  <button
                    type="button"
                    onClick={() => toggleItinerary(key)}
                    className="mt-1.5 flex items-center gap-1 text-[11px] font-medium text-ink-muted hover:text-ink"
                    aria-expanded={openItineraries.has(key)}
                  >
                    {openItineraries.has(key) ? "Hide" : "Show"} every leg &mdash; times, flights, aircraft, hotels
                    <ChevronDownIcon className={`h-2.5 w-2.5 shrink-0 transition-transform ${openItineraries.has(key) ? "rotate-180" : ""}`} />
                  </button>
                  {openItineraries.has(key) && (
                    <Itinerary trip={trip} mode={mode} ratings={ratings} expandedKey={expandedKey} onToggleExpand={handleToggleExpand} />
                  )}
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
