"use client";

import { useState, type ReactNode } from "react";
import { hasHotelQualityDetails, HotelQualityDetails } from "@/components/hotels/HotelQualityDetails";
import { ChevronDownIcon, StarIcon } from "@/components/ui/icons";
import { displayHotelName } from "@/lib/hotels/hotel-names";
import { mealWords } from "@/lib/meals";
import { standbyPlace } from "@/lib/standby";
import { equipmentLabel, hm } from "@/lib/trip-day-stats";
import type { TimeMode, TimelineDay } from "@/lib/trip-timeline";
import type { Trip, TripDutyPeriod, TripLeg } from "@/types/bidpack";
import type { HotelResult } from "@/types/hotel";

/**
 * Everything the pairing says about one day of a trip, opened under that day's row — the ex-pilot's "all info from
 * the bid pack pairing needs to be available in this depiction": each duty that day, when it starts (the report, or
 * the hotel pickup after a layover), its duty and block time; every leg with its flight number, aircraft, both
 * clocks, block and meal; a rest hotel at a hub; and the layover — the hotel and the van each way, each with its phone
 * a tap away. Laid out to read top to bottom on a phone. The per-duty credit is left out on purpose.
 */

const LABEL = "font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint";

function clock(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}`;
}

/** A phone number as a link to call it. */
function Phone({ number }: { number: string }) {
  return (
    <a href={`tel:${number.replace(/[^\d+]/g, "")}`} className="whitespace-nowrap font-mono text-ink underline decoration-dotted underline-offset-2 hover:text-brand" onClick={(e) => e.stopPropagation()}>
      ☎ {number}
    </a>
  );
}

/** A leg's time on the main clock, with the other one beside it. */
function LegTime({ local, gmt, mode }: { local: string; gmt: string; mode: TimeMode }) {
  const [main, other] = mode === "zulu" ? [gmt, local] : [local, gmt];
  return (
    <>
      <span className="text-readout">
        {clock(main)}
        <span className="text-[0.85em] opacity-80">{mode === "zulu" ? "Z" : "L"}</span>
      </span>{" "}
      <span className="text-ink-faint">
        ({clock(other)}
        {mode === "zulu" ? "L" : "Z"})
      </span>
    </>
  );
}

/** When the duty starts: the printed report on the trip's first, the hotel pickup after a layover. */
function dutyStart(trip: Trip, index: number, mode: TimeMode): { kind: "Report" | "Pickup"; text: string } | null {
  if (index === 0) {
    const first = trip.schedule[0];
    const lead = first.legs[0] ? first.legs[0].startMinutes - first.startMinutes : 0;
    const dep = first.legs[0] ? (mode === "zulu" ? first.legs[0].depTimeGmt : first.legs[0].depTimeLocal) : null;
    if (mode === "local") return { kind: "Report", text: `${clock(first.reportTimeLocal)}L` };
    if (!dep) return null;
    const m = (((Number(dep.slice(0, 2)) * 60 + Number(dep.slice(2, 4)) - lead) % 1440) + 1440) % 1440;
    return { kind: "Report", text: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}Z` };
  }
  const lay = trip.schedule[index - 1]?.layover;
  const printed = mode === "zulu" ? lay?.pickupTimeGmt : lay?.pickupTimeLocal;
  return printed ? { kind: "Pickup", text: `${clock(printed)}${mode === "zulu" ? "Z" : "L"}` } : null;
}

function LegRow({ leg, mode, next }: { leg: TripLeg; mode: TimeMode; next: TripLeg | undefined }) {
  if (leg.isStandby) {
    return (
      <li className="text-ink">
        <span className="font-mono font-semibold text-standby">HSTBY</span> <span className="font-mono">{leg.depAirport}</span>{" "}
        <LegTime local={leg.depTimeLocal} gmt={leg.depTimeGmt} mode={mode} /> → <LegTime local={leg.arrTimeLocal} gmt={leg.arrTimeGmt} mode={mode} />
        <span className="text-ink-muted"> · on call at the {standbyPlace(leg.flightNumber)}, paid, not flying</span>
      </li>
    );
  }
  const cab = leg.equipment === "CAB";
  const tone = leg.isDeadhead ? "text-deadhead" : "text-leg";
  const equipment = equipmentLabel(leg.equipment, leg.isDeadhead);
  return (
    <li>
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={`font-mono font-semibold ${tone}`}>{leg.flightNumber}</span>
        {leg.isDeadhead && <span className={`rounded px-1 font-mono text-[10px] font-semibold ${cab ? "bg-gt/15 text-gt" : "bg-deadhead/15 text-deadhead"}`}>{cab ? "CAB" : "DH"}</span>}
        {equipment && !cab && <span className="text-ink-muted">{equipment === "airline" ? "airline" : equipment}</span>}
        {leg.blockHours !== null && (
          <span className="text-ink-muted">
            <span className="font-mono text-readout">{hm(leg.blockHours * 60)}</span> block
          </span>
        )}
        {leg.meal && (
          <span className="text-ink-muted" title={`Meal code ${leg.meal}`}>
            {mealWords(leg.meal)} <span className="font-mono text-[10px] text-ink-faint">({leg.meal})</span>
          </span>
        )}
      </div>
      <div className="font-mono">
        <span className="font-semibold text-ink">{leg.depAirport}</span> <LegTime local={leg.depTimeLocal} gmt={leg.depTimeGmt} mode={mode} /> <span className="text-ink-faint">→</span>{" "}
        <span className="font-semibold text-ink">{leg.arrAirport}</span> <LegTime local={leg.arrTimeLocal} gmt={leg.arrTimeGmt} mode={mode} />
      </div>
      {leg.dayRoomHotel && next && (
        <div className="mt-0.5 text-ink-muted">
          <span className="font-mono font-semibold text-rest">Rest HTL {leg.arrAirport}</span> <span className="font-mono text-readout">{hm(next.startMinutes - leg.endMinutes)}</span>{" "}
          <span className="capitalize text-ink">{displayHotelName(leg.dayRoomHotel).toLowerCase()}</span>
          <span className="text-ink-faint"> · a hotel through the sit, same duty</span>
        </div>
      )}
    </li>
  );
}

/** "Bespoke Transportation", or "hotel shuttle" when the hotel runs its own van. */
function rideName(company: string, hotel: string | null): string {
  return hotel && company.toUpperCase() === hotel.toUpperCase() ? "hotel shuttle" : company.toLowerCase();
}

/** A layover on a day after the one it started: one line — still at the hotel, its phone, and when the van comes. */
function LayoverReminder({ layover, mode }: { layover: NonNullable<TripDutyPeriod["layover"]>; mode: TimeMode }) {
  const pickup = mode === "zulu" ? layover.pickupTimeGmt : layover.pickupTimeLocal;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 border-l-2 border-layover/60 pl-2">
      <span className="font-mono font-semibold text-layover">L/O {layover.city}</span>
      {layover.hotelName && <span className="capitalize text-ink">{displayHotelName(layover.hotelName).toLowerCase()}</span>}
      {layover.hotelPhone && <Phone number={layover.hotelPhone} />}
      {pickup && (
        <span className="text-ink-muted">
          GT out pickup{" "}
          <span className="font-mono font-semibold text-gt">
            {clock(pickup)}
            {mode === "zulu" ? "Z" : "L"}
          </span>
        </span>
      )}
    </div>
  );
}

function Layover({ layover, ratings, mode }: { layover: NonNullable<TripDutyPeriod["layover"]>; ratings: Record<string, HotelResult | null>; mode: TimeMode }) {
  const [open, setOpen] = useState(false);
  const rated = layover.hotelName ? ratings[`${layover.city}|${layover.hotelName}`] : undefined;
  const canExpand = !!rated && hasHotelQualityDetails(rated);
  const pickup = mode === "zulu" ? layover.pickupTimeGmt : layover.pickupTimeLocal;
  const hotel: ReactNode = layover.hotelName ? <span className="capitalize text-ink">{displayHotelName(layover.hotelName).toLowerCase()}</span> : <span className="text-ink-muted">hotel not printed</span>;
  return (
    <div className="mt-1.5 space-y-0.5 border-l-2 border-layover/60 pl-2">
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-mono font-semibold text-layover">
          L/O {layover.city} {Math.floor(layover.hours)}h{String(Math.round((layover.hours % 1) * 60)).padStart(2, "0")}
        </span>
        {canExpand ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 hover:text-ink" aria-expanded={open}>
            {hotel}
            {rated?.rating != null && (
              <span className="inline-flex items-center gap-0.5 text-accent">
                <StarIcon className="h-2.5 w-2.5 fill-current" />
                {rated.rating.toFixed(1)}
              </span>
            )}
            <ChevronDownIcon className={`h-2.5 w-2.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        ) : (
          hotel
        )}
        {layover.hotelPhone && <Phone number={layover.hotelPhone} />}
      </div>
      {open && rated && (
        <div className="rounded-lg border border-hairline bg-surface p-2.5">
          <HotelQualityDetails hotel={rated} />
        </div>
      )}
      {layover.transportToHotel && (
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-mono text-[10px] font-semibold text-gt">GT IN</span>
          <span className="capitalize text-ink-muted">{rideName(layover.transportToHotel, layover.hotelName)}</span>
          {layover.transportToPhone && <Phone number={layover.transportToPhone} />}
          <span className="text-ink-faint">airport to hotel, after landing</span>
        </div>
      )}
      {(layover.transportFromHotel || pickup) && (
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-mono text-[10px] font-semibold text-gt">GT OUT</span>
          {layover.transportFromHotel && <span className="capitalize text-ink-muted">{rideName(layover.transportFromHotel, layover.hotelName)}</span>}
          {layover.transportFromPhone && <Phone number={layover.transportFromPhone} />}
          {pickup && (
            <span className="text-ink-muted">
              pickup{" "}
              <span className="font-mono font-semibold text-gt">
                {clock(pickup)}
                {mode === "zulu" ? "Z" : "L"}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function TripDayDetail({ trip, day, mode, ratings }: { trip: Trip; day: TimelineDay; mode: TimeMode; ratings: Record<string, HotelResult | null> }) {
  const duties = [...new Set(day.segments.map((s) => s.dutyIndex).filter((d): d is number => d !== undefined))].sort((a, b) => a - b);
  // A pack read before meals, duty times and phones were kept: say how to get them, once.
  const older = trip.schedule.length > 0 && !trip.schedule.some((d) => d.totals);
  if (duties.length === 0) return <p className="text-xs text-ink-muted">Nothing scheduled on this day.</p>;

  return (
    <div className="space-y-2 rounded-lg border border-hairline bg-canvas/70 p-2.5 text-xs leading-relaxed">
      {duties.map((d) => {
        const duty = trip.schedule[d];
        if (!duty) return null;
        const pieces = day.segments.filter((s) => s.dutyIndex === d);
        // Each leg on the day it departs, so "Open every day" reads the trip once, in order. A day whose only flying is
        // a landing carried over from the night before still shows that leg.
        const departs = (leg: TripLeg) =>
          leg.isStandby
            ? pieces.some((s) => s.kind === "standby" && !s.continuesFromPreviousDay)
            : pieces.some((s) => s.leg && s.leg.flightNumber === leg.flightNumber && s.leg.dep === leg.depAirport && !s.continuesFromPreviousDay);
        const touches = (leg: TripLeg) => pieces.some((s) => s.leg && s.leg.flightNumber === leg.flightNumber && s.leg.dep === leg.depAirport);
        const stay = pieces.find((s) => s.kind === "layover");
        let shown = duty.legs.map((leg, i) => (departs(leg) ? i : -1)).filter((i) => i >= 0);
        if (shown.length === 0 && !stay) shown = duty.legs.map((leg, i) => (touches(leg) ? i : -1)).filter((i) => i >= 0);
        const flown = shown.length > 0;
        const start = dutyStart(trip, d, mode);
        const operating = duty.legs.filter((l) => !l.isDeadhead && !l.isStandby).reduce((a, l) => a + (l.blockHours ?? 0) * 60, 0);
        const deadhead = duty.legs.filter((l) => l.isDeadhead && l.equipment !== "CAB").reduce((a, l) => a + (l.blockHours ?? 0) * 60, 0);
        return (
          <section key={d}>
            {flown && (
              <>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={LABEL}>
                    Duty {d + 1} of {trip.schedule.length}
                  </span>
                  {start && (
                    <span className={`font-mono font-semibold ${start.kind === "Report" ? "text-report" : "text-gt"}`}>
                      {start.kind === "Report" ? "Rpt" : "P/U"} {start.text}
                    </span>
                  )}
                  {duty.totals && duty.totals.dutyHours > 0 && (
                    <span className="text-ink-muted">
                      Duty <span className="font-mono text-readout">{hm(duty.totals.dutyHours * 60)}</span>
                    </span>
                  )}
                  {operating > 0 && (
                    <span className="text-ink-muted">
                      Block <span className="font-mono text-readout">{hm(operating)}</span>
                    </span>
                  )}
                  {deadhead > 0 && (
                    <span className="text-ink-muted">
                      DH block <span className="font-mono text-deadhead">{hm(deadhead)}</span>
                    </span>
                  )}
                </div>
                <ul className="mt-1 space-y-1.5">
                  {shown.map((i) => (
                    <LegRow key={i} leg={duty.legs[i]} mode={mode} next={duty.legs[i + 1]} />
                  ))}
                </ul>
              </>
            )}
            {stay && duty.layover && (stay.continuesFromPreviousDay ? <LayoverReminder layover={duty.layover} mode={mode} /> : <Layover layover={duty.layover} ratings={ratings} mode={mode} />)}
          </section>
        );
      })}
      {older && <p className="text-[11px] text-ink-faint">Meals, duty times and phone numbers show here once this bid pack is uploaded again.</p>}
    </div>
  );
}
