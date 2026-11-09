"use client";

import Link from "next/link";
import { DateTime } from "luxon";
import { useMemo } from "react";
import { zoneOf } from "@/lib/phase-in";
import type { CarryIn } from "@/lib/use-carry-in";
import { vacationId, type VacationChoice } from "@/lib/vacation-lines";
import type { BidPack, VacationPeriod } from "@/types/bidpack";

const TOP_LINES = 20;

const CHOICES: { value: VacationChoice; label: string; detail: string }[] = [
  { value: "use", label: "Use it", detail: "Trips under it come off and are paid from your vacation bank (CBA 2026 7.G.1)." },
  { value: "keep-flying", label: "Keep my flying", detail: "Those trips still come off, but a line ranks lower for the share of its credit your vacation takes, so lines it barely touches rise." },
  { value: "not-taking", label: "Not taking this one", detail: "Only if it's really off your schedule, traded or changed with flight management (CBA 2026 7.E.1.a). Otherwise those trips still come off." },
];

function when(v: VacationPeriod, zone: string): string {
  const first = DateTime.fromISO(v.from, { zone });
  const last = DateTime.fromMillis(Date.parse(v.to) - 7_200_000, { zone });
  return `${first.toFormat("LLL d")} to ${last.toFormat("LLL d")} (${v.days} days)`;
}

/** Above the list: the pilot's vacation from the pack, scored into every line, and what they want done with it. */
export function VacationChoicePanel({ bidPack, carry, order }: { bidPack: BidPack; carry: CarryIn; order: string[] }) {
  const { state, update, flown, vacations } = carry;
  const zone = zoneOf(bidPack);
  const top = useMemo(() => {
    const ids = new Map(bidPack.lines.map((l) => [l.lineNumber, l.id]));
    return order.slice(0, TOP_LINES).flatMap((n) => {
      const v = flown.vacationLines.get(ids.get(n) ?? "");
      return v ? [v] : [];
    });
  }, [bidPack, order, flown.vacationLines]);

  // Nothing to say: no schedule in the pack (the sample, or an older one), or a pilot with no vacation near this month.
  if (!vacations.packHasSchedule) return null;
  if (!vacations.known) {
    return (
      <section aria-label="Your vacation" className="panel-glass mt-4 p-4 sm:p-5 print:hidden">
        <p className="text-xs text-ink-muted">
          Your vacation isn&rsquo;t counted in this ranking because we don&rsquo;t know which pilot you are on this pack&rsquo;s list.{" "}
          <Link href="/preferences" className="underline underline-offset-2 hover:text-ink">
            Add your seniority number
          </Link>{" "}
          to have it scored in.
        </p>
      </section>
    );
  }
  if (!vacations.vacations.length) return null;

  const set = (v: VacationPeriod, choice: VacationChoice) => update({ ...state, vacationChoices: { ...state.vacationChoices, [vacationId(v)]: choice } });
  const losing = top.filter((t) => t.removed.length).length;

  return (
    <section aria-label="Your vacation" className="panel-glass mt-4 p-4 sm:p-5 print:hidden">
      <h2 className="text-sm font-semibold text-ink">Your vacation</h2>
      <p className="mt-0.5 text-xs text-ink-muted">From your bid pack&rsquo;s vacation schedule. Your lines are scored with it where it was awarded; to move it, see the slide finder on Strategies.</p>
      <div className="mt-3 space-y-3">
        {vacations.vacations.map((v) => {
          const current = state.vacationChoices?.[vacationId(v)] ?? "use";
          return (
            <fieldset key={vacationId(v)}>
              <legend className="text-sm font-medium text-ink">{when(v, zone)}</legend>
              <div className="mt-1 space-y-1">
                {CHOICES.map((c) => (
                  <label key={c.value} className="flex items-start gap-2 text-sm text-ink">
                    <input type="radio" className="mt-1" name={`vacation-${vacationId(v)}`} checked={current === c.value} onChange={() => set(v, c.value)} />
                    <span>
                      {c.label}. <span className="text-xs text-ink-muted">{c.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      {top.length > 0 && (
        <p className="mt-3 text-sm text-ink">
          {losing} of your top {top.length} lines lose a trip to it.
        </p>
      )}
      <p className="mt-2 text-xs text-ink-faint">Our reading of the contract, not an official award; the ranking doesn&rsquo;t charge for a heavy draw on your bank, and says so on the line. Your bank balance isn&rsquo;t in the pack. Some of this is still being checked with a retired FedEx captain.</p>
    </section>
  );
}
