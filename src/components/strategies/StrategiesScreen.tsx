"use client";

import { useEffect, useMemo, useState } from "react";
import { AutoBidPanel } from "@/components/strategies/AutoBidPanel";
import { AwardHistoryPanel } from "@/components/strategies/AwardHistoryPanel";
import { StrategyCard } from "@/components/strategies/StrategyCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Heading } from "@/components/ui/Heading";
import { Notice } from "@/components/ui/Notice";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TextField } from "@/components/ui/TextField";
import { fetchAwardHistory, summarizeAwardHistory } from "@/lib/award-history";
import { computeImplicitLineValues } from "@/lib/implicit-dimensions";
import { rankLines } from "@/lib/scoring";
import {
  attachScoreContext,
  buildAutoBid,
  generateStrategies,
  rankStrategiesByPreference,
} from "@/lib/strategy-engine";
import { SENIORITY_BANDS } from "@/lib/seniority-bands";
import { learnFromStrategyReaction } from "@/lib/strategy-learning";
import type { AwardHistoryRecord } from "@/types/award-history";
import type { BidPack } from "@/types/bidpack";
import type { UserAccount } from "@/types/auth";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput, StrategyId } from "@/types/strategy";

interface StrategiesScreenProps {
  bidPack: BidPack | null;
  seniority: SeniorityInput | null;
  /** True when `seniority` was worked out from the pilot's seniority number and the pack's list, so changing it means changing that number on Preferences. */
  seniorityFromProfile?: boolean;
  onChangeSeniorityNumber?: () => void;
  profile: PreferenceProfile | null;
  user: UserAccount | null;
  onSaveSeniority: (input: SeniorityInput) => void;
  onGoToUpload: () => void;
  onGoToResults: () => void;
  onStartInterview: () => void;
  onUpdateProfile: (profile: PreferenceProfile) => void;
}

export function StrategiesScreen({
  bidPack,
  seniority,
  seniorityFromProfile = false,
  onChangeSeniorityNumber,
  profile,
  user,
  onSaveSeniority,
  onGoToUpload,
  onGoToResults,
  onStartInterview,
  onUpdateProfile,
}: StrategiesScreenProps) {
  if (!bidPack) {
    return (
      <EmptyState
        title="Upload a bid pack first"
        description="Strategies are built from your bid pack’s own real lines, so upload one before Line Select can find your best moves."
        actionLabel="Upload bid pack"
        onAction={onGoToUpload}
      />
    );
  }

  return (
    <SeniorityGate
      bidPack={bidPack}
      seniority={seniority}
      fromProfile={seniorityFromProfile}
      onChangeSeniorityNumber={onChangeSeniorityNumber}
      profile={profile}
      user={user}
      onSaveSeniority={onSaveSeniority}
      onGoToResults={onGoToResults}
      onStartInterview={onStartInterview}
      onUpdateProfile={onUpdateProfile}
    />
  );
}

function SeniorityGate({
  bidPack,
  seniority,
  fromProfile,
  onChangeSeniorityNumber,
  profile,
  user,
  onSaveSeniority,
  onGoToResults,
  onStartInterview,
  onUpdateProfile,
}: {
  bidPack: BidPack;
  seniority: SeniorityInput | null;
  fromProfile: boolean;
  onChangeSeniorityNumber?: () => void;
  profile: PreferenceProfile | null;
  user: UserAccount | null;
  onSaveSeniority: (input: SeniorityInput) => void;
  onGoToResults: () => void;
  onStartInterview: () => void;
  onUpdateProfile: (profile: PreferenceProfile) => void;
}) {
  const [editing, setEditing] = useState(!seniority);

  if (editing || !seniority) {
    return (
      <SeniorityForm
        bidPack={bidPack}
        initial={seniority}
        onSave={(input) => {
          onSaveSeniority(input);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <StrategyResults
      bidPack={bidPack}
      seniority={seniority}
      profile={profile}
      user={user}
      fromProfile={fromProfile}
      onEditSeniority={() => (fromProfile && onChangeSeniorityNumber ? onChangeSeniorityNumber() : setEditing(true))}
      onGoToResults={onGoToResults}
      onStartInterview={onStartInterview}
      onUpdateProfile={onUpdateProfile}
    />
  );
}

function SeniorityForm({
  bidPack,
  initial,
  onSave,
}: {
  bidPack: BidPack;
  initial: SeniorityInput | null;
  onSave: (input: SeniorityInput) => void;
}) {
  const [rank, setRank] = useState(initial ? String(initial.rank) : "");
  const [totalPilots, setTotalPilots] = useState(initial ? String(initial.totalPilots) : "");
  const rankNum = Number(rank);
  const totalNum = Number(totalPilots);
  const valid =
    rank !== "" &&
    totalPilots !== "" &&
    Number.isFinite(rankNum) &&
    Number.isFinite(totalNum) &&
    rankNum >= 1 &&
    totalNum >= rankNum;

  return (
    <div className="mx-auto w-full max-w-md animate-fade-in">
      <div className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">{packEyebrow(bidPack)}</div>
      <Heading as="h1" className="mt-1.5 text-3xl tracking-tight text-ink sm:text-4xl">Where do you rank?</Heading>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Every strategy below is built from the real lines in your {bidPack.base} {bidPack.aircraft}{" "}
        {bidPack.seat} pack. Your seniority number just tells Line Select which of those moves are
        realistic for you versus a reach — nothing here reads your name or employee number, and
        this stays on this device.
      </p>

      <form
        className="panel-glass mt-6 space-y-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSave({ rank: rankNum, totalPilots: totalNum });
        }}
      >
        <TextField
          label="Your seniority number in this seat"
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="e.g. 42"
          value={rank}
          onChange={(e) => setRank(e.target.value)}
        />
        <TextField
          label="Total pilots in this seat at your domicile (a rough number is fine)"
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="e.g. 191"
          value={totalPilots}
          onChange={(e) => setTotalPilots(e.target.value)}
        />
        <Button type="submit" disabled={!valid} className="w-full">
          Find my strategies
        </Button>
      </form>

      <div className="mt-8">
        <SectionHeading>Don&rsquo;t know your exact numbers?</SectionHeading>
        <p className="mt-2 text-xs text-ink-muted">
          A rough idea is enough &mdash; pick where you sit and you&rsquo;ll get the same strategies.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {SENIORITY_BANDS.map((band) => (
            <button
              key={band.id}
              type="button"
              onClick={() => onSave(band.input)}
              className="press rounded-lg border border-hairline bg-canvas/40 px-3 py-2.5 text-left transition-colors hover:border-accent/60 hover:bg-accent-soft/40"
            >
              <div className="text-sm font-medium text-ink">{band.label}</div>
              <div className="mt-0.5 text-xs text-ink-muted">{band.hint}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StrategyResults({
  bidPack,
  seniority,
  profile,
  user,
  onEditSeniority,
  fromProfile,
  onGoToResults,
  onStartInterview,
  onUpdateProfile,
}: {
  bidPack: BidPack;
  seniority: SeniorityInput;
  profile: PreferenceProfile | null;
  user: UserAccount | null;
  onEditSeniority: () => void;
  fromProfile: boolean;
  onGoToResults: () => void;
  onStartInterview: () => void;
  onUpdateProfile: (profile: PreferenceProfile) => void;
}) {
  // Real per-line Satisfaction Index scores, so a strategy's recommended
  // line can cite its own actual number instead of just a feasibility tier
  // — see `attachScoreContext`'s own doc comment for why this is the real
  // line's real score, never a hypothetical "if applied" transformation.
  // No hotel-review data fetched here (that's ResultsView's own async
  // effect) — layoverQuality still scores from amenities/whatever's cached,
  // just without a fresh review lookup; a reasonable trade against adding a
  // second hotel-fetch effect purely for this screen's score-lift context.
  const implicitValuesByLine = useMemo(() => computeImplicitLineValues(bidPack), [bidPack]);
  const ranked = useMemo(
    () => (profile ? rankLines(bidPack, profile, {}, implicitValuesByLine) : null),
    [bidPack, profile, implicitValuesByLine]
  );

  // Real self-reported hold outcomes for this exact base/aircraft/seat —
  // fetched here (a second copy of what AwardHistoryPanel below also
  // fetches for its own display) purely to ground `estimateFeasibility`'s
  // tiers in real data instead of the seniority-vs-rarity heuristic alone;
  // see `lib/award-history.ts`'s own doc comments for the sample-size gate.
  const [awardRecords, setAwardRecords] = useState<AwardHistoryRecord[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchAwardHistory(bidPack.base, bidPack.aircraft, bidPack.seat).then((data) => {
      if (!cancelled) setAwardRecords(data);
    });
    return () => {
      cancelled = true;
    };
  }, [bidPack.base, bidPack.aircraft, bidPack.seat]);
  const awardSummary = useMemo(
    () => (awardRecords ? summarizeAwardHistory(awardRecords, seniority) : null),
    [awardRecords, seniority]
  );

  const strategies = useMemo(() => {
    const generated = generateStrategies(bidPack, seniority, awardSummary);
    const preferenceRanked = rankStrategiesByPreference(generated, profile?.weights ?? null);
    return attachScoreContext(preferenceRanked, ranked);
  }, [bidPack, seniority, profile, ranked, awardSummary]);
  const autoBid = useMemo(() => buildAutoBid(strategies), [strategies]);
  const strongCount = strategies.filter((s) =>
    s.lines.some((l) => l.feasibility === "strong")
  ).length;

  function handleReaction(strategyId: StrategyId, reaction: "used" | "dismissed") {
    if (!profile) return;
    const { weights, implicitConfidence } = learnFromStrategyReaction(profile, strategyId, reaction);
    onUpdateProfile({
      ...profile,
      weights,
      implicitConfidence,
      strategyReactions: { ...profile.strategyReactions, [strategyId]: reaction },
    });
  }

  // Line plays (picks from this pack) and bonus moves (process tips with no lines) read as two different kinds of advice, so they get their own banks — each keeping the preference order it already had.
  const linePlays = strategies.filter((st) => !st.isProcessTip);
  const bonusMoves = strategies.filter((st) => st.isProcessTip);
  const topPickId = profile && strategies[0] && !strategies[0].isProcessTip ? strategies[0].id : null;

  function card(strategy: (typeof strategies)[number]) {
    return (
      <StrategyCard
        key={strategy.id}
        strategy={strategy}
        topPick={strategy.id === topPickId}
        reaction={profile?.strategyReactions?.[strategy.id] ?? null}
        onReact={profile ? (reaction) => handleReaction(strategy.id, reaction) : undefined}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <PageHeader
        eyebrow={packEyebrow(bidPack)}
        title="Your strategies"
        description={
          profile
            ? "Moves built from this pack’s real lines, ordered by what you told us — with an honest read on whether your seniority can hold each one."
            : "Moves built from this pack’s real lines, with an honest read on whether your seniority can hold each one."
        }
        actions={
          <Button variant="secondary" onClick={onEditSeniority}>
            {fromProfile ? "Change seniority number" : "Update seniority"}
          </Button>
        }
      >
        <SeniorityStrip rank={seniority.rank} total={seniority.totalPilots} fromProfile={fromProfile} strongCount={strongCount} />
      </PageHeader>

      <Notice tone="note" className="mt-4 text-xs">
        Every strategy here works within FAR Part 117 duty and rest limits. &ldquo;Aggressive&rdquo;
        means legal and contractual leverage, never bent rest — that&rsquo;s not on the table
        regardless of how this board grows.
      </Notice>

      {!profile && (
        <Notice
          tone="info"
          className="mt-3"
          action={<Button onClick={onStartInterview}>Take the interview</Button>}
        >
          <span className="text-ink">
            These are ranked by how rare each pattern is, not by what you&rsquo;d actually
            enjoy. Answer the preferences interview and Line Select will reorder them by how
            much you&rsquo;d personally prefer each one.
          </span>
        </Notice>
      )}

      <div className="mt-6">
        <AutoBidPanel entries={autoBid} onGoToResults={profile ? onGoToResults : undefined} />
      </div>

      <nav aria-label="Jump to a strategy" className="mt-8">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {strategies.map((st) => (
            <a
              key={st.id}
              href={`#strategy-${st.id}`}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors hover:border-accent/60 hover:text-accent ${
                st.id === topPickId ? "border-accent/50 bg-accent-soft/60 text-accent" : "border-hairline text-ink-muted"
              }`}
            >
              {st.name}
              {st.lines.length > 0 && <span className="ml-1.5 font-mono text-ink-faint">{st.lines.length}</span>}
            </a>
          ))}
        </div>
      </nav>

      {linePlays.length > 0 && (
        <section className="mt-6">
          <SectionHeading count={linePlays.length}>Line plays</SectionHeading>
          <div className="mt-3 space-y-4">{linePlays.map(card)}</div>
        </section>
      )}

      {bonusMoves.length > 0 && (
        <section className="mt-10">
          <SectionHeading count={bonusMoves.length}>Bonus moves</SectionHeading>
          <p className="mt-2 text-xs text-ink-faint">Ways to work the process itself &mdash; no single line to bid.</p>
          <div className="mt-3 space-y-4">{bonusMoves.map(card)}</div>
        </section>
      )}

      <div className="mt-10">
        <AwardHistoryPanel bidPack={bidPack} seniority={seniority} user={user} />
      </div>
    </div>
  );
}

/**
 * Where this pilot sits in the bid, as a strip of the whole seniority list
 * with a lit marker — most senior on the left. Purely a picture of the
 * number already shown; it adds no estimate of its own.
 */
function SeniorityStrip({ rank, total, fromProfile, strongCount }: { rank: number; total: number; fromProfile: boolean; strongCount: number }) {
  const fraction = total > 1 ? Math.min(1, Math.max(0, (rank - 1) / (total - 1))) : 0;
  return (
    <div className="panel-glass mt-5 grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
      <div>
        <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
          <span>{fromProfile ? "Bid position" : "Seniority"}</span>
          <span className="text-sm font-semibold normal-case tracking-normal tabular-nums text-readout">
            #{rank} <span className="text-ink-faint">of {total}</span>
          </span>
        </div>
        <div className="relative mt-2.5 h-2 rounded-full bg-hairline" role="img" aria-label={`Number ${rank} of ${total} in bid order`}>
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-good/50 via-accent/40 to-ink-faint/30" />
          <div
            className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-accent shadow-[0_0_10px_var(--color-accent)]"
            style={{ left: `calc(${fraction * 100}% - 2px)` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint">
          <span>Most senior</span>
          <span>Most junior</span>
        </div>
      </div>
      {strongCount > 0 && (
        <div className="flex items-center gap-2 sm:border-l sm:border-hairline sm:pl-6">
          <span className="h-2 w-2 rounded-full bg-good shadow-[0_0_8px_var(--color-good)]" aria-hidden />
          <span className="text-sm">
            <span className="font-mono font-semibold text-good">{strongCount}</span>{" "}
            <span className="text-ink-muted">{strongCount === 1 ? "move" : "moves"} at strong odds</span>
          </span>
        </div>
      )}
    </div>
  );
}
