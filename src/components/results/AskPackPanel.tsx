"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SearchIcon } from "@/components/ui/icons";
import { runAskQuery, type AskResultLine } from "@/lib/ask-pack-run";
import type { AskQuery } from "@/lib/brain/ask-pack";
import { formatValue } from "@/lib/brain/describe";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { METRICS_BY_ID } from "@/lib/metrics/catalog";
import { prepareMetrics, type PackMetrics } from "@/lib/metrics/compute";
import { homeParams } from "@/lib/scoring-v2/score";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

const EXAMPLES = ["Lines with Honolulu and no weekends worked", "Fewest commutes, at least 15 days off", "No night hub turns and no three-leg duties"];
const SHOWN = 12;

/**
 * Ask your pack a question in plain words. The answer is the pack's own lines, measured on the same numbers the scores
 * use — the question is only read into conditions (`/api/brain/ask`); every line is measured here, and each answer
 * shows the figures it was kept on.
 */
export function AskPackPanel({ bidPack, profile, rankedIds, packMetrics }: { bidPack: BidPack; profile: PreferenceProfile; rankedIds: string[]; packMetrics: PackMetrics | null }) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ query: AskQuery; lines: AskResultLine[] } | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Worked out on the first question, not on every visit (the panel is keyed to the pack, so a new pack starts fresh).
  const pm = useRef<PackMetrics | null>(packMetrics);
  const brief = useRef<string | null>(null);
  const metrics = () => (pm.current ??= prepareMetrics(bidPack));
  const home = useMemo(() => (profile.pilotModel ? homeParams(profile.pilotModel) : {}), [profile.pilotModel]);

  // Only the latest question's answer is shown, whatever order the replies come back in.
  const latest = useRef(0);

  async function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    const id = ++latest.current;
    setAsking(true);
    setError(null);
    setShowAll(false);
    try {
      brief.current ??= buildPackBrief(bidPack, metrics());
      const res = await fetch("/api/brain/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, packBrief: brief.current }) });
      const data = (await res.json().catch(() => null)) as { query?: AskQuery; error?: string } | null;
      if (id !== latest.current) return;
      if (!res.ok || !data?.query) {
        setError(data?.error ?? "Couldn't read that question just now. Please try again.");
        setAnswer(null);
      } else {
        setAnswer({ query: data.query, lines: data.query.cannotAnswer ? [] : runAskQuery(data.query, bidPack, metrics(), home, rankedIds) });
      }
    } catch {
      if (id !== latest.current) return;
      setError("Couldn't reach the server. Check your connection and try again.");
    }
    setAsking(false);
  }

  const q = answer?.query;
  const shown = answer ? (showAll ? answer.lines : answer.lines.slice(0, SHOWN)) : [];
  const figure = (metric: string, v: number | null) => {
    const def = METRICS_BY_ID.get(metric);
    return v === null || !def ? "—" : formatValue(v, { ...def, id: metric });
  };

  return (
    <section aria-label="Ask your pack" className="panel-glass mt-4 p-4 sm:p-5 print:hidden">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
      >
        <label htmlFor="ask-pack" className="shrink-0 font-display text-base font-semibold text-ink">
          Ask your pack
        </label>
        <div className="relative min-w-0 flex-1">
          {asking ? (
            // Reading the question: the search glass becomes a small radar, sweeping.
            <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 overflow-hidden rounded-full border border-accent/50">
              <span className="absolute inset-0 animate-[spin_1.6s_linear_infinite] rounded-full motion-reduce:animate-none" style={{ background: "conic-gradient(from 0deg, transparent 0deg 270deg, var(--color-accent) 360deg)" }} />
            </span>
          ) : (
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          )}
          <input
            id="ask-pack"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={400}
            placeholder="Lines with Honolulu and no weekends worked"
            className="w-full rounded-md border border-hairline bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <Button type="submit" disabled={asking || !question.trim()} className="shrink-0">
          {asking ? "Reading your pack…" : "Ask"}
        </Button>
      </form>

      {!answer && !error && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
          Try:
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={asking}
              onClick={() => {
                setQuestion(ex);
                void ask(ex);
              }}
              className="rounded-full border border-hairline px-2.5 py-1 text-ink-muted hover:border-border-strong hover:text-ink disabled:pointer-events-none disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-warn">{error}</p>}

      {q && (
        <div className="mt-4 border-t border-hairline pt-3">
          {q.cannotAnswer ? (
            <p className="text-sm text-ink-muted">{q.cannotAnswer}</p>
          ) : (
            <>
              <p className="text-sm text-ink">
                {q.summary && <span className="text-ink-muted">{q.summary} &mdash; </span>}
                <span className="font-semibold">
                  {answer!.lines.length} line{answer!.lines.length === 1 ? "" : "s"}
                </span>
                {answer!.lines.length > 0 && <span className="text-ink-muted">{q.sort ? "" : ", in your order"}</span>}.
              </p>
              {answer!.lines.length > 0 && (
                <ul className="mt-2 divide-y divide-hairline rounded-lg border border-hairline">
                  {shown.map((r, i) => (
                    <li key={r.line.id} className="drop-in flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-3 py-2 text-sm" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                      <Link href={`/results?line=${r.line.lineNumber}`} scroll={false} className="font-mono font-semibold text-ink underline decoration-dotted underline-offset-2 hover:text-accent">
                        Line {r.line.lineNumber}
                      </Link>
                      {r.rank !== null && <span className="text-xs text-ink-muted">your #{r.rank}</span>}
                      <span className="flex flex-wrap gap-x-3 text-ink-muted">
                        {q.conditions.map((c, i) => (
                          <span key={i}>{figure(c.metric, r.values[i])}</span>
                        ))}
                        {q.sort && !q.conditions.some((c) => c.metric === q.sort!.metric) && <span>{figure(q.sort.metric, r.sortValue)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {answer!.lines.length > SHOWN && !showAll && (
                <button type="button" onClick={() => setShowAll(true)} className="mt-2 text-sm font-medium text-accent underline decoration-dotted underline-offset-4">
                  Show all {answer!.lines.length}
                </button>
              )}
              {q.conditions.length > 0 && (
                <p className="mt-2 text-xs text-ink-faint">Looked for: {q.conditions.map((c) => c.label).join(" · ")}. Every figure is measured from your pack.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
