"use client";

import { useEffect, useMemo, useState } from "react";
import { AutoBidPanel } from "@/components/strategies/AutoBidPanel";
import { AwardHistoryPanel } from "@/components/strategies/AwardHistoryPanel";
import { StrategyCard } from "@/components/strategies/StrategyCard";
import { Button } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
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
import { learnFromStrategyReaction } from "@/lib/strategy-learning";
import type { AwardHistoryRecord } from "@/types/award-history";
import type { BidPack } from "@/types/bidpack";
import type { UserAccount } from "@/types/auth";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput, StrategyId } from "@/types/strategy";

interface StrategiesScreenProps {
  bidPack: BidPack | null;
  seniority: SeniorityInput | null;
  profile: PreferenceProfile | null;
  user: UserAccount | null;
  onSaveSeniority: (input: SeniorityInput) => void;
  onGoToUpload: () => void;
  onStartInterview: () => void;
  onUpdateProfile: (profile: PreferenceProfile) => void;
}

export function StrategiesScreen({
  bidPack,
  seniority,
  profile,
  user,
  onSaveSeniority,
  onGoToUpload,
  onStartInterview,
  onUpdateProfile,
}: StrategiesScreenProps) {
  if (!bidPack) {
    return (
      <div className="mx-auto w-full max-w-md animate-fade-in text-center">
        <Heading as="h1" className="text-xl text-ink sm:text-2xl">Upload a bid pack first</Heading>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Strategies are built from your bid pack&rsquo;s own real lines, so upload one before
          Line Select can find your best moves.
        </p>
        <Button onClick={onGoToUpload} className="mt-6">
          Upload bid pack
        </Button>
      </div>
    );
  }

  return (
    <SeniorityGate
      bidPack={bidPack}
      seniority={seniority}
      profile={profile}
      user={user}
      onSaveSeniority={onSaveSeniority}
      onStartInterview={onStartInterview}
      onUpdateProfile={onUpdateProfile}
    />
  );
}

function SeniorityGate({
  bidPack,
  seniority,
  profile,
  user,
  onSaveSeniority,
  onStartInterview,
  onUpdateProfile,
}: {
  bidPack: BidPack;
  seniority: SeniorityInput | null;
  profile: PreferenceProfile | null;
  user: UserAccount | null;
  onSaveSeniority: (input: SeniorityInput) => void;
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
      onEditSeniority={() => setEditing(true)}
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
      <Heading as="h1" className="text-2xl text-ink sm:text-3xl">Where do you rank?</Heading>
      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
        Every strategy below is built from the real lines in your {bidPack.base} {bidPack.aircraft}{" "}
        {bidPack.seat} pack. Your seniority number just tells Line Select which of those moves are
        realistic for you versus a reach — nothing here reads your name or employee number, and
        this stays on this device.
      </p>

      <form
        className="mt-6 space-y-4"
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
          label="Total pilots holding this seat at this domicile"
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
    </div>
  );
}

function StrategyResults({
  bidPack,
  seniority,
  profile,
  user,
  onEditSeniority,
  onStartInterview,
  onUpdateProfile,
}: {
  bidPack: BidPack;
  seniority: SeniorityInput;
  profile: PreferenceProfile | null;
  user: UserAccount | null;
  onEditSeniority: () => void;
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

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Heading as="h1" className="text-2xl text-ink sm:text-3xl">Your strategies</Heading>
          <p className="mt-1.5 text-sm text-ink-muted">
            Seniority #{seniority.rank} of {seniority.totalPilots} in {bidPack.base}{" "}
            {bidPack.aircraft} {bidPack.seat}
            {strongCount > 0 && (
              <>
                {" "}
                &mdash;{" "}
                <span className="font-medium text-good">
                  {strongCount} {strongCount === 1 ? "move" : "moves"} at strong odds
                </span>
              </>
            )}
          </p>
        </div>
        <Button variant="secondary" onClick={onEditSeniority}>
          Update seniority
        </Button>
      </div>

      <p className="mt-4 rounded-lg border border-border-strong bg-canvas px-3.5 py-2.5 text-xs leading-relaxed text-ink-faint">
        Every strategy here works within FAR Part 117 duty and rest limits. &ldquo;Aggressive&rdquo;
        means legal and contractual leverage, never bent rest — that&rsquo;s not on the table
        regardless of how this board grows.
      </p>

      {!profile && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3.5">
          <p className="text-sm leading-relaxed text-ink">
            These are ranked by how rare each pattern is, not by what you&rsquo;d actually
            enjoy. Answer the preferences interview and Line Select will reorder them by how
            much you&rsquo;d personally prefer each one.
          </p>
          <Button onClick={onStartInterview} className="shrink-0">
            Take the interview
          </Button>
        </div>
      )}

      <div className="mt-6">
        <AutoBidPanel entries={autoBid} />
      </div>

      <div className="mt-6 space-y-4">
        {strategies.map((strategy, i) => (
          <StrategyCard
            key={strategy.id}
            strategy={strategy}
            topPick={!!profile && i === 0 && !strategy.isProcessTip}
            reaction={profile?.strategyReactions?.[strategy.id] ?? null}
            onReact={profile ? (reaction) => handleReaction(strategy.id, reaction) : undefined}
          />
        ))}
      </div>

      <div className="mt-6">
        <AwardHistoryPanel bidPack={bidPack} seniority={seniority} user={user} />
      </div>
    </div>
  );
}
