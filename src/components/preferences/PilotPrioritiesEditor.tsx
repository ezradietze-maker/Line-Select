"use client";

import { useMemo, useState } from "react";
import { CityRatingStep } from "@/components/interview/CityRatingStep";
import { Button } from "@/components/ui/Button";
import { MicButton } from "@/components/ui/MicButton";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { requestModelBuild } from "@/lib/brain/client";
import { pilotContextFor } from "@/lib/brain/context";
import { describeModel } from "@/lib/brain/describe";
import { buildPackBrief } from "@/lib/brain/pack-brief";
import { baseModelOf, describeChanges, withModel } from "@/lib/brain/profile-model";
import { packCityFacts, sentimentFromRating } from "@/lib/city-ratings";
import { commuteGroupOf } from "@/lib/learning/cohort";
import { prepareMetrics } from "@/lib/metrics/compute";
import { useDictation } from "@/lib/use-speech-to-text";
import type { BidPack } from "@/types/bidpack";
import type { Criterion } from "@/types/pilot-model";
import type { CityRating, CityRatingScore, CitySentiment, PreferenceProfile } from "@/types/preferences";

/**
 * "Your priorities" for a pilot ranked by their own model: every priority the
 * interview heard, how much it counts, how it's measured, and the words it
 * came from — each one adjustable in a tap, cities re-ratable, and anything
 * new said in their own words and read back into the model. Every change is
 * also written into the pilot's interview record, so the next full read
 * (a check-in next month, or something new they add) keeps it.
 */

const LEVELS: { label: string; weight: number }[] = [
  { label: "Top", weight: 1 },
  { label: "High", weight: 0.7 },
  { label: "Medium", weight: 0.4 },
  { label: "Low", weight: 0.15 },
];

function levelOf(weight: number, top: number): number {
  const rel = top > 0 ? weight / top : weight;
  let best = 0;
  LEVELS.forEach((l, i) => {
    if (Math.abs(l.weight - rel) < Math.abs(LEVELS[best].weight - rel)) best = i;
  });
  return best;
}

interface PilotPrioritiesEditorProps {
  bidPack: BidPack;
  profile: PreferenceProfile;
  onUpdate: (profile: PreferenceProfile) => void;
}

function AddSomething({ onSubmit, busy }: { onSubmit: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState("");
  const dictation = useDictation(text, setText);
  return (
    <div>
      <div className="relative">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          disabled={busy}
          placeholder="Something we missed, or something that's changed — in your own words."
          aria-label="Something new about how you bid"
          className="w-full rounded-lg border border-border bg-canvas px-3 py-2 pr-11 text-sm text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none disabled:opacity-60"
        />
        {dictation.supported && <MicButton listening={dictation.listening} onClick={dictation.toggle} size="sm" className="absolute right-2 top-2" />}
      </div>
      {dictation.error && <p className="mt-1 text-xs text-danger">{dictation.error}</p>}
      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          disabled={busy || !text.trim()}
          onClick={() => {
            onSubmit(text.trim());
            setText("");
          }}
        >
          {busy ? "Reading it into your priorities…" : "Add it"}
        </Button>
      </div>
    </div>
  );
}

export function PilotPrioritiesEditor({ bidPack, profile, onUpdate }: PilotPrioritiesEditorProps) {
  const model = profile.pilotModel!;
  const pm = useMemo(() => prepareMetrics(bidPack), [bidPack]);
  const cityFacts = useMemo(() => packCityFacts(bidPack), [bidPack]);
  const [removed, setRemoved] = useState<Criterion[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = describeModel(model);
  const base = baseModelOf(profile)!;
  const top = Math.max(0, ...model.criteria.map((c) => c.weight));

  /** Records a change in the pilot's interview record, so the next full read keeps it. */
  function record(question: string, answer: string): PreferenceProfile["brainInterview"] {
    const bi = profile.brainInterview ?? { exchanges: [], choices: [] };
    return { ...bi, exchanges: [...bi.exchanges, { turn: bi.exchanges.length, question, answer }] };
  }

  function apply(next: PreferenceProfile, update: Parameters<typeof withModel>[2]) {
    const { profile: updated, changes } = withModel(next, bidPack, update, pm);
    onUpdate(updated);
    const said = describeChanges(changes);
    setNote(said ? `Updated — ${said}.` : "Updated.");
  }

  function setLevel(c: Criterion, level: number) {
    const pins = { ...(profile.brainInterview?.pins ?? {}), [c.id]: LEVELS[level].weight };
    apply({ ...profile, brainInterview: record(`Your priorities: how much does "${c.label}" matter?`, `${LEVELS[level].label} priority.`) }, { pins });
  }

  function drop(c: Criterion) {
    setRemoved((r) => [...r, c]);
    const pins = { ...(profile.brainInterview?.pins ?? {}) };
    delete pins[c.id];
    apply({ ...profile, brainInterview: record(`Your priorities: does "${c.label}" matter to you?`, "No, it doesn't matter to me.") }, { base: { ...base, criteria: base.criteria.filter((x) => x.id !== c.id) }, pins });
  }

  function restore(c: Criterion) {
    setRemoved((r) => r.filter((x) => x.id !== c.id));
    apply({ ...profile, brainInterview: record(`Your priorities: does "${c.label}" matter to you?`, "Yes, it does matter after all.") }, { base: { ...base, criteria: [...base.criteria, c] } });
  }

  function rateCity(code: string, score: CityRatingScore | 0, patch?: Partial<CityRating>) {
    const ratings = { ...(profile.cityRatings ?? {}) };
    const prefs: Record<string, CitySentiment> = { ...profile.cityPreferences };
    if (score === 0 && !patch) {
      delete ratings[code];
      delete prefs[code];
    } else {
      const s = (score || ratings[code]?.score || (prefs[code] === "love" ? 2 : prefs[code] === "avoid" ? -2 : 0)) as CityRatingScore | 0;
      if (s === 0) return;
      ratings[code] = { ...ratings[code], ...patch, score: s };
      const sentiment = sentimentFromRating(s);
      if (sentiment) prefs[code] = sentiment;
    }
    apply({ ...profile, cityPreferences: prefs }, { cityRatings: ratings });
  }

  async function addSomething(text: string) {
    setBusy(true);
    setError(null);
    try {
      const bi = record("Something to add about how you bid (from your priorities page):", text)!;
      const built = await requestModelBuild({
        packBrief: buildPackBrief(bidPack, pm),
        pilotContext: pilotContextFor(bidPack, profile),
        cohort: { base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat, commute: commuteGroupOf(profile.isCommuter) },
        exchanges: bi.exchanges,
        prior: base,
      });
      apply({ ...profile, brainInterview: bi }, { base: built });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that in just now.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <section className="panel-glass mt-6 p-5 sm:p-6">
        <SectionHeading>Your priorities</SectionHeading>
        <p className="mt-2 rounded-xl border border-hairline bg-canvas/60 px-4 py-3 text-[15px] leading-relaxed text-ink">{model.synopsis}</p>
        <p className="mt-3 text-sm text-ink-muted">
          These rank every line, in this order. Change how much one counts, or take it off &mdash; your rankings update right away.
          Dragging lines on your rankings tunes these too.
        </p>
        {note && <p className="mt-3 rounded-lg bg-good-soft px-3 py-2 text-sm text-good" role="status">{note}</p>}
        <ol className="mt-4 space-y-3">
          {items.map((d) => {
            const c = base.criteria.find((x) => x.id === d.id);
            if (!c) return null;
            const pin = profile.brainInterview?.pins?.[c.id];
            const level = pin !== undefined ? levelOf(pin, 1) : levelOf(model.criteria.find((x) => x.id === c.id)?.weight ?? c.weight, top);
            return (
              <li key={d.id} className="rounded-xl border border-border bg-surface p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 font-medium text-ink">{d.label}</p>
                  <span className="shrink-0 font-mono text-xs text-accent">{Math.round(d.influence)}%</span>
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  {d.measuredAs} · {d.shape}
                </p>
                {d.dealbreaker && <p className="mt-1 text-xs font-medium text-danger">{d.dealbreaker}</p>}
                {d.quotes[0] && <p className="mt-1 text-xs italic text-ink-faint">You said: &ldquo;{d.quotes[0]}&rdquo;</p>}
                <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label={`How much "${d.label}" counts`}>
                  {LEVELS.map((l, i) => (
                    <button
                      key={l.label}
                      type="button"
                      aria-pressed={i === level}
                      onClick={() => i !== level && setLevel(c, i)}
                      className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${i === level ? "border-brand bg-brand text-on-brand" : "border-border text-ink-muted hover:border-border-strong"}`}
                    >
                      {l.label}
                    </button>
                  ))}
                  <button type="button" onClick={() => drop(c)} className="ml-auto text-xs text-ink-faint underline decoration-dotted underline-offset-4 hover:text-danger">
                    Doesn&rsquo;t matter
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        {removed.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {removed.map((c) => (
              <p key={c.id} className="flex items-center justify-between gap-3 text-sm text-ink-faint">
                <span className="min-w-0 line-through">{c.label}</span>
                <button type="button" onClick={() => restore(c)} className="text-xs underline decoration-dotted underline-offset-4 hover:text-ink">
                  Put it back
                </button>
              </p>
            ))}
          </div>
        )}
        {model.notMeasurable.length > 0 && (
          <div className="mt-5 rounded-xl border border-hairline bg-canvas/40 px-4 py-3">
            <p className="text-sm font-medium text-ink">Things you said a bid pack can&rsquo;t show</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-muted">
              {model.notMeasurable.map((n, i) => (
                <li key={i}>{n.statement}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="panel-glass mt-6 p-5 sm:p-6">
        <SectionHeading>Tell us something new</SectionHeading>
        <p className="mt-2 mb-3 text-sm text-ink-muted">We&rsquo;ll read it alongside everything you&rsquo;ve already said and update your priorities. About half a minute.</p>
        <AddSomething onSubmit={(t) => void addSomething(t)} busy={busy} />
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </section>

      <section className="panel-glass mt-6 p-5 sm:p-6">
        <CityRatingStep
          cities={cityFacts}
          ratings={profile.cityRatings ?? {}}
          sentiments={profile.cityPreferences}
          onRate={(code, score) => rateCity(code, score)}
          onReasons={(code, reasons) => rateCity(code, 0, { reasons })}
          onNote={(code, n) => rateCity(code, 0, { note: n })}
        />
      </section>
    </div>
  );
}
