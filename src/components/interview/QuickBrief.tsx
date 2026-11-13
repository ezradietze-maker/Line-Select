"use client";

import { useMemo, useState } from "react";
import { QuestionPrompt } from "@/components/interview/QuestionPrompt";
import { checkSeniority, parseSeniorityInput, SeniorityNotice } from "@/components/interview/SeniorityStep";
import { Button } from "@/components/ui/Button";
import { NoteBox } from "@/components/ui/NoteBox";
import { TextField } from "@/components/ui/TextField";
import { requestModelBuild } from "@/lib/brain/client";
import { pilotContextFor } from "@/lib/brain/context";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { QUICK_CHIPS, QUICK_STARTS, quickBriefExchanges, quickBriefProfile, quickBriefReady } from "@/lib/brain/quick-brief";
import { lookUpFlights } from "@/lib/flights/client";
import { commuteGroupOf } from "@/lib/learning/cohort";
import { prepareMetrics } from "@/lib/metrics/compute";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";

const LABELS = new Map(QUICK_CHIPS.map((c) => [c.id, c.label]));

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Tap what matters, put it in order, and one read of the brain ranks the pack. The full interview stays one tap away. */
export function QuickBrief({
  bidPack,
  priorProfile,
  onComplete,
  onFullInterview,
}: {
  bidPack: BidPack;
  priorProfile: PreferenceProfile | null;
  onComplete: (profile: PreferenceProfile) => void;
  onFullInterview: () => void;
}) {
  const [chips, setChips] = useState<string[]>([]);
  const [sentence, setSentence] = useState("");
  const [dates, setDates] = useState("");
  const [isCommuter, setIsCommuter] = useState<boolean | null>(priorProfile?.isCommuter ?? null);
  const [commuteFrom, setCommuteFrom] = useState(priorProfile?.commuteFrom ?? "");
  const [seniority, setSeniority] = useState(priorProfile?.seniorityNumber ? String(priorProfile.seniorityNumber) : "");
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metrics = useMemo(() => prepareMetrics(bidPack), [bidPack]);
  // A number that isn't one ("0") holds Rank back with the reason under it, as in the interview: it was dropped without a word.
  const seniorityUnusable = checkSeniority(seniority, bidPack.seniorityList ?? [])?.kind === "not-a-number";
  const ready = quickBriefReady({ chips, sentence }) && !seniorityUnusable;

  const toggle = (id: string) => setChips((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  async function build() {
    setBusy(true);
    setError(null);
    const exchanges = quickBriefExchanges({ chips, sentence, dates });
    const who = { isCommuter, commuteFrom, hasCrashPad: null };
    try {
      const model = await requestModelBuild({
        packBrief: buildPackBrief(bidPack, metrics),
        pilotContext: pilotContextFor(bidPack, who),
        cohort: { base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat, commute: commuteGroupOf(isCommuter) },
        exchanges,
        prior: null,
      });
      const profile = quickBriefProfile({ bidPack, model, exchanges, isCommuter, commuteFrom, seniorityNumber: parseSeniorityInput(seniority), prior: priorProfile });
      if (profile.pilotModel) void lookUpFlights(bidPack, profile.pilotModel);
      onComplete(profile);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that just now. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6" data-quick-brief>
      <QuestionPrompt eyebrow="Quick start · about a minute" title="What matters most to you this month?" help="Tap what matters, then put it in order. We'll rank every line from that. You can sharpen it later with the full interview." />

      <section className="mt-6">
        <h2 className="text-sm font-medium text-ink">Start from a pilot like you</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {QUICK_STARTS.map((s) => (
            <button key={s.id} type="button" onClick={() => setChips(s.chips)} className="rounded-[3px] border border-hairline px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-accent hover:text-ink">
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-ink">Your priorities</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          {QUICK_CHIPS.map((c) => {
            const on = chips.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(c.id)}
                className={`rounded-[3px] border px-3 py-1.5 text-sm transition-colors ${on ? "border-accent bg-accent/15 text-ink" : "border-hairline text-ink-muted hover:text-ink"}`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        {chips.length > 0 && (
          <ol className="mt-4 space-y-1.5" aria-label="Your priorities, most important first">
            {chips.map((id, i) => (
              <li
                key={id}
                draggable
                onDragStart={() => setDragging(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragging !== null && dragging !== i) {
                    setChips((c) => move(c, dragging, i));
                    setDragging(i);
                  }
                }}
                onDragEnd={() => setDragging(null)}
                className="flex cursor-grab items-center gap-3 rounded-lg border border-hairline bg-canvas/60 px-3 py-2 text-sm text-ink"
              >
                <span className="w-4 font-mono text-xs text-ink-faint">{i + 1}</span>
                <span className="min-w-0 flex-1">{LABELS.get(id)}</span>
                <button type="button" aria-label={`Move ${LABELS.get(id)} up`} disabled={i === 0} onClick={() => setChips((c) => move(c, i, i - 1))} className="px-1.5 text-ink-muted disabled:opacity-30">
                  &uarr;
                </button>
                <button type="button" aria-label={`Move ${LABELS.get(id)} down`} disabled={i === chips.length - 1} onClick={() => setChips((c) => move(c, i, i + 1))} className="px-1.5 text-ink-muted disabled:opacity-30">
                  &darr;
                </button>
                <button type="button" aria-label={`Remove ${LABELS.get(id)}`} onClick={() => toggle(id)} className="px-1.5 text-ink-faint">
                  &times;
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-6">
        <label htmlFor="quick-sentence" className="text-sm font-medium text-ink">
          Or say it in a sentence
        </label>
        <NoteBox id="quick-sentence" className="mt-2" value={sentence} onChange={setSentence} maxLength={1000} placeholder="Optional. Type or tap the mic." />
      </section>

      <section className="mt-6">
        <h2 className="text-sm font-medium text-ink">Do you commute to {bidPack.base}?</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {([[true, "I commute"], [false, "I live locally"]] as const).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={isCommuter === value}
              onClick={() => setIsCommuter(isCommuter === value ? null : value)}
              className={`rounded-[3px] border px-3 py-1.5 text-sm transition-colors ${isCommuter === value ? "border-accent bg-accent/15 text-ink" : "border-hairline text-ink-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {isCommuter && <TextField className="mt-3 max-w-40" label="Home airport" value={commuteFrom} maxLength={3} autoComplete="off" autoCapitalize="characters" onChange={(e) => setCommuteFrom(e.target.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 3))} placeholder="e.g. SAN" />}
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <TextField label="Seniority number (optional)" inputMode="numeric" autoComplete="off" value={seniority} onChange={(e) => setSeniority(e.target.value.replace(/[^\d]/g, "").slice(0, 6))} />
          {/* Shown as it's typed, before Rank: a number not on this pack's list is saved only once they've seen that. */}
          <SeniorityNotice value={seniority} list={bidPack.seniorityList ?? []} seat={bidPack.seat} className="mt-2" />
        </div>
        <div>
          <label htmlFor="quick-dates" className="text-sm font-medium text-ink">
            Dates you need off (optional)
          </label>
          <NoteBox id="quick-dates" className="mt-1.5" value={dates} onChange={setDates} maxLength={500} rows={1} placeholder="e.g. Oct 17, firm" />
        </div>
      </section>

      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-8 flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={onFullInterview} className="text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink-muted">
          Take the full interview instead
        </button>
        <Button type="button" disabled={!ready || busy} onClick={() => void build()} className="sm:px-6">
          {busy ? "Ranking your lines…" : "Rank my lines"}
        </Button>
      </div>
    </div>
  );
}
