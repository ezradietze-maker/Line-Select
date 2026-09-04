"use client";

import { useState, type ReactNode } from "react";
import { formatHoursValue } from "@/lib/interview-config";
import type { FilterOptions } from "@/lib/line-filter-options";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  filtersActive,
  type InternationalFilter,
  type LineFilters,
  type TripCountFilter,
} from "@/lib/line-filters";
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

interface ResultsFilterBarProps {
  filters: LineFilters;
  onChange: (next: LineFilters) => void;
  options: FilterOptions;
  availableCities: string[];
  visibleCount: number;
  totalCount: number;
}

export function ResultsFilterBar({
  filters,
  onChange,
  options,
  availableCities,
  visibleCount,
  totalCount,
}: ResultsFilterBarProps) {
  const [expanded, setExpanded] = useState(false);
  const active = filtersActive(filters);

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

  const showToggleRow = options.showDeadheadToggle || options.showRedEyeToggle;

  return (
    <div className="mt-4 rounded-lg border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
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
          Showing {visibleCount} of {totalCount} lines
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
                    {formatHoursValue(n)}+
                  </Chip>
                ))}
              </div>
            </FilterRow>
          )}

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
                    No red-eyes
                  </Chip>
                )}
              </div>
            </FilterRow>
          )}

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

          {availableCities.length > 0 && (
            <FilterRow label="Layover city">
              <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
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

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <span className="mt-1 w-24 shrink-0 text-xs font-medium text-ink-muted">{label}</span>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-brand bg-brand-soft text-brand"
          : "border-border-strong text-ink-muted hover:border-brand hover:text-brand"
      }`}
    >
      {children}
    </button>
  );
}
