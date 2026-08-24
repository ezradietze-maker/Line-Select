"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { sameBidPack } from "@/lib/inbox";
import {
  acceptOffer,
  declineOffer,
  fetchTradeOffers,
  lineToSnapshot,
  postTradeOffer,
  respondToOffer,
  withdrawOffer,
} from "@/lib/trade-client";
import type { BidPack, Line } from "@/types/bidpack";
import type { UserAccount } from "@/types/auth";
import type { LineSnapshot, TradeOffer } from "@/types/trade";

function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

interface TradeBoardScreenProps {
  bidPack: BidPack | null;
  user: UserAccount | null;
  /** A synthetic, client-only offer for demo purposes — see `fake-trade-offers.ts`. */
  demoOffer?: TradeOffer | null;
  onAcceptDemoOffer?: () => void;
}

export function TradeBoardScreen({
  bidPack,
  user,
  demoOffer,
  onAcceptDemoOffer,
}: TradeBoardScreenProps) {
  const [offers, setOffers] = useState<TradeOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPostForm, setShowPostForm] = useState(false);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const data = await fetchTradeOffers();
    setOffers(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    // One-time fetch of the board on mount — a legitimate external-data
    // load, not state derived from props/state that belongs in render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  const realVisibleOffers = bidPack ? offers.filter((o) => sameBidPack(o, bidPack)) : offers;
  const visibleOffers = demoOffer && bidPack ? [demoOffer, ...realVisibleOffers] : realVisibleOffers;
  const needsResponse = visibleOffers.filter(
    (o) => o.status === "pending" && o.offeringUserId === user?.id
  );
  const myActivity = visibleOffers.filter(
    (o) =>
      (o.offeringUserId === user?.id || o.responderUserId === user?.id) &&
      !needsResponse.includes(o)
  );
  const openFromOthers = visibleOffers.filter(
    (o) => o.status === "open" && o.offeringUserId !== user?.id
  );

  async function runAction(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setActionError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) {
      setActionError(result.error ?? "Something went wrong. Try again.");
      return;
    }
    setShowPostForm(false);
    setRespondingTo(null);
    await refresh();
  }

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in">
      <h1 className="text-2xl font-semibold text-ink sm:text-3xl">Trade Board</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Find other pilots interested in trading and coordinate directly &mdash; nothing here
        finalizes a real trade.
      </p>

      <NonBindingDisclaimer />

      {!user && (
        <InfoBanner>
          Sign in to post an offer or propose a trade. You can still browse what&rsquo;s open
          below.
        </InfoBanner>
      )}
      {user && !bidPack && (
        <InfoBanner>Upload your bid pack to post an offer or propose a trade.</InfoBanner>
      )}

      {user && bidPack && !showPostForm && (
        <Button onClick={() => setShowPostForm(true)} className="mt-6">
          Post a trade offer
        </Button>
      )}

      {showPostForm && bidPack && (
        <PostOfferForm
          bidPack={bidPack}
          busy={busy}
          onCancel={() => setShowPostForm(false)}
          onSubmit={(input) => runAction(() => postTradeOffer(input))}
        />
      )}

      {actionError && (
        <div className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-ink-faint">Loading offers&hellip;</p>
      ) : (
        <div className="mt-8 space-y-8">
          {needsResponse.length > 0 && (
            <Section title="Needs your response">
              {needsResponse.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  currentUserId={user?.id}
                  busy={busy}
                  onAccept={() => runAction(() => acceptOffer(offer.id))}
                  onDecline={() => runAction(() => declineOffer(offer.id))}
                />
              ))}
            </Section>
          )}

          {myActivity.length > 0 && (
            <Section title="Your activity">
              {myActivity.map((offer) => (
                <OfferCard
                  key={offer.id}
                  offer={offer}
                  currentUserId={user?.id}
                  busy={busy}
                  onWithdraw={
                    offer.offeringUserId === user?.id &&
                    (offer.status === "open" || offer.status === "pending")
                      ? () => runAction(() => withdrawOffer(offer.id))
                      : undefined
                  }
                />
              ))}
            </Section>
          )}

          <Section title="Open offers from other pilots">
            {openFromOthers.length === 0 ? (
              <p className="text-sm text-ink-faint">
                No open offers right now{bidPack ? " for this bid pack" : ""}.
              </p>
            ) : (
              openFromOthers.map((offer) =>
                offer.isDemo ? (
                  <OfferCard
                    key={offer.id}
                    offer={offer}
                    currentUserId={user?.id}
                    busy={busy}
                    onAccept={user && bidPack ? onAcceptDemoOffer : undefined}
                  />
                ) : respondingTo === offer.id && bidPack ? (
                  <RespondForm
                    key={offer.id}
                    offer={offer}
                    bidPack={bidPack}
                    busy={busy}
                    onCancel={() => setRespondingTo(null)}
                    onSubmit={(line) =>
                      runAction(() => respondToOffer(offer.id, lineToSnapshot(line)))
                    }
                  />
                ) : (
                  <OfferCard
                    key={offer.id}
                    offer={offer}
                    currentUserId={user?.id}
                    busy={busy}
                    onRespond={user && bidPack ? () => setRespondingTo(offer.id) : undefined}
                  />
                )
              )
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

export function NonBindingDisclaimer() {
  return (
    <div className="mt-4 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3 text-sm leading-relaxed text-warn">
      <strong className="font-semibold">This board is not official.</strong> Agreeing to a
      trade here is not a real, legal schedule trade. Real trades have to go through FedEx&rsquo;s
      official scheduling process &mdash; rest rules, qualifications, and currency all get
      checked there, and this app has no way to verify any of that. Use this board to find and
      coordinate with another pilot only.
    </div>
  );
}

export function InfoBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-border bg-canvas px-4 py-3 text-sm text-ink-muted">
      {children}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

export function LineSnapshotStats({ line }: { line: LineSnapshot }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-ink-muted">
      <span>{line.daysOff} days off</span>
      <span>{formatHours(line.totalCreditHours)} credit</span>
      <span>{formatHours(line.totalTafbHours)} TAFB</span>
      <span>{line.totalLandings} ldgs</span>
      <span>
        {line.tripCount} trip{line.tripCount !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

export const STATUS_STYLES: Record<TradeOffer["status"], string> = {
  open: "bg-brand-soft text-brand",
  pending: "bg-accent-soft text-accent",
  accepted: "bg-good-soft text-good",
  declined: "bg-danger-soft text-danger",
  withdrawn: "bg-canvas text-ink-faint",
};

export const STATUS_LABELS: Record<TradeOffer["status"], string> = {
  open: "Open",
  pending: "Pending response",
  accepted: "Agreed",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export function OfferCard({
  offer,
  currentUserId,
  busy,
  onRespond,
  onAccept,
  onDecline,
  onWithdraw,
}: {
  offer: TradeOffer;
  currentUserId: string | undefined;
  busy: boolean;
  onRespond?: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
  onWithdraw?: () => void;
}) {
  const isMine = offer.offeringUserId === currentUserId;
  const isMyResponse = offer.responderUserId === currentUserId;

  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-ink">
            {isMine ? "You" : offer.offeringDisplayName} offering Line{" "}
            {offer.offeredLine.lineNumber}
            {offer.isDemo && (
              <span className="ml-2 rounded-full bg-ink-faint/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                Demo
              </span>
            )}
          </div>
          <div className="mt-1">
            <LineSnapshotStats line={offer.offeredLine} />
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[offer.status]}`}
        >
          {STATUS_LABELS[offer.status]}
        </span>
      </div>

      <div className="mt-3 text-sm text-ink-muted">
        Wants:{" "}
        {offer.wantedLineNumber ? (
          <span className="font-medium text-ink">Line {offer.wantedLineNumber} specifically</span>
        ) : (
          <span className="font-medium text-ink">open to any offer</span>
        )}
      </div>

      {offer.note && (
        <p className="mt-2 text-sm italic text-ink-muted">&ldquo;{offer.note}&rdquo;</p>
      )}

      {offer.responderLine && (
        <div className="mt-3 rounded-lg border border-border bg-canvas p-3">
          <div className="text-sm font-medium text-ink">
            {isMyResponse ? "You" : offer.responderDisplayName} proposed Line{" "}
            {offer.responderLine.lineNumber}
          </div>
          <div className="mt-1">
            <LineSnapshotStats line={offer.responderLine} />
          </div>
        </div>
      )}

      {offer.status === "accepted" && (
        <div className="mt-3 rounded-lg border border-good/30 bg-good-soft px-3.5 py-2.5 text-sm text-good">
          Agreed &mdash; now file this through the official trade process to make it real.
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {onRespond && (
          <Button variant="secondary" onClick={onRespond} disabled={busy}>
            Propose a trade
          </Button>
        )}
        {onAccept && (
          <Button onClick={onAccept} disabled={busy}>
            Accept
          </Button>
        )}
        {onDecline && (
          <Button variant="secondary" onClick={onDecline} disabled={busy}>
            Decline
          </Button>
        )}
        {onWithdraw && (
          <Button variant="ghost" onClick={onWithdraw} disabled={busy}>
            Withdraw
          </Button>
        )}
        {isMyResponse && offer.status === "pending" && (
          <span className="self-center text-xs text-ink-faint">
            Awaiting {offer.offeringDisplayName}&rsquo;s decision
          </span>
        )}
      </div>
    </div>
  );
}

function LineOptionLabel(line: Line): string {
  return `Line ${line.lineNumber} — ${line.daysOff} days off, ${formatHours(line.totalCreditHours)} credit`;
}

function PostOfferForm({
  bidPack,
  busy,
  onCancel,
  onSubmit,
}: {
  bidPack: BidPack;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: {
    bidPackMeta: { base: string; aircraft: string; seat: string; month: string };
    offeredLine: LineSnapshot;
    wantedLineNumber: string | null;
    note: string | null;
  }) => void;
}) {
  const [lineNumber, setLineNumber] = useState(bidPack.lines[0]?.lineNumber ?? "");
  const [wantedLineNumber, setWantedLineNumber] = useState("");
  const [note, setNote] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const line = bidPack.lines.find((l) => l.lineNumber === lineNumber);
    if (!line) return;
    onSubmit({
      bidPackMeta: {
        base: bidPack.base,
        aircraft: bidPack.aircraft,
        seat: bidPack.seat,
        month: bidPack.month,
      },
      offeredLine: lineToSnapshot(line),
      wantedLineNumber: wantedLineNumber.trim() || null,
      note: note.trim() || null,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-4 space-y-4 rounded-xl border border-border bg-surface p-5"
    >
      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="offer-line">
          Which of your lines are you offering?
        </label>
        <select
          id="offer-line"
          value={lineNumber}
          onChange={(e) => setLineNumber(e.target.value)}
          className="w-full rounded-md border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/40"
        >
          {bidPack.lines.map((line) => (
            <option key={line.lineNumber} value={line.lineNumber}>
              {LineOptionLabel(line)}
            </option>
          ))}
        </select>
      </div>

      <TextField
        label="Want a specific line back? (optional)"
        placeholder="e.g. 1101 — leave blank if open to any offer"
        value={wantedLineNumber}
        onChange={(e) => setWantedLineNumber(e.target.value)}
      />

      <div>
        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="offer-note">
          Note (optional)
        </label>
        <textarea
          id="offer-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Anything else worth mentioning"
          className="w-full rounded-md border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !lineNumber}>
          Post offer
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function RespondForm({
  offer,
  bidPack,
  busy,
  onCancel,
  onSubmit,
}: {
  offer: TradeOffer;
  bidPack: BidPack;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (line: Line) => void;
}) {
  const eligibleLines = offer.wantedLineNumber
    ? bidPack.lines.filter((l) => l.lineNumber === offer.wantedLineNumber)
    : bidPack.lines;
  const [lineNumber, setLineNumber] = useState(eligibleLines[0]?.lineNumber ?? "");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const line = bidPack.lines.find((l) => l.lineNumber === lineNumber);
    if (line) onSubmit(line);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-brand/30 bg-brand-soft p-5"
    >
      <div className="text-sm font-semibold text-ink">
        Propose a trade with {offer.offeringDisplayName}
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Offering their Line {offer.offeredLine.lineNumber} in exchange for one of your lines.
      </p>

      {eligibleLines.length === 0 ? (
        <p className="mt-3 text-sm text-danger">
          You don&rsquo;t have Line {offer.wantedLineNumber} in your bid pack, so you can&rsquo;t
          propose this trade.
        </p>
      ) : (
        <div className="mt-3">
          <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor={`respond-line-${offer.id}`}>
            Which of your lines?
          </label>
          <select
            id={`respond-line-${offer.id}`}
            value={lineNumber}
            onChange={(e) => setLineNumber(e.target.value)}
            className="w-full rounded-md border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/40"
          >
            {eligibleLines.map((line) => (
              <option key={line.lineNumber} value={line.lineNumber}>
                {LineOptionLabel(line)}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button type="submit" disabled={busy || eligibleLines.length === 0}>
          Send proposal
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
