"use client";

import { DateTime } from "luxon";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { FIELD } from "@/components/ui/field";
import { airportCityName } from "@/lib/airport-city-names";
import { apiFetch } from "@/lib/shown-account";
import type { CarryIn } from "@/lib/use-carry-in";
import { aimLabel, cleanAims, GOAL_EXAMPLES, readGoalText, withDeviceReading, type GoalAim } from "@/lib/vacation-goal";
import { vacationLabel } from "@/lib/vacation-slide";
import { zoneOf } from "@/lib/phase-in";
import type { BidPack } from "@/types/bidpack";

/** What the small model is told beside the goal: the bid month, the vacation, the pack's layover cities. */
function goalContext(pack: BidPack, carry: CarryIn): string {
  const zone = zoneOf(pack);
  const start = pack.bidPeriodStart ? DateTime.fromISO(pack.bidPeriodStart) : null;
  const month = start ? `The bid month runs ${start.toFormat("LLL d")} to ${start.plus({ days: pack.bidPeriodDays - 1 }).toFormat("LLL d, yyyy")}.` : "";
  const vacations = carry.vacations.vacations.map((v) => vacationLabel(v, zone)).join("; ");
  const cities = [...new Set(pack.lines.flatMap((l) => l.trips.flatMap((t) => t.layoverCities ?? [])))]
    .slice(0, 80)
    .map((c) => `${c} (${airportCityName(c) ?? c})`)
    .join(", ");
  return `${month} The pilot's vacation: ${vacations || "none found"}. Layover cities in this pack: ${cities}.`.slice(0, 4000);
}

/**
 * At the top of My Rankings when the pilot has a vacation: what they want from it, in their own words or an example's.
 * Read on the device when it can be (`readGoalText`), else by a small model, then shown back as chips they can reorder
 * or drop. Every line's vacation then slides to its best legal spot for it (`lib/vacation-engine.ts`).
 */
export function VacationGoal({ pack, carry, share, moved, total, bare = false }: { pack: BidPack; carry: CarryIn; share: number; moved: number | null; total: number; bare?: boolean }) {
  const goal = carry.state.vacationGoal;
  const [text, setText] = useState(goal?.text ?? "");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!carry.chosen.some((v) => v.choice !== "not-taking")) return null;

  const save = (typed: string, aims: GoalAim[]) => carry.update({ ...carry.state, vacationGoal: aims.length ? { text: typed, aims } : undefined, vacationOverrides: undefined });

  const read = async (typed: string) => {
    const t = typed.trim();
    setError(null);
    if (!t) return save("", []);
    const local = readGoalText(t, pack);
    // Read on the device when everything in it was: the examples, and goals said the usual ways, answer at once.
    if (local.aims.length && local.unread.length === 0) return save(t, local.aims);
    setReading(true);
    try {
      const res = await apiFetch("/api/vacation-goal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: t, context: goalContext(pack, carry) }) });
      const body = (await res.json().catch(() => null)) as { aims?: unknown; error?: string } | null;
      const aims = res.ok ? withDeviceReading(cleanAims(body?.aims, pack), local.aims) : [];
      if (aims.length) save(t, aims);
      else if (local.aims.length) save(t, local.aims);
      else setError(res.ok ? "That didn't say anything about your vacation we could use. Try one of the examples." : body?.error ?? "Couldn't read that just now. Try one of the examples.");
    } catch {
      if (local.aims.length) save(t, local.aims);
      else setError("Couldn't reach the server. Try one of the examples, which work without it.");
    } finally {
      setReading(false);
    }
  };

  const aims = goal?.aims ?? [];
  const move = (i: number, by: -1 | 1) => {
    const next = [...aims];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    save(goal!.text, next);
  };

  return (
    <section aria-label="What you want from your vacation" className={`${bare ? "" : "panel-glass mt-4 p-4 sm:p-5 "}print:hidden`} data-vacation-goal>
      <h2 className="text-sm font-semibold text-ink">What do you want from your vacation?</h2>
      <p className="mt-0.5 text-xs text-ink-muted">Say it your way, and your vacation slides to its best legal spot on every line: up to 5 days either way (CBA 2026 7.E.2.a).</p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void read(text);
        }}
      >
        <input
          className={`${FIELD} min-w-0 flex-1 basis-64`}
          value={text}
          maxLength={300}
          placeholder="e.g. most credit, but keep Oct 24 off"
          aria-label="What you want from your vacation"
          onChange={(e) => setText(e.target.value)}
        />
        <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs" disabled={reading}>
          {reading ? "Reading…" : "Slide my vacation"}
        </Button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Examples">
        {GOAL_EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="rounded-[3px] border border-hairline px-2 py-0.5 text-2xs text-ink-muted transition-colors hover:border-accent hover:text-ink"
            onClick={() => {
              setText(ex);
              void read(ex);
            }}
          >
            {ex}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
      {aims.length > 0 && (
        <div className="mt-3" data-goal-read>
          <p className="text-2xs font-medium text-ink-faint">Read as, most important first:</p>
          <ol className="mt-1 flex flex-wrap gap-1.5">
            {aims.map((a, i) => (
              <li key={`${a.kind}-${i}`} className="flex items-center gap-1 rounded-[3px] border border-accent/60 bg-accent/10 py-0.5 pl-2 pr-1 text-xs text-ink">
                <span className="font-mono text-2xs text-accent">{i + 1}</span> {aimLabel(a)}
                {i > 0 && (
                  <button type="button" className="px-0.5 text-ink-muted hover:text-ink" aria-label={`Move "${aimLabel(a)}" up`} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                )}
                <button type="button" className="px-0.5 text-ink-muted hover:text-ink" aria-label={`Drop "${aimLabel(a)}"`} onClick={() => save(goal!.text, aims.filter((_, j) => j !== i))}>
                  ×
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-1.5 text-xs text-ink-muted" data-goal-summary>
            {share < 1 && moved === null
              ? `Working out every spot on every line… ${Math.round(share * 100)}%`
              : moved === null
                ? ""
                : moved === 0
                  ? "Where the pack has it is already best on every line for this."
                  : `Slid on ${moved} of ${total} lines; where the pack has it is best on the rest. Each line says what it gains.`}{" "}
            <button
              type="button"
              className="font-medium text-brand underline underline-offset-2"
              onClick={() => {
                setText("");
                save("", []);
              }}
            >
              Clear
            </button>
          </p>
        </div>
      )}
      <label className="mt-3 flex items-start gap-2 text-xs text-ink" data-slides-rank>
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
          checked={!!carry.state.slidesRank}
          onChange={(e) => carry.update({ ...carry.state, slidesRank: e.target.checked || undefined })}
        />
        <span>
          <span className="font-medium">Slides change my ranking.</span>{" "}
          <span className="text-ink-muted">
            {carry.state.slidesRank
              ? "On: each line is ranked with your vacation where it slides on that line, so a line a good slide makes better rises. Total CH and the notes follow."
              : "Off: lines are ranked with your vacation where the pack has it, and each line just shows where it would slide."}
          </span>
        </span>
      </label>
      <p className="mt-2 text-2xs text-ink-faint">
        The slide is asked for in the Conflict Input Window after the award. Our reading of the contract; what you type here may be read by an AI
        model when it isn&rsquo;t one of the usual goals.
      </p>
    </section>
  );
}
