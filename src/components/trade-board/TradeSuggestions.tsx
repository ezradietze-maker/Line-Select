"use client";

import { useCallback, useEffect, useState } from "react";
import { TripSnapshotStats } from "@/components/trade-board/TradeBoardScreen";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Notice } from "@/components/ui/Notice";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { answerSuggestion, fetchSuggestions, findTradesNow, markTradeStepDone, type SuggestionsState } from "@/lib/trades/holding-client";
import type { TradeDeclineReason, TradeReason, TradeSuggestionView, TradeTrip } from "@/types/trade";

const DECLINE_REASONS: { reason: TradeDeclineReason; label: string }[] = [
  { reason: "trip", label: "I don't want that trip" },
  { reason: "notWorthIt", label: "Not worth the trouble" },
  { reason: "notNow", label: "Not right now" },
  { reason: "wrongHolding", label: "That's not what I hold" },
];

/** Answers from the other pilots show up without a reload, as the board's offers do. */
const REFRESH_MS = 20_000;

function tripName(trip: TradeTrip): string {
  const name = trip.pairingNumber ? `Pairing ${trip.pairingNumber}` : "A trip";
  if (!trip.date) return name;
  const date = new Date(`${trip.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return `${name}, ${date}`;
}

function signedHours(h: number): string {
  const total = Math.round(Math.abs(h) * 60);
  return `${h < 0 ? "−" : "+"}${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

const figure = (x: number | null) => (x === null ? "none" : Number.isInteger(x) ? String(x) : x.toFixed(1));

function Reason({ reason }: { reason: TradeReason }) {
  return (
    <li className={reason.better ? "text-ink-muted" : "text-warn"}>
      {reason.better ? "Better: " : "Costs you: "}
      {reason.label} ({figure(reason.from)} → {figure(reason.to)} {reason.unit})
    </li>
  );
}

function TripBlock({ title, trip }: { title: string; trip: TradeTrip }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">{title}</div>
      <div className="mt-0.5 font-display text-sm font-semibold text-ink">{tripName(trip)}</div>
      <div className="mt-1">
        <TripSnapshotStats trip={trip} />
      </div>
    </div>
  );
}

function SuggestionCard({
  s,
  busy,
  onAnswer,
  onStep,
}: {
  s: TradeSuggestionView;
  busy: boolean;
  onAnswer: (answer: "accepted" | "declined", reason?: TradeDeclineReason | null) => void;
  onStep: (step: number) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const others = s.pilots.filter((p) => !p.isYou);
  const waitingOn = others.filter((p) => !p.accepted).map((p) => p.name);
  const { value } = s.you;

  // A trade that's off says so and no more: what it would have done is no use now.
  if (s.status === "cancelled" || s.status === "expired") {
    return (
      <div className="panel-glass p-4 text-sm text-ink-muted">
        <span className="font-medium text-ink">{s.size === 2 ? `Swap with ${others[0]?.name}` : `Chain of ${s.size} pilots`}:</span> {tripName(s.you.give)} for {tripName(s.you.take)}.{" "}
        {s.status === "expired"
          ? "Its deadline has passed."
          : s.cancelReason === "declined"
            ? "A pilot on it said no, so it's off."
            : s.cancelReason === "unanswered"
              ? "Not everyone answered in time, so it's off and you're free for other trades."
              : "Someone's trips changed, so it no longer stands."}
      </div>
    );
  }

  return (
    <div className="panel-glass p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-display text-base font-semibold text-ink">{s.size === 2 ? `Swap with ${others[0]?.name}` : `Chain of ${s.size} pilots`}</div>
        <div className="font-mono text-xs text-good">
          +{value.gain.toFixed(1)} on your score ({value.before.toFixed(1)} → {value.after.toFixed(1)})
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <TripBlock title="You give" trip={s.you.give} />
        <TripBlock title="You get" trip={s.you.take} />
      </div>

      <ul className="mt-3 space-y-0.5 text-sm">
        {value.reasons.map((r) => (
          <Reason key={r.label} reason={r} />
        ))}
        <li className="text-ink-muted">
          Credit for the month: {signedHours(value.creditChange)}
          {value.daysOffChange !== 0 && ` · days off: ${value.daysOffChange > 0 ? "+" : "−"}${Math.abs(value.daysOffChange)}`}
        </li>
      </ul>
      {value.creditChange !== 0 && <p className="mt-1 text-xs text-ink-faint">Your line guarantee moves by the difference in the trips&rsquo; value (contract 4.I.2).</p>}

      {s.size > 2 && (
        <div className="mt-3 text-sm text-ink-muted">
          <div className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">Who&rsquo;s on it</div>
          <ul className="mt-1 space-y-0.5">
            {s.pilots.map((p, i) => (
              <li key={i}>
                {p.isYou ? "You" : p.name} {p.isYou ? "give" : "gives"} {tripName(p.gives)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.slowChainWarning && (s.status === "proposed" || s.status === "accepted") && (
        <Notice tone="warn" className="mt-3">
          A chain is {s.size - 1} trades in a row in VIPS. Until real-time trading starts with the August 2027 bid period, a later trade may have to wait for an earlier one. If someone stops
          partway, you could be left holding a trip you didn&rsquo;t want.
        </Notice>
      )}

      {s.status === "proposed" && (
        <div className="mt-4">
          {s.you.answer === "waiting" && declining ? (
            <div>
              <p className="text-sm text-ink-muted">What&rsquo;s the main reason? It shapes what you&rsquo;re offered next.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {DECLINE_REASONS.map(({ reason, label }) => (
                  <Button key={reason} variant="secondary" disabled={busy} onClick={() => onAnswer("declined", reason)}>
                    {label}
                  </Button>
                ))}
                <Button variant="ghost" disabled={busy} onClick={() => onAnswer("declined")}>
                  Skip
                </Button>
              </div>
            </div>
          ) : s.you.answer === "waiting" ? (
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => onAnswer("accepted")}>
                I&rsquo;d do this
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setDeclining(true)}>
                No thanks
              </Button>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">You&rsquo;re in. Waiting on {waitingOn.join(", ")}. Don&rsquo;t submit anything yet.</p>
          )}
          <p className="mt-2 text-xs text-ink-faint">Nothing happens until everyone has said yes, and one no cancels it for everyone. It&rsquo;s still your call in VIPS.</p>
        </div>
      )}

      {(s.status === "accepted" || s.status === "done") && (
        <div className="mt-4">
          <div className="font-mono text-[11px] uppercase tracking-wide text-ink-faint">{s.status === "done" ? "Done" : "Everyone said yes. Submit these in VIPS, in this order"}</div>
          <ol className="mt-2 space-y-3">
            {s.steps.map((step, i) => (
              <li key={i} className={`text-sm ${step.yours ? "text-ink" : "text-ink-muted"}`}>
                <div>
                  {i + 1}.{" "}
                  {step.youAreB
                    ? `You trade ${tripName(step.bGives)} with ${step.pilotA} for ${tripName(step.aGives)}`
                    : `${step.youAreA ? "You trade" : `${step.pilotA} trades`} ${tripName(step.aGives)} with ${step.pilotB} for ${tripName(step.bGives)}`}
                  {step.done && <span className="ml-2 text-good">Done</span>}
                </div>
                {step.yours && step.youHoldAfter && <div className="text-xs text-ink-muted">After this you hold {tripName(step.youHoldAfter)}.</div>}
                {step.canMarkDone && (
                  <Button variant="secondary" className="mt-1.5" disabled={busy} onClick={() => onStep(i)}>
                    It went through
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

    </div>
  );
}

/**
 * "Trades found for you": trades that leave everyone on them better off, by each pilot's own priorities. Everyone answers
 * here, and each pilot then submits their own trades in VIPS: nothing here touches FedEx. `onlyWaiting` is the Inbox's view.
 */
export function TradeSuggestions({ packId, onlyWaiting = false }: { packId: string; onlyWaiting?: boolean }) {
  const [state, setState] = useState<SuggestionsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [finding, setFinding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The server turned the last check away for asking too often: said, rather than the list silently going stale. */
  const [limited, setLimited] = useState(false);

  const take = useCallback((next: SuggestionsState | "limited" | null) => {
    if (next === "limited") return setLimited(true);
    if (!next) return;
    setLimited(false);
    setState(next);
  }, []);

  const refresh = useCallback(async () => {
    take(await fetchSuggestions(packId));
  }, [packId, take]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      void fetchSuggestions(packId).then((next) => {
        if (!cancelled) take(next);
      });
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [packId, take]);

  async function find() {
    setFinding(true);
    setError(null);
    setMessage(null);
    const outcome = await findTradesNow(packId);
    setFinding(false);
    if (!outcome) return setError("Couldn't look for trades just now. Try again in a moment.");
    if (outcome.status === "busy") return setMessage("Another pilot's search is running for this seat. Try again in a moment.");
    if (outcome.status === "closed") return setMessage("Trades open once enough pilots in your seat are using Line Select.");
    if (outcome.status === "not-ready") return setMessage("Your account doesn't have this bid pack yet. Give it a moment to save, then try again.");
    if (outcome.status === "pack-differs")
      return setMessage("Your copy of this bid pack doesn't match the one most pilots in your seat confirmed their trips on. Upload the pack again, then confirm what you hold.");
    setMessage(
      outcome.found > 0
        ? `Found ${outcome.found} new trade${outcome.found === 1 ? "" : "s"} in your seat. Any that include you are listed here.`
        : `Nothing new that helps everyone on it, with ${outcome.pilots} pilot${outcome.pilots === 1 ? "" : "s"} in your seat taking part so far. It gets better as more join.`
    );
    await refresh();
  }

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    if (!result.ok) setError(result.error ?? "That didn't save. Check your connection and try again.");
    await refresh();
    setBusy(false);
  }

  const limitedNotice = limited && (
    <Notice tone="info" className="mt-3">
      Line Select is open in several windows, so these trades stopped updating for a few minutes. Close the extra windows
      and they pick up again on their own.
    </Notice>
  );
  if (!state) return limitedNotice || null;
  const list = onlyWaiting ? state.suggestions.filter((s) => s.status === "proposed" && s.you.answer === "waiting") : state.suggestions;
  if (onlyWaiting && list.length === 0) return null;
  const { ready } = state;

  return (
    <section className="mt-8">
      <SectionHeading count={list.length}>Trades found for you</SectionHeading>
      {error && <ErrorBanner className="mt-3">{error}</ErrorBanner>}
      {limitedNotice}
      <div className="mt-3 space-y-3">
        {list.map((s) => (
          <SuggestionCard key={s.id} s={s} busy={busy} onAnswer={(answer, reason) => {
              if (reason === "wrongHolding") setMessage("Thanks. Update what you hold above so the next suggestions are right.");
              void run(() => answerSuggestion(s.id, answer, reason ?? null));
            }} onStep={(step) => void run(() => markTradeStepDone(s.id, step))} />
        ))}
      </div>
      {!onlyWaiting && (
        <div className="mt-3">
          {!ready.holding || !ready.suggestMe || !ready.interview ? (
            <p className="text-sm text-ink-muted">
              {!ready.interview ? "Finish your interview first: trades are judged by your own priorities." : !ready.holding ? "Confirm what you hold above, and the site can look for trades." : "You've turned suggestions off above."}
            </p>
          ) : (
            <>
              <Button variant="secondary" disabled={finding} onClick={() => void find()}>
                {finding ? "Looking…" : "Find trades"}
              </Button>
              <p className="mt-1.5 text-xs text-ink-faint">
                {state.confirmedPilots} pilot{state.confirmedPilots === 1 ? "" : "s"} in your domicile, aircraft and seat taking part this month.
              </p>
            </>
          )}
          {message && <p className="mt-2 text-sm text-ink-muted">{message}</p>}
        </div>
      )}
    </section>
  );
}
