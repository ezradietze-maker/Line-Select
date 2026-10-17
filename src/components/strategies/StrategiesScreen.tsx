"use client";

import { useEffect, useMemo, useState } from "react";
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
import { attachScoreContext, computeStanding, generateStrategies, rankStrategiesByPreference, type Standing } from "@/lib/strategy-engine";
import { SENIORITY_BANDS } from "@/lib/seniority-bands";
import { learnFromStrategyReaction } from "@/lib/strategy-learning";
import type { AwardHistoryRecord } from "@/types/award-history";
import type { BidPack } from "@/types/bidpack";
import type { UserAccount } from "@/types/auth";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput, Strategy, StrategyId } from "@/types/strategy";

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
  /** Loads the built-in sample pack, for a pilot without one to hand. */
  onTrySample?: () => void;
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
  onTrySample,
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
        secondaryLabel={onTrySample ? "Or try it with sample data" : undefined}
        onSecondary={onTrySample}
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
    <div className="mx-auto w-full max-w-3xl">
      <div className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-accent">{packEyebrow(bidPack)}</div>
      <Heading as="h1" className="mt-1.5 text-3xl tracking-tight text-ink sm:text-4xl">Where do you rank?</Heading>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
        Every strategy below is built from the real lines in your {bidPack.base} {bidPack.aircraft}{" "}
        {bidPack.seat} pack. Your seniority number just tells Line Select which of those moves are
        realistic for you versus a reach — nothing here reads your name or employee number, and
        this stays on this device.
      </p>

      <form
        className="panel-glass mt-6 max-w-md space-y-4 p-5"
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
  const rankedLineIds = useMemo(() => ranked?.map((r) => r.line.id), [ranked]);

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
    const generated = generateStrategies(bidPack, seniority, awardSummary, { lineScores: ranked, isCommuter: profile?.isCommuter ?? null });
    const preferenceRanked = rankStrategiesByPreference(generated);
    return attachScoreContext(preferenceRanked, ranked);
  }, [bidPack, seniority, profile, ranked, awardSummary]);
  const standing = useMemo(() => computeStanding(bidPack, seniority), [bidPack, seniority]);

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

  const groups: { fit: Strategy["fit"]; title: string; note: string }[] = [
    { fit: "now", title: "For you this month", note: "Moves that apply at your number on this bid." },
    { fit: "maybe", title: "Depends on the month", note: "They apply in some months, or if the pilots above you bid differently." },
    { fit: "later", title: "Worth knowing", note: "For when your number moves, or a month with vacation." },
  ];
  const topPickId = null;

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
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow={packEyebrow(bidPack)}
        title="Your strategies"
        description={
          "Real bidding moves for where your seniority actually lands this month — read from your pack's seniority list, line counts, reserve guarantee and vacation schedule."
        }
        actions={
          <Button variant="secondary" onClick={onEditSeniority}>
            {fromProfile ? "Change seniority number" : "Update seniority"}
          </Button>
        }
      >
        <StandingPanel standing={standing} />
      </PageHeader>

      <Notice tone="warn" className="mt-4 text-xs">
        <span className="text-ink">
          <span className="font-semibold">Not FedEx&rsquo;s rules, and not a sure thing.</span> These moves are read from your bid pack&rsquo;s own
          numbers &mdash; the seniority list, line counts, reserve guarantee and vacation schedule &mdash; not from the contract or crew
          scheduling. Some may run into FedEx or ALPA rules, and none is a guaranteed way to bid. Check anything you rely on with your
          PSIT bid rep before the bid closes.
        </span>
      </Notice>

      {!profile && (
        <Notice
          tone="info"
          className="mt-3"
          action={<Button onClick={onStartInterview}>Take the interview</Button>}
        >
          <span className="text-ink">
            The moves already fit your number. Answer the interview and the lines inside them will be ordered by what you&rsquo;d actually
            want.
          </span>
        </Notice>
      )}

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

      {groups.map((g) => {
        const items = strategies.filter((st) => st.fit === g.fit);
        if (!items.length) return null;
        return (
          <section key={g.fit} className="mt-8">
            <SectionHeading count={items.length}>{g.title}</SectionHeading>
            <p className="mt-2 text-xs text-ink-faint">{g.note}</p>
            <div className="mt-3 space-y-4">{items.map(card)}</div>
          </section>
        );
      })}

      <div className="mt-10">
        <AwardHistoryPanel bidPack={bidPack} seniority={seniority} user={user} rankedLineIds={rankedLineIds} />
      </div>
    </div>
  );
}

/**
 * Where the pilot really stands this month: their printed number, the pilots above them who aren't bidding a line, and
 * their place among those who are — drawn against the pack's own regular, secondary and reserve lines.
 */
function StandingPanel({ standing: st }: { standing: Standing }) {
  const total = st.regular + st.secondary + st.reserve;
  const position = st.effective ?? st.printedBidNumber;
  const at = total > 0 ? Math.min(1, Math.max(0, (position - 0.5) / total)) : 0;
  const bands = [
    { label: "Regular", n: st.regular, cls: "bg-good/55" },
    { label: "Secondary", n: st.secondary, cls: "bg-accent/45" },
    { label: "Reserve", n: st.reserve, cls: "bg-standby/40" },
  ].filter((b) => b.n > 0);
  const bandWord = st.band === "regular" ? "a regular line" : st.band === "secondary" ? "a secondary line" : "reserve";
  return (
    <div className="panel-glass mt-5 p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">On the printed list</p>
          <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-ink">
            #{st.printedBidNumber} <span className="text-sm font-normal text-ink-faint">of {st.listSize}</span>
          </p>
        </div>
        {st.payAhead !== null && (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Above you, not bidding a line</p>
            <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-good">{st.payAhead}</p>
          </div>
        )}
        {st.effective !== null && (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">Your real place</p>
            <p className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-accent">
              #{st.effective} <span className="text-sm font-normal text-ink-faint">of {st.bidders} bidding</span>
            </p>
          </div>
        )}
      </div>
      {total > 0 && (
        <>
          <div className="relative mt-4 flex h-2.5 overflow-hidden rounded-full" role="img" aria-label={`Place ${position} of ${total}: ${bandWord} on the numbers`}>
            {bands.map((b) => (
              <div key={b.label} className={b.cls} style={{ width: `${(b.n / total) * 100}%` }} />
            ))}
          </div>
          <div className="relative h-0">
            <div className="absolute -top-[15px] h-5 w-1 -translate-x-1/2 rounded-full bg-ink shadow-[0_0_8px_var(--color-accent)]" style={{ left: `${at * 100}%` }} />
          </div>
          <div className="mt-1.5 flex text-[11px] text-ink-faint">
            {bands.map((b) => (
              <span key={b.label} style={{ width: `${(b.n / total) * 100}%` }} className="truncate">
                {b.label} · {b.n}
              </span>
            ))}
          </div>
          <p className="mt-2 text-sm text-ink">
            On the numbers, your place lands on <span className="font-semibold">{bandWord}</span> this month
            {st.band === "regular" ? ` — ${st.marginToRegular} inside the cutoff.` : st.band === "secondary" ? ` — ${-st.marginToRegular} past the last regular line.` : "."}
            {st.vacationDays > 0 && <span className="text-ink-muted"> You have {st.vacationDays} vacation days in it.</span>}
          </p>
        </>
      )}
      {st.effective === null && (
        <p className="mt-2 text-xs text-ink-faint">Re-upload your bid pack to read who on the list isn&rsquo;t bidding a line this month &mdash; it sharpens your real place.</p>
      )}
    </div>
  );
}
