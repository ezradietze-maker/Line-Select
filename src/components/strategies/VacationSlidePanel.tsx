"use client";

import { DateTime } from "luxon";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FIELD } from "@/components/ui/field";
import { loadCarryIn } from "@/lib/carry-in-storage";
import { flyPack, zoneOf } from "@/lib/phase-in";
import { placeInPack } from "@/lib/strategy-engine";
import { CH_PER_VACATION_DAY, findVacationSlides, type LineSlides, type SlideOption, slideWhere, typedVacation, vacationLabel, vacationsInReach, type VacationSlides } from "@/lib/vacation-slide";
import { vacationId } from "@/lib/vacation-lines";
import type { BidPack, VacationPeriod } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";

const VIPS_MENU = "https://pilot.fedex.com/vips-bin/vipscgi?webmenu?all";
const LINES_SHOWN = 5;

const day = (iso: string) => DateTime.fromISO(iso).toFormat("LLL d");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function moveWords(o: Pick<SlideOption, "offset" | "expandBefore" | "expandAfter">): string {
  const parts: string[] = [];
  if (o.offset) parts.push(`Slide ${plural(Math.abs(o.offset), "day")} ${o.offset < 0 ? "earlier" : "later"}`);
  if (o.expandBefore) parts.push(`${parts.length ? "expand" : "Expand"} ${plural(o.expandBefore, "day")} earlier`);
  if (o.expandAfter) parts.push(`${parts.length ? "expand" : "Expand"} ${plural(o.expandAfter, "day")} later`);
  return parts.length ? parts.join(", ") : "As awarded";
}

function tripWords(o: SlideOption): string {
  // CBA 2026 7.G.1 charges the bank for removed trips only.
  if (!o.removed.length) return "takes no trips off, so it sits on days you already had off and your bank isn't charged";
  const names = o.removed.map((r) => (r.trip.pairingNumber ? `trip ${r.trip.pairingNumber}` : "a trip")).join(", ");
  return `takes ${names} off (${o.chargedCH.toFixed(1)} CH from your bank, still paid)`;
}

function restWords(o: SlideOption): string {
  return `${plural(o.daysOff, "day")} off${o.longestOff ? `, ${o.longestOff} in a row` : ""}`;
}

function OptionRow({ o, value, byModel }: { o: SlideOption; value: number; byModel: boolean }) {
  return (
    <li>
      <span className="font-medium text-ink">
        {moveWords(o)} ({day(o.firstDay)}&ndash;{day(o.lastDay)}).
      </span>{" "}
      It {tripWords(o)}: {restWords(o)}.{byModel && o.score !== null ? ` Scores ${o.score.toFixed(1)}.` : ""}
      {o.chargedCH > value ? ` That's ${(o.chargedCH - value).toFixed(1)} CH more than this vacation's ${value} CH (CBA 2026 7.G.1).` : ""}
      {o.removed.some((r) => r.waivable) ? " You can waive the 24-hour buffer to keep the trip after it (CBA 2026 7.G.1)." : ""}
      {" "}
      <span className="text-ink-faint">({[...new Set(o.removed.map((r) => r.section))].join("; ") || "CBA 2026 7.E.2"})</span>
    </li>
  );
}

function LineRow({ row, value, byModel }: { row: LineSlides; value: number; byModel: boolean }) {
  return (
    <li>
      <p className="text-sm font-medium text-ink">
        #{row.rank} Line {row.line.lineNumber}
      </p>
      <p className="mt-0.5 text-xs text-ink-muted">
        As awarded it {tripWords(row.asAwarded)}: {restWords(row.asAwarded)}.{byModel && row.asAwarded.score !== null ? ` Scores ${row.asAwarded.score.toFixed(1)}.` : ""}
      </p>
      {row.best.length > 0 ? (
        <ol className="mt-1 list-decimal space-y-1 pl-4 text-xs text-ink-muted">
          {row.best.map((o) => (
            <OptionRow key={`${o.offset}:${o.expandBefore}:${o.expandAfter}`} o={o} value={value} byModel={byModel} />
          ))}
        </ol>
      ) : (
        <p className="mt-1 text-xs text-ink-muted">No slide changes anything on this line.</p>
      )}
    </li>
  );
}

function Results({ found, zone }: { found: VacationSlides; zone: string }) {
  const [all, setAll] = useState(false);
  const value = found.vacation.days * CH_PER_VACATION_DAY;
  const shown = all ? found.lines : found.lines.slice(0, LINES_SHOWN);
  const reasons = [...new Set(found.illegal.map((c) => c.why!))];
  const best = found.across[0];
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-ink-muted">
        This vacation is worth {value} CH ({found.vacation.days} days at {CH_PER_VACATION_DAY} CH, CBA 2026 7.A.1). {vacationLabel(found.vacation, zone)}.
      </p>
      {found.across.length > 0 && best.gain > 0 ? (
        <div>
          <p className="text-sm text-ink">
            <span className="font-medium">Best across your top {found.lines.length} lines:</span> {moveWords({ ...best, expandBefore: 0, expandAfter: 0 })} ({day(best.firstDay)}&ndash;{day(best.lastDay)}).{" "}
            {found.byModel ? `It adds about ${best.gain.toFixed(1)} points on your priorities, your top lines counting most` : `It adds about ${best.gain.toFixed(1)} days off, your top lines counting most`}, and helps {plural(best.helps, "line")}.
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink">Across your top {found.lines.length} lines, no slide beats your vacation as awarded.</p>
      )}
      <ul className="space-y-3">
        {shown.map((row) => (
          <LineRow key={row.line.id} row={row} value={value} byModel={found.byModel} />
        ))}
      </ul>
      {found.lines.length > LINES_SHOWN && (
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${found.lines.length}`}
        </Button>
      )}
      {reasons.length > 0 && (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">Why some slides aren&rsquo;t offered</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The best slide of the pilot's own vacation, on their own priorities. Regular lines; it never submits anything. */
export function VacationSlidePanel({ bidPack, seniority, profile, userId, order }: { bidPack: BidPack; seniority: SeniorityInput; profile: PreferenceProfile | null; userId: string | null; order: string[] }) {
  const zone = zoneOf(bidPack);
  // A vacation the pilot told My Rankings they aren't taking has nothing to slide.
  const fromPack = useMemo(() => {
    const choices = loadCarryIn(userId, bidPack.id).vacationChoices;
    return vacationsInReach(placeInPack(bidPack, seniority).me?.vacations ?? [], bidPack).filter((v) => choices?.[vacationId(v)] !== "not-taking");
  }, [bidPack, seniority, userId]);
  const [typed, setTyped] = useState<VacationPeriod[]>([]);
  const [firstDay, setFirstDay] = useState("");
  const [days, setDays] = useState("7");
  const [found, setFound] = useState<VacationSlides[] | null>(null);
  const [working, setWorking] = useState(false);
  const vacations = useMemo(() => [...fromPack, ...typed], [fromPack, typed]);
  const where = useMemo(() => slideWhere(bidPack), [bidPack]);
  const zoned = (iso: string) => DateTime.fromISO(iso, { zone: "America/Chicago" }).toFormat("LLL d, HH:mm 'CT'");

  // A look over every line and slide takes a moment on a big pack: let the button show it's working first.
  useEffect(() => {
    if (!working) return;
    const timer = window.setTimeout(() => {
      const carry = loadCarryIn(userId, bidPack.id);
      const pack = flyPack(bidPack, carry.items, carry.elections).pack;
      setFound(vacations.map((vacation) => findVacationSlides({ pack, order, vacation, model: profile?.pilotModel })));
      setWorking(false);
    }, 30);
    return () => window.clearTimeout(timer);
  }, [working, userId, bidPack, vacations, order, profile?.pilotModel]);

  const addTyped = () => {
    const v = typedVacation(firstDay, Number(days), bidPack);
    if (!v) return;
    setTyped((t) => [...t, v]);
    setFound(null);
    setFirstDay("");
  };

  return (
    <section aria-label="Vacation slide" className="panel-glass mt-10 p-4 sm:p-5 print:hidden">
      <h2 className="text-sm font-semibold text-ink">Your best vacation slide</h2>
      <p className="mt-0.5 text-xs text-ink-muted">Every legal slide of your vacation on your top lines, scored on your own priorities. For a regular line; secondary and reserve lines work differently (CBA 2026 7.G.2, 7.G.3).</p>

      {vacations.length > 0 ? (
        <ul className="mt-3 space-y-1 text-sm text-ink">
          {vacations.map((v) => (
            <li key={v.from}>{vacationLabel(v, zone)}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-ink">The pack&rsquo;s vacation schedule shows none in reach of this month at your seniority. Add yours if that&rsquo;s wrong.</p>
      )}

      <form
        className="mt-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addTyped();
        }}
      >
        <label className="text-xs text-ink-muted">
          First vacation day
          <input type="date" className={`${FIELD} mt-1 block`} value={firstDay} onChange={(e) => setFirstDay(e.target.value)} />
        </label>
        <label className="text-xs text-ink-muted">
          Days
          <input type="number" min={1} max={42} className={`${FIELD} mt-1 block w-20`} value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
        <Button type="submit" variant="ghost" className="px-3 py-2 text-xs" disabled={!firstDay}>
          Add a vacation
        </Button>
      </form>

      <Button variant="secondary" className="mt-3 px-3 py-1.5 text-xs" disabled={!vacations.length || !order.length || working} onClick={() => setWorking(true)}>
        {working ? "Looking at every slide…" : "Find my best slide"}
      </Button>
      {!order.length && <p className="mt-2 text-xs text-ink-muted">Rank your lines first, so we know which ones to look at.</p>}

      {found?.map((f) => (
        <Results key={f.vacation.from} found={f} zone={zone} />
      ))}

      <div className="mt-4 border-t border-hairline pt-3 text-xs text-ink-muted">
        <p>
          <span className="font-medium text-ink">Where to enter it:</span> VIPS, during the Conflict Input Window (CBA 2026 25.E.2.b).
          {where.opens ? ` Opens ${zoned(where.opens)}.` : ""}
          {where.closes ? ` Closes ${zoned(where.closes)}.` : ""} {where.rule}{" "}
          <a href={VIPS_MENU} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
            Open the VIPS menu
          </a>
          . We don&rsquo;t enter it for you.
        </p>
        <p className="mt-1 text-ink-faint">Our reading of the contract, not an official award; some of it is still being checked with a retired FedEx captain. Your bank balance isn&rsquo;t in the pack, so check it in VIPS.</p>
      </div>
    </section>
  );
}
