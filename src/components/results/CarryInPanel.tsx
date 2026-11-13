"use client";

import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FIELD } from "@/components/ui/field";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { carryInFromLogbook } from "@/lib/carry-in-storage";
import { recommendVipsAnswers, type CarryInItem, type FlownLine, type PhaseInElections, type ReservePeriod, type VipsRecommendation } from "@/lib/phase-in";
import type { CarryIn } from "@/lib/use-carry-in";
import type { VacationLine } from "@/lib/vacation-lines";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

const TOP_LINES = 20;
const RESERVE_PERIODS: ReservePeriod[] = ["A", "A+", "B", "B+", "24"];

const QUESTIONS: { key: keyof PhaseInElections; text: string; section: string }[] = [
  { key: "waiveBufferPhaseIn", text: "Waive the international duty free buffer to avoid a phase-in conflict", section: "CBA 2026 25.F.4" },
  { key: "waive1in10", text: "Waive 1-in-10 to avoid a phase-in conflict", section: "CBA 2026 12.C.1.c" },
  { key: "protectMinDays", text: "Minimum days off protection", section: "CBA 2026 25.F.7" },
];

function describe(item: CarryInItem, zone: string): string {
  if (item.kind === "rdays") {
    const first = DateTime.fromISO(item.firstDay, { zone }).toFormat("LLL d");
    return `${item.label}: RP-${item.rp}, ${item.days} day${item.days === 1 ? "" : "s"} from ${first}`;
  }
  const when = (iso: string) => DateTime.fromISO(iso, { zone }).toFormat("LLL d HH:mm");
  return `${item.label}: ${when(item.report)} to ${when(item.release)}${item.international ? ", international" : ""}`;
}

function newId(): string {
  return `carry-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Above the list: what the pilot carries in from last month, how they'll answer the bid's phase-in questions, and what that does to their top lines. */
export function CarryInPanel({ bidPack, profile, carry, order }: { bidPack: BidPack; profile: PreferenceProfile; carry: CarryIn; order: string[] }) {
  const { state, update, flown } = carry;
  const [open, setOpen] = useState(state.items.length > 0);
  const [adding, setAdding] = useState<"trip" | "rdays" | null>(null);
  const [recommended, setRecommended] = useState<VipsRecommendation[] | null>(null);
  const zone = timezoneForAirport(bidPack.base) ?? "UTC";

  const remember = (next: Partial<typeof state>) => {
    setRecommended(null);
    const merged = { ...state, ...next };
    // Something carried in isn't nothing.
    update(merged.items.length ? { ...merged, none: false } : merged);
  };

  const fromLog = useMemo(
    () => carryInFromLogbook(profile.logbook, bidPack).filter((t) => !state.items.some((i) => i.kind === "trip" && i.report === t.report)),
    [profile.logbook, bidPack, state.items]
  );

  const top = useMemo(() => {
    const byNumber = new Map(bidPack.lines.map((l) => [l.lineNumber, l.id]));
    return order.slice(0, TOP_LINES).flatMap((n): { number: string; rank: number; flown: FlownLine }[] => {
      const f = flown.lines.get(byNumber.get(n) ?? "");
      return f ? [{ number: n, rank: order.indexOf(n) + 1, flown: f }] : [];
    });
  }, [bidPack, order, flown]);
  const losing = top.filter((t) => t.flown.dropped.length);
  const checking = top.filter((t) => t.flown.kept.some((k) => k.certainty === "check"));
  const unchecked = top.filter((t) => t.flown.unchecked);

  return (
    <section aria-label="Carry-in from last month" className="panel-glass mt-4 p-4 sm:p-5 print:hidden">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Carry-in from last month</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            {state.items.length
              ? `Your lines are scored as they'll fly with ${state.items.length === 1 ? "this" : "these"} on your schedule.`
              : state.none
                ? "Nothing carries in from last month."
                : "Tell us what runs into this month, and your lines are scored as they'll really fly."}
          </p>
        </div>
        <Button variant="ghost" className="shrink-0 px-2 py-1 text-xs" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? "Close" : state.items.length ? "Change" : "Add"}
        </Button>
      </div>

      {state.items.length > 0 && !open && losing.length > 0 && (
        <p className="mt-2 text-xs text-ink">
          {losing.length} of your top {top.length} lines lose a trip to it.
        </p>
      )}

      {open && (
        <div className="mt-3 space-y-4">
          {state.items.length > 0 && (
            <ul className="space-y-1.5">
              {state.items.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 text-sm text-ink">
                  <span>{describe(item, zone)}</span>
                  <Button variant="ghost" className="shrink-0 px-2 py-1 text-xs" aria-label={`Remove ${item.label}`} onClick={() => remember({ items: state.items.filter((i) => i.id !== item.id) })}>
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {fromLog.map((trip) => (
            <div key={trip.id} className="flex items-center justify-between gap-3 text-sm text-ink-muted">
              <span>From your Logbook: {describe(trip, zone)}</span>
              <Button variant="secondary" className="shrink-0 px-3 py-1.5 text-xs" onClick={() => remember({ items: [...state.items, trip] })}>
                Use it
              </Button>
            </div>
          ))}

          {state.items.length === 0 && (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input type="checkbox" className="mt-1" checked={!!state.none} onChange={(e) => remember({ none: e.target.checked })} />
              <span>Nothing carries in from last month</span>
            </label>
          )}

          {adding === null && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setAdding("trip")}>
                Add a trip
              </Button>
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setAdding("rdays")}>
                Add R-days
              </Button>
            </div>
          )}
          {adding === "trip" && (
            <TripForm
              base={bidPack.base}
              zone={zone}
              onCancel={() => setAdding(null)}
              onAdd={(item) => {
                remember({ items: [...state.items, item] });
                setAdding(null);
              }}
            />
          )}
          {adding === "rdays" && (
            <RDaysForm
              onCancel={() => setAdding(null)}
              onAdd={(item) => {
                remember({ items: [...state.items, item] });
                setAdding(null);
              }}
            />
          )}

          <fieldset className="space-y-1.5">
            <legend className="text-xs font-semibold text-ink">How you&rsquo;re answering on your bid</legend>
            {QUESTIONS.map((q) => (
              <label key={q.key} className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={state.elections[q.key]}
                  onChange={(e) => remember({ elections: { ...state.elections, [q.key]: e.target.checked } })}
                />
                <span>
                  {q.text} <span className="text-xs text-ink-faint">({q.section})</span>
                </span>
              </label>
            ))}
          </fieldset>

          {state.items.length > 0 && (
            <div>
              <p className="text-sm text-ink">
                Of your top {top.length} lines, {losing.length} lose a trip{checking.length ? ` and ${checking.length} ${checking.length === 1 ? "has" : "have"} something to check` : ""}.
              </p>
              {unchecked.length > 0 && <p className="mt-1 text-xs text-ink-faint">{unchecked.length} of them couldn&rsquo;t be checked: the pack doesn&rsquo;t put their trips on dates.</p>}
              <ul className="mt-1.5 space-y-1 text-xs text-ink-muted">
                {[...losing, ...checking.filter((c) => !losing.includes(c))].slice(0, 5).map((t) => (
                  <li key={t.number}>
                    <span className="font-medium text-ink">
                      #{t.rank} Line {t.number}.
                    </span>{" "}
                    {t.flown.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => setRecommended(recommendVipsAnswers({ pack: bidPack, order, carryIn: state.items, model: profile.pilotModel }))}>
              What should I answer?
            </Button>
            {recommended && (
              <ul className="mt-2 space-y-1.5 text-xs text-ink-muted">
                {recommended.map((r) => (
                  <li key={r.key}>
                    <span className="font-medium text-ink">{r.answer === null ? "Your call." : r.answer ? "Yes." : "No."}</span> {r.reason} <span className="text-ink-faint">({r.section})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-ink-faint">
            Our reading of the contract, not an official award. Where it isn&rsquo;t clear we say &ldquo;check&rdquo; and leave the trip on the line. The minimum days off and some rules are still being checked with a retired FedEx captain.
          </p>
        </div>
      )}
    </section>
  );
}

function TripForm({ base, zone, onAdd, onCancel }: { base: string; zone: string; onAdd: (item: CarryInItem) => void; onCancel: () => void }) {
  const [label, setLabel] = useState("");
  const [report, setReport] = useState("");
  const [release, setRelease] = useState("");
  const [international, setInternational] = useState(false);
  const [credit, setCredit] = useState("");
  const toIso = (v: string) => DateTime.fromISO(v, { zone }).toUTC().toISO();
  const ready = !!report && !!release && DateTime.fromISO(release, { zone }) > DateTime.fromISO(report, { zone });

  return (
    <form
      className="space-y-2 rounded-md border border-hairline p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const reportIso = toIso(report);
        const releaseIso = toIso(release);
        if (!ready || !reportIso || !releaseIso) return;
        const value = Number(credit);
        onAdd({ kind: "trip", id: newId(), label: label.trim() ? `Trip ${label.trim()}` : "Your carry-in trip", report: reportIso, release: releaseIso, international, creditHours: credit && Number.isFinite(value) ? value : null });
      }}
    >
      <p className="text-xs text-ink-muted">Times at {base}, domicile local.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-ink-muted">
          Trip number
          <input className={`${FIELD} mt-1 w-full`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Optional" />
        </label>
        <label className="block text-xs text-ink-muted">
          Credit hours
          <input className={`${FIELD} mt-1 w-full`} inputMode="decimal" value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="Optional" />
        </label>
        <label className="block text-xs text-ink-muted">
          Report
          <input type="datetime-local" className={`${FIELD} mt-1 w-full`} value={report} onChange={(e) => setReport(e.target.value)} />
        </label>
        <label className="block text-xs text-ink-muted">
          Release
          <input type="datetime-local" className={`${FIELD} mt-1 w-full`} value={release} onChange={(e) => setRelease(e.target.value)} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={international} onChange={(e) => setInternational(e.target.checked)} />
        International
      </label>
      {report && release && !ready && <p className="text-xs text-danger">Release has to be after report.</p>}
      <div className="flex gap-2">
        <Button type="submit" className="px-3 py-1.5 text-xs" disabled={!ready}>
          Add trip
        </Button>
        <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RDaysForm({ onAdd, onCancel }: { onAdd: (item: CarryInItem) => void; onCancel: () => void }) {
  const [firstDay, setFirstDay] = useState("");
  const [days, setDays] = useState("1");
  const [rp, setRp] = useState<ReservePeriod>("A");
  const count = Number(days);
  const ready = !!firstDay && Number.isInteger(count) && count >= 1 && count <= 31;

  return (
    <form
      className="space-y-2 rounded-md border border-hairline p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onAdd({ kind: "rdays", id: newId(), label: "Your R-days", firstDay, days: count, rp });
      }}
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block text-xs text-ink-muted">
          First R-day
          <input type="date" className={`${FIELD} mt-1 w-full`} value={firstDay} onChange={(e) => setFirstDay(e.target.value)} />
        </label>
        <label className="block text-xs text-ink-muted">
          Days
          <input type="number" min={1} max={31} className={`${FIELD} mt-1 w-full`} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <label className="block text-xs text-ink-muted">
          Reserve period
          <select className={`${FIELD} mt-1 w-full`} value={rp} onChange={(e) => setRp(e.target.value as ReservePeriod)}>
            {RESERVE_PERIODS.map((p) => (
              <option key={p} value={p}>
                RP-{p}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" className="px-3 py-1.5 text-xs" disabled={!ready}>
          Add R-days
        </Button>
        <Button type="button" variant="ghost" className="px-3 py-1.5 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Under a line in the list: what the carry-in and the vacation do to it. Nothing when they do nothing. */
export function CarryInLineNote({ flown, vacation }: { flown: FlownLine | undefined; vacation?: VacationLine }) {
  if (!flown?.reason && !flown?.advice.length && !vacation?.reason) return null;
  return (
    <div className="mt-1 space-y-0.5 px-3 text-xs text-ink-muted">
      {flown?.reason && <p>{flown.reason}</p>}
      {flown?.advice.map((a) => (
        <p key={a}>{a}</p>
      ))}
      {vacation?.reason && <p>{vacation.reason}</p>}
    </div>
  );
}
