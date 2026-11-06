import type { BrainFleetModel } from "@/lib/learning/brain-learning";
import { describeScores, scoreByVersion } from "@/lib/learning/outcome-score";
import { isLearnerOff, listRecentRuns, loadActiveModel, loadFlownMonths, type ModelKind } from "@/lib/server/learning-store";

/**
 * The Monday section of the morning email: what the brain learned this week and whether it's helping — about ten
 * minutes' reading, the human check on learning that otherwise runs by itself. Each group's fleet-notes decision,
 * the real-outcome score by brain version, what each learner did this week, and any learner switched off.
 */

const describeGroup = (level: string) =>
  level === "all" ? "Whole fleet" : level.startsWith("seat:") ? level.slice(5).replace("|", ", ") : level.slice(5).replace(/\|/g, " ").replace(/ (commuter|local)$/, ", $1");

export function notesLines(model: BrainFleetModel | null): string[] {
  if (!model) return ["No fleet learning yet."];
  const groups = Object.entries(model.levels).sort((a, b) => b[1].pilots - a[1].pilots);
  if (!groups.length) return ["No groups yet."];
  return groups.slice(0, 12).map(([level, s]) => `${describeGroup(level)} (${s.pilots} pilots): notes ${s.notes?.on ? "ON" : "off"} — ${s.notes?.reason ?? "not decided yet"}${s.notes?.on ? `; ${s.notes.lines.length} lines` : ""}`);
}

export function weeklyText(parts: { notes: string[]; scores: string[]; runs: string[]; switchedOff: string[] }): string {
  return [
    "THIS WEEK — WHAT THE BRAIN LEARNED",
    "",
    "Fleet notes, group by group (they switch themselves on when they've proved reliable):",
    ...parts.notes.map((l) => `  - ${l}`),
    "",
    "How flown months went, by brain version (from pilots' check-ins):",
    ...parts.scores.map((l) => `  - ${l}`),
    "",
    "Learning runs this week:",
    ...(parts.runs.length ? parts.runs.map((l) => `  - ${l}`) : ["  - none"]),
    ...(parts.switchedOff.length ? ["", `Switched off by you: ${parts.switchedOff.join(", ")}`] : []),
  ].join("\n");
}

/** Gathers this week's section. Never throws: the morning email goes out without it rather than not at all. */
export async function weeklySection(now = new Date()): Promise<string | null> {
  try {
    const kinds: ModelKind[] = ["brain", "forecast-prior", "forecast-calibration"];
    const [brain, flown, runs, offs] = await Promise.all([
      loadActiveModel<BrainFleetModel>("brain", { fresh: true }),
      loadFlownMonths(),
      listRecentRuns(14),
      Promise.all(kinds.map(async (k) => ((await isLearnerOff(k)) ? k : null))),
    ]);
    const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const runLines = (runs as { startedAt?: Date | string; summary?: { results?: Record<string, unknown>[] } }[])
      .filter((r) => r.startedAt && new Date(r.startedAt).getTime() >= weekAgo)
      .flatMap((r) => r.summary?.results ?? [])
      .reduce<Record<string, { runs: number; promoted: number; failed: number; last: string }>>((acc, r) => {
        const kind = String(r.kind ?? r.step ?? "?");
        const a = (acc[kind] ??= { runs: 0, promoted: 0, failed: 0, last: "" });
        a.runs++;
        if (r.promoted) a.promoted++;
        if (r.error) a.failed++;
        a.last = r.skipped ? `skipped: ${String(r.skipped)}` : r.error ? `failed: ${String(r.error)}` : `${r.promoted ? "new version in use" : "kept the version in use"}`;
        return acc;
      }, {});
    return weeklyText({
      notes: notesLines(brain?.payload ?? null),
      scores: describeScores(scoreByVersion(flown)),
      runs: Object.entries(runLines).map(([kind, a]) => `${kind}: ${a.runs} runs, ${a.promoted} put to use${a.failed ? `, ${a.failed} failed` : ""} (latest: ${a.last})`),
      switchedOff: offs.filter((k): k is ModelKind => !!k),
    });
  } catch (e) {
    console.error("[weekly] section not built", e);
    return null;
  }
}
