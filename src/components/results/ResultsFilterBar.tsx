"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { FlipText } from "@/components/ui/FlipText";
import type { FilterOptions } from "@/lib/line-filter-options";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  blameFilters,
  filtersActive,
  type FilterContext,
  type InternationalFilter,
  type LineFilters,
  type OutAndBackFilter,
  type TripCountFilter,
} from "@/lib/line-filters";
import type { CommuteCheck } from "@/lib/use-commute-check";
import type { Line } from "@/types/bidpack";
import type { ReportTime } from "@/types/bidpack";

const REPORT_TIME_LABEL: Record<ReportTime, string> = {
  early: "Early",
  afternoon: "Afternoon",
  evening: "Evening",
};

const ROUTING_LABEL: Record<InternationalFilter, string> = {
  any: "Any",
  international: "International",
  domestic: "Domestic",
};

const TRIP_COUNT_LABEL: Record<TripCountFilter, string> = {
  any: "Any",
  1: "1 trip",
  2: "2 trips",
  "3plus": "3+ trips",
};

const OUT_AND_BACK_LABEL: Record<OutAndBackFilter, string> = {
  any: "Any",
  only: "Only",
  none: "None",
};

/**
 * The count as a screen reader hears it: said once the list has settled, since every keystroke in a search or a box
 * changes it and reading each one out would talk over the pilot's typing. Nothing is said on arrival, only after a change.
 */
function useSettledSaying(text: string, ms = 700): string {
  const [said, setSaid] = useState("");
  const last = useRef(text);
  useEffect(() => {
    if (text === last.current) return;
    const timer = window.setTimeout(() => {
      last.current = text;
      setSaid(text);
    }, ms);
    return () => window.clearTimeout(timer);
  }, [text, ms]);
  return said;
}

interface ResultsFilterBarProps {
  filters: LineFilters;
  onChange: (next: LineFilters) => void;
  options: FilterOptions;
  availableCities: string[];
  /** Every airport any leg touches, for the "touches" filter. */
  touchedCities: string[];
  commute: CommuteCheck;
  visibleCount: number;
  totalCount: number;
}

export function ResultsFilterBar({
  filters,
  onChange,
  options,
  availableCities,
  touchedCities,
  commute,
  visibleCount,
  totalCount,
}: ResultsFilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const active = filtersActive(filters);
  const countSaid = useSettledSaying(`Showing ${visibleCount} of ${totalCount} lines`);

  function toggleReportTime(rt: ReportTime) {
    const next = new Set(filters.reportTimes);
    if (next.has(rt)) next.delete(rt);
    else next.add(rt);
    onChange({ ...filters, reportTimes: next });
  }

  function toggleCity(city: string) {
    const next = new Set(filters.cities);
    if (next.has(city)) next.delete(city);
    else next.add(city);
    onChange({ ...filters, cities: next });
  }

  function toggleTouched(city: string) {
    const next = new Set(filters.touchedCities);
    if (next.has(city)) next.delete(city);
    else next.add(city);
    onChange({ ...filters, touchedCities: next });
  }

  const showToggleRow = options.showDeadheadToggle || options.showRedEyeToggle;
  const showDeadheadRow = options.showFrontDeadheadToggle || options.showBackDeadheadToggle || options.showDoubleDeadheadToggle;

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            active ? "bg-brand-soft text-brand" : "text-ink-muted hover:text-ink"
          }`}
        >
          Filters{active ? ` (${activeFilterCount(filters)})` : ""}
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden
            className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <span className="text-xs text-ink-faint">
          Showing <FlipText text={String(visibleCount)} /> of {totalCount} lines
        </span>
        <span role="status" className="sr-only">
          {countSaid}
        </span>
        {active && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="ml-auto text-xs text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted"
          >
            Clear filters
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-border px-4 py-3.5">
          {options.minDaysOffSteps.length > 0 && (
            <FilterRow label="Days off">
              <div className="flex flex-wrap gap-1.5">
                <Chip active={filters.minDaysOff === 0} onClick={() => onChange({ ...filters, minDaysOff: 0 })}>
                  Any
                </Chip>
                {options.minDaysOffSteps.map((n) => (
                  <Chip
                    key={n}
                    active={filters.minDaysOff === n}
                    onClick={() => onChange({ ...filters, minDaysOff: n })}
                  >
                    {n}+
                  </Chip>
                ))}
              </div>
            </FilterRow>
          )}

          <StepRow label="Days off in a row" steps={options.minDaysOffBlockSteps} value={filters.minDaysOffBlock} onChange={(n) => onChange({ ...filters, minDaysOffBlock: n })} />
          <StepRow label="Weekend days off" steps={options.minWeekendSteps} value={filters.minWeekendDaysOff} onChange={(n) => onChange({ ...filters, minWeekendDaysOff: n })} />

          {options.minCreditHoursSteps.length > 0 && (
            <FilterRow label="Credit hours">
              <div className="flex flex-wrap gap-1.5">
                <Chip
                  active={filters.minCreditHours === 0}
                  onClick={() => onChange({ ...filters, minCreditHours: 0 })}
                >
                  Any
                </Chip>
                {options.minCreditHoursSteps.map((n) => (
                  <Chip
                    key={n}
                    active={filters.minCreditHours === n}
                    onClick={() => onChange({ ...filters, minCreditHours: n })}
                  >
                    {Number.isInteger(n) ? `${n}+ hrs` : `${n.toFixed(1)}+ hrs`}
                  </Chip>
                ))}
              </div>
            </FilterRow>
          )}

          <FilterRow label="Credit range">
            <HoursRange
              label="credit"
              min={filters.minCreditHours}
              max={filters.maxCreditHours}
              onChange={(minCreditHours, maxCreditHours) => onChange({ ...filters, minCreditHours, maxCreditHours })}
            />
          </FilterRow>

          <FilterRow label="TAFB range">
            <HoursRange label="TAFB" min={filters.minTafbHours} max={filters.maxTafbHours} onChange={(minTafbHours, maxTafbHours) => onChange({ ...filters, minTafbHours, maxTafbHours })} />
          </FilterRow>

          {options.maxTripDaysSteps.length > 0 && (
            <FilterRow label="Longest trip">
              <div className="flex flex-wrap gap-1.5">
                <Chip active={filters.maxTripDays === 0} onClick={() => onChange({ ...filters, maxTripDays: 0 })}>
                  Any
                </Chip>
                {options.maxTripDaysSteps.map((n) => (
                  <Chip
                    key={n}
                    active={filters.maxTripDays === n}
                    onClick={() => onChange({ ...filters, maxTripDays: n })}
                  >
                    {n}d or less
                  </Chip>
                ))}
              </div>
            </FilterRow>
          )}

          {options.tripCountOptions.length > 0 && (
            <FilterRow label="Trip count">
              <div className="flex flex-wrap gap-1.5">
                <Chip active={filters.tripCount === "any"} onClick={() => onChange({ ...filters, tripCount: "any" })}>
                  Any
                </Chip>
                {options.tripCountOptions.map((v) => (
                  <Chip
                    key={String(v)}
                    active={filters.tripCount === v}
                    onClick={() => onChange({ ...filters, tripCount: v })}
                  >
                    {TRIP_COUNT_LABEL[v]}
                  </Chip>
                ))}
              </div>
            </FilterRow>
          )}

          {options.availableReportTimes.length > 0 && (
            <FilterRow label="Report time">
              <div className="flex flex-wrap gap-1.5">
                {options.availableReportTimes.map((rt) => (
                  <Chip key={rt} active={filters.reportTimes.has(rt)} onClick={() => toggleReportTime(rt)}>
                    {REPORT_TIME_LABEL[rt]}
                  </Chip>
                ))}
              </div>
            </FilterRow>
          )}

          {(options.showRoutingOptions || showToggleRow) && (
            <FilterRow label="Routing">
              <div className="flex flex-wrap gap-1.5">
                {options.showRoutingOptions &&
                  (Object.keys(ROUTING_LABEL) as InternationalFilter[]).map((v) => (
                    <Chip
                      key={v}
                      active={filters.international === v}
                      onClick={() => onChange({ ...filters, international: v })}
                    >
                      {ROUTING_LABEL[v]}
                    </Chip>
                  ))}
                {options.showDeadheadToggle && (
                  <Chip
                    active={filters.noDeadheadsOnly}
                    onClick={() => onChange({ ...filters, noDeadheadsOnly: !filters.noDeadheadsOnly })}
                  >
                    No deadheads
                  </Chip>
                )}
                {options.showRedEyeToggle && (
                  <Chip
                    active={filters.noRedEyesOnly}
                    onClick={() => onChange({ ...filters, noRedEyesOnly: !filters.noRedEyesOnly })}
                  >
                    No night legs
                  </Chip>
                )}
              </div>
            </FilterRow>
          )}

          <FilterRow label="Takeoffs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink-muted">
              <label className="flex items-center gap-1.5">
                None before
                <TimeInput value={filters.noTakeoffBefore} onChange={(noTakeoffBefore) => onChange({ ...filters, noTakeoffBefore })} />
              </label>
              <label className="flex items-center gap-1.5">
                None after
                <TimeInput value={filters.noTakeoffAfter} onChange={(noTakeoffAfter) => onChange({ ...filters, noTakeoffAfter })} />
              </label>
              <span className="text-xs">Local time where each flight leaves.</span>
            </div>
          </FilterRow>

          {showDeadheadRow && (
            <FilterRow label="Deadheads">
              <div className="flex flex-wrap gap-1.5">
                {options.showFrontDeadheadToggle && (
                  <Chip active={filters.noFrontDeadhead} onClick={() => onChange({ ...filters, noFrontDeadhead: !filters.noFrontDeadhead })}>
                    None at the start
                  </Chip>
                )}
                {options.showBackDeadheadToggle && (
                  <Chip active={filters.noBackDeadhead} onClick={() => onChange({ ...filters, noBackDeadhead: !filters.noBackDeadhead })}>
                    None at the end
                  </Chip>
                )}
                {options.showDoubleDeadheadToggle && (
                  <Chip active={filters.noDoubleDeadhead} onClick={() => onChange({ ...filters, noDoubleDeadhead: !filters.noDoubleDeadhead })}>
                    No double deadheads
                  </Chip>
                )}
              </div>
            </FilterRow>
          )}

          {options.showOutAndBackOptions && (
            <FilterRow label="Out-and-backs">
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(OUT_AND_BACK_LABEL) as OutAndBackFilter[]).map((v) => (
                  <Chip key={v} active={filters.outAndBacks === v} onClick={() => onChange({ ...filters, outAndBacks: v })}>
                    {OUT_AND_BACK_LABEL[v]}
                  </Chip>
                ))}
              </div>
            </FilterRow>
          )}

          {options.showSingleLegToggle && (
            <FilterRow label="Duties">
              <Chip active={filters.singleLegDutiesOnly} onClick={() => onChange({ ...filters, singleLegDutiesOnly: !filters.singleLegDutiesOnly })}>
                Single-leg duties only
              </Chip>
            </FilterRow>
          )}

          <StepRow label="Longest layover" steps={options.minLayoverSteps} value={filters.minLongestLayoverHours} suffix=" hrs+" onChange={(n) => onChange({ ...filters, minLongestLayoverHours: n })} />

          <FilterRow label="Pairing number">
            <input
              type="search"
              value={filters.pairingContains}
              onChange={(e) => onChange({ ...filters, pairingContains: e.target.value })}
              aria-label="Pairing number contains"
              placeholder="Contains…"
              className={`${FIELD} w-32`}
            />
          </FilterRow>

          <CommuteRow on={filters.commuteOnly} onToggle={() => onChange({ ...filters, commuteOnly: !filters.commuteOnly })} commute={commute} />

          {options.showVerifiedToggle && (
            <FilterRow label="Data quality">
              <div className="flex flex-wrap gap-1.5">
                <Chip
                  active={filters.verifiedOnly}
                  onClick={() => onChange({ ...filters, verifiedOnly: !filters.verifiedOnly })}
                >
                  Verified schedules only
                </Chip>
              </div>
            </FilterRow>
          )}

          {touchedCities.length > 0 && (
            <FilterRow label="Touches city">
              <div className="min-w-0 flex-1">
                <input
                  type="search"
                  list="touchable-cities"
                  aria-label="Add a city the line lands in or leaves, layover or not"
                  placeholder="Add a city, e.g. ANC"
                  className={`${FIELD} w-44`}
                  onChange={(e) => {
                    const code = e.target.value.trim().toUpperCase();
                    if (touchedCities.includes(code) && !filters.touchedCities.has(code)) {
                      toggleTouched(code);
                      e.target.value = "";
                    }
                  }}
                />
                <datalist id="touchable-cities">
                  {touchedCities.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
                {filters.touchedCities.size > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {[...filters.touchedCities].map((c) => (
                      <Chip key={c} active onClick={() => toggleTouched(c)}>
                        {c} ×
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            </FilterRow>
          )}

          {availableCities.length > 0 && (
            <FilterRow label="Layover city">
              {/* Every city on show: a scroll box inside the panel cut a row of chips in half. */}
              <div className="flex flex-wrap gap-1.5">
                {availableCities.map((city) => (
                  <Chip key={city} active={filters.cities.has(city)} onClick={() => toggleCity(city)}>
                    {city}
                  </Chip>
                ))}
              </div>
            </FilterRow>
          )}
        </div>
      )}
    </div>
  );
}

const FIELD = "rounded-md border border-field-edge bg-surface px-2 py-1.5 text-[13px] text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none";

/** "At least N" chips, offered only when the pack has values that split it. */
function StepRow({ label, steps, value, suffix = "+", onChange }: { label: string; steps: number[]; value: number; suffix?: string; onChange: (n: number) => void }) {
  if (steps.length === 0) return null;
  return (
    <FilterRow label={label}>
      <div className="flex flex-wrap gap-1.5">
        <Chip active={value === 0} onClick={() => onChange(0)}>
          Any
        </Chip>
        {steps.map((n) => (
          <Chip key={n} active={value === n} onClick={() => onChange(n)}>
            {n}
            {suffix}
          </Chip>
        ))}
      </div>
    </FilterRow>
  );
}

function HoursRange({ label, min, max, onChange }: { label: string; min: number; max: number; onChange: (min: number, max: number) => void }) {
  const read = (v: string) => Math.max(0, Number(v) || 0);
  return (
    <div className="flex items-center gap-1.5 text-[13px] text-ink-muted">
      <input type="number" inputMode="decimal" min={0} value={min || ""} onChange={(e) => onChange(read(e.target.value), max)} placeholder="Min" aria-label={`Fewest ${label} hours`} className={`${FIELD} w-20`} />
      to
      <input type="number" inputMode="decimal" min={0} value={max || ""} onChange={(e) => onChange(min, read(e.target.value))} placeholder="Max" aria-label={`Most ${label} hours`} className={`${FIELD} w-20`} />
      hrs
    </div>
  );
}

function TimeInput({ value, onChange }: { value: number | null; onChange: (minute: number | null) => void }) {
  const text = value === null ? "" : `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  return (
    <input
      type="time"
      value={text}
      onChange={(e) => {
        const [h, m] = e.target.value.split(":").map(Number);
        onChange(e.target.value ? h * 60 + m : null);
      }}
      className={FIELD}
    />
  );
}

const ARRIVE_HOURS = [1, 2, 3, 4];
const RELEASE_HOURS = [1, 2, 3];

/** The commute filter: its settings, and what the real flights have said so far. */
function CommuteRow({ on, onToggle, commute }: { on: boolean; onToggle: () => void; commute: CommuteCheck }) {
  const { settings, update, canCheck, phase, done, total, counts } = commute;
  return (
    <FilterRow label="Commute">
      <div className="min-w-0 flex-1 space-y-2">
        <Chip active={on} onClick={onToggle}>
          Only lines I can commute to and from
        </Chip>
        {on && (
          <>
            <p className="text-xs text-ink-muted">Real flights in on each report day and home on each release day, by the dates your pack prints.</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink-muted">
              <label className="flex items-center gap-1.5">
                Home airport
                <input
                  value={settings.homeAirport}
                  onChange={(e) => update({ homeAirport: e.target.value.trim().toUpperCase().slice(0, 3) })}
                  aria-invalid={settings.homeAirport.length === 3 && !canCheck}
                  placeholder="DEN"
                  className={`${FIELD} w-16 font-mono uppercase`}
                />
              </label>
              <label className="flex items-center gap-1.5">
                Arrive
                <select value={settings.arriveBeforeReportHours} onChange={(e) => update({ arriveBeforeReportHours: Number(e.target.value) })} className={FIELD}>
                  {[...new Set([...ARRIVE_HOURS, settings.arriveBeforeReportHours])].sort((a, b) => a - b).map((h) => (
                    <option key={h} value={h}>
                      {h} hr{h === 1 ? "" : "s"} before report
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                Fly home
                <select value={settings.releaseToDepartureHours} onChange={(e) => update({ releaseToDepartureHours: Number(e.target.value) })} className={FIELD}>
                  {RELEASE_HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h} hr{h === 1 ? "" : "s"} after the last duty period
                    </option>
                  ))}
                </select>
              </label>
              <Chip active={settings.jumpseats} onClick={() => update({ jumpseats: !settings.jumpseats })}>
                FedEx jumpseats count
              </Chip>
            </div>
            <p role="status" className="text-xs text-ink-muted">
              {!canCheck
                ? "Enter the airport you commute from. It can't be your domicile."
                : phase === "unavailable"
                  ? "Flight data isn't available right now, so no line is ruled out."
                  : phase === "checking"
                    ? `Checking flights… ${done} of ${total || "…"}`
                    : total === 0
                      ? "This month's trips have already flown, so there's nothing to check."
                      : `${counts.yes} lines work, ${counts.no} don't, ${counts.unknown} not known (kept in the list).${phase === "paused" ? " Flight checks are paused for now; try again later for the rest." : ""}`}
            </p>
          </>
        )}
      </div>
    </FilterRow>
  );
}

/** Shown when filters leave nothing: what each one takes out, and a tap to take it off. */
export function FilterBlameList({ lines, filters, ctx, onChange }: { lines: Line[]; filters: LineFilters; ctx: FilterContext; onChange: (next: LineFilters) => void }) {
  const blame = blameFilters(lines, filters, ctx);
  if (blame.length === 0) return null;
  return (
    <div className="mb-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
      <p className="font-medium text-ink">These filters leave no lines. Take one off:</p>
      <ul className="mt-2 space-y-1.5">
        {blame.map((b) => (
          <li key={b.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-ink-muted">
              {b.label} <span className="text-xs">(removes {b.removes})</span>
            </span>
            <button type="button" onClick={() => onChange(b.without)} className="font-semibold text-accent underline-offset-2 hover:underline">
              Remove<span className="sr-only"> {b.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="mt-1.5 shrink-0 text-[13px] font-medium text-ink-muted sm:w-24">{label}</span>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active
          ? "border-brand bg-brand-soft text-brand"
          : "border-border-strong text-ink-muted hover:border-brand hover:text-brand"
      }`}
    >
      {children}
    </button>
  );
}
