"use client";

import { useMemo, useState } from "react";
import { AutoBidPanel } from "@/components/strategies/AutoBidPanel";
import { StrategyCard } from "@/components/strategies/StrategyCard";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { buildAutoBid, generateStrategies } from "@/lib/strategy-engine";
import type { BidPack } from "@/types/bidpack";
import type { SeniorityInput } from "@/types/strategy";

interface StrategiesScreenProps {
  bidPack: BidPack | null;
  seniority: SeniorityInput | null;
  onSaveSeniority: (input: SeniorityInput) => void;
  onGoToUpload: () => void;
}

export function StrategiesScreen({
  bidPack,
  seniority,
  onSaveSeniority,
  onGoToUpload,
}: StrategiesScreenProps) {
  if (!bidPack) {
    return (
      <div className="mx-auto w-full max-w-md animate-fade-in text-center">
        <h1 className="text-xl font-semibold text-ink sm:text-2xl">Upload a bid pack first</h1>
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
      onSaveSeniority={onSaveSeniority}
    />
  );
}

function SeniorityGate({
  bidPack,
  seniority,
  onSaveSeniority,
}: {
  bidPack: BidPack;
  seniority: SeniorityInput | null;
  onSaveSeniority: (input: SeniorityInput) => void;
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
    <StrategyResults bidPack={bidPack} seniority={seniority} onEditSeniority={() => setEditing(true)} />
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
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Where do you rank?</h1>
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
  onEditSeniority,
}: {
  bidPack: BidPack;
  seniority: SeniorityInput;
  onEditSeniority: () => void;
}) {
  const strategies = useMemo(() => generateStrategies(bidPack, seniority), [bidPack, seniority]);
  const autoBid = useMemo(() => buildAutoBid(strategies), [strategies]);
  const strongCount = strategies.filter((s) =>
    s.lines.some((l) => l.feasibility === "strong")
  ).length;

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Your strategies</h1>
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

      <div className="mt-6">
        <AutoBidPanel entries={autoBid} />
      </div>

      <div className="mt-6 space-y-4">
        {strategies.map((strategy) => (
          <StrategyCard key={strategy.id} strategy={strategy} />
        ))}
      </div>
    </div>
  );
}
