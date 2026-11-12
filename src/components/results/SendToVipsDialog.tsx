"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { contractQuestionHref } from "@/lib/contract/pack-facts";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { useAppState } from "@/lib/app-state";
import { effectiveBidClose } from "@/lib/bid-calendar";
import { loadCarryIn } from "@/lib/carry-in-storage";
import { forecastBid, type BidForecast } from "@/lib/forecast/forecast";
import { recommendVipsAnswers, type VipsRecommendation } from "@/lib/phase-in";
import { RESERVE_TYPE_LABEL, rankReserveLines } from "@/lib/reserve-rank";
import type { LineScore } from "@/lib/scoring";
import { deriveSeniorityInput } from "@/lib/seniority-derive";
import { fullBidOrder, runPresendChecks, vipsQuestionNotes, type CheckFix, type PresendCheck } from "@/lib/vips-presend";
import type { BidPack } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import {
  ANY_LINE_CODES,
  VIPS_BID_REVIEW_URL,
  VIPS_QUESTIONS,
  buildVipsBidFields,
  completeAnswers,
  getVipsAnswers,
  getVipsEmployeeNumber,
  normalizeEmployeeNumber,
  setVipsAnswers,
  setVipsEmployeeNumber,
  vipsBidInputUrl,
  type AnyLineKind,
  type VipsBidDraft,
} from "@/lib/vips-bid";

const ANY_LINE_LABELS: { kind: AnyLineKind; label: string }[] = [
  { kind: "regular", label: "Then any regular line" },
  { kind: "secondary", label: "Then any secondary line" },
  { kind: "reserve", label: "Then any reserve line" },
];

/** How many of the order to show before "and N more" — enough to recognise it's the right bid. */
const PREVIEW_COUNT = 12;

/** What the checks before sending read, beyond the order itself. */
export interface PresendContext {
  bidPack: BidPack;
  profile: PreferenceProfile;
  /** The forecast of the pilot's whole ranking, with its line ids. It answers for the bid only when the bid is that ranking. */
  rankedForecast: BidForecast | null;
  rankedIds: string[];
}

const CHECK_TONE: Record<PresendCheck["level"], string> = {
  stop: "bg-danger/15",
  warn: "bg-warning/15",
  info: "bg-canvas border border-hairline",
};

function CheckRow({ check, onFix }: { check: PresendCheck; onFix: (fix: Extract<CheckFix, { kind: "catch-all" }>) => void }) {
  const { fix } = check;
  return (
    <li className={`rounded-md px-3 py-2 text-xs leading-relaxed ${CHECK_TONE[check.level]}`} data-presend-check={check.id} data-level={check.level}>
      {check.message}
      {fix?.kind === "catch-all" && (
        <button type="button" onClick={() => onFix(fix)} className="ml-1.5 font-medium text-brand underline underline-offset-2">
          {fix.label}
        </button>
      )}
      {fix?.kind === "link" && (
        <Link href={fix.href} className="ml-1.5 font-medium text-brand underline underline-offset-2">
          {fix.label}
        </Link>
      )}
    </li>
  );
}

export function SendToVipsDialog({
  lineNumbers,
  lineScores,
  packLabel,
  leftOut,
  presend,
  onClose,
}: {
  /** The order to bid, best first — the same order "Copy line order" copies. */
  lineNumbers: string[];
  /** The same lines, scored. */
  lineScores: LineScore[];
  /** Month, base, fleet and seat of the pack these lines came from, to check against VIPS's own "You are bidding as…". */
  packLabel: string;
  /** Lines in the pack this order doesn't include (hidden, or put in Not bid) — they won't be bid. */
  leftOut: number;
  presend: PresendContext;
  onClose: () => void;
}) {
  const { seniority: savedSeniority, user } = useAppState();
  const [employee, setEmployee] = useState(() => getVipsEmployeeNumber() ?? "");
  const [employeeError, setEmployeeError] = useState<string | undefined>();
  const [answers, setAnswers] = useState<VipsBidDraft>(getVipsAnswers);
  const [anyLines, setAnyLines] = useState<AnyLineKind[]>([]);
  const [reserveAdded, setReserveAdded] = useState(false);
  const [sendAnyway, setSendAnyway] = useState(false);
  const [sent, setSent] = useState(false);
  const [openedAt] = useState(() => new Date());
  /** Asked for by a tap: it scores the whole pack both ways for each waiver. */
  const [advice, setAdvice] = useState<VipsRecommendation[] | null>(null);

  const { bidPack, profile, rankedForecast, rankedIds } = presend;
  const reserveLines = useMemo(() => rankReserveLines(bidPack, { model: profile.pilotModel, isCommuter: profile.isCommuter }), [bidPack, profile.pilotModel, profile.isCommuter]);
  const reserveNumbers = useMemo(() => reserveLines.map((l) => l.lineNumber), [reserveLines]);
  const forecast = useMemo(() => {
    const ids = lineScores.map((s) => s.line.id);
    if (rankedForecast && ids.join() === rankedIds.join()) return rankedForecast;
    return profile.seniorityNumber ? forecastBid({ bidPack, seniorityNumber: profile.seniorityNumber, myRanking: ids, simulations: 200 }) : null;
  }, [lineScores, rankedForecast, rankedIds, bidPack, profile.seniorityNumber]);
  const carryIn = useMemo(() => loadCarryIn(user?.id ?? null, bidPack.id), [user?.id, bidPack.id]);
  const checks = useMemo(
    () =>
      runPresendChecks({
        bidPack,
        lineNumbers,
        leftOut,
        lineScores,
        seniority: deriveSeniorityInput(bidPack, profile) ?? savedSeniority,
        forecast,
        reserveLines,
        anyLines,
        reserveLinesAdded: reserveAdded,
        close: effectiveBidClose(bidPack),
        now: openedAt,
        answers,
        carryInElections: carryIn.items.length ? carryIn.elections : null,
      }),
    [bidPack, lineNumbers, leftOut, lineScores, profile, savedSeniority, forecast, reserveLines, anyLines, reserveAdded, openedAt, answers, carryIn]
  );
  const stopped = checks.some((c) => c.level === "stop");
  // Lines that won't be bid are said at the top, by the order itself, not under the questions where they read as an
  // afterthought.
  const leftOutCheck = checks.find((c) => c.id === "left-out") ?? null;
  const laterChecks = checks.filter((c) => c !== leftOutCheck);
  const notes = useMemo(() => vipsQuestionNotes(bidPack, lineNumbers), [bidPack, lineNumbers]);

  // Named reserve lines sit between the secondary and reserve catch-alls, so the order goes in whole.
  const fullOrder = useMemo(() => fullBidOrder(lineNumbers, anyLines, reserveAdded ? reserveNumbers : []), [lineNumbers, anyLines, reserveAdded, reserveNumbers]);
  const build = useMemo(() => buildVipsBidFields({ lineNumbers: fullOrder, answers }), [fullOrder, answers]);
  const normalized = normalizeEmployeeNumber(employee);

  function applyFix(fix: Extract<CheckFix, { kind: "catch-all" }>) {
    setAnyLines(fix.anyLines);
    if (fix.reserveLines.length) setReserveAdded(true);
  }

  function toggleAnyLine(kind: AnyLineKind) {
    // Kept in the fixed regular → secondary → reserve order whatever order they're ticked in.
    setAnyLines((current) =>
      ANY_LINE_LABELS.map((a) => a.kind).filter((k) => (k === kind ? !current.includes(k) : current.includes(k)))
    );
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (stopped && !sendAnyway) {
      e.preventDefault();
      return;
    }
    if (!normalized) {
      e.preventDefault();
      setEmployeeError("Your FedEx employee number — digits only.");
      return;
    }
    // Let the browser post the form into its new tab; just remember this month's choices first.
    const complete = completeAnswers(answers);
    if (!complete) {
      e.preventDefault();
      return;
    }
    setVipsEmployeeNumber(normalized);
    setVipsAnswers(complete);
    setSent(true);
  }

  if (sent) {
    return (
      <Modal title="VIPS opened in a new tab" onClose={onClose}>
        <div className="space-y-3 text-sm leading-relaxed text-ink">
          <p>
            Sign in there with your PurpleID to finish. If VIPS shows the bid form empty, nothing reached it &mdash; on an
            iPhone or iPad, turn off Safari&rsquo;s <em>Request Desktop Website</em> for pilot.fedex.com and send again.
          </p>
          <p>
            Then open <strong>Monthly Bid Review</strong> in VIPS and check it lists your {build.ok ? build.lines.length : ""}{" "}
            {build.ok && build.lines.length === 1 ? "choice" : "choices"} in this order. You can send again any time before the bid closes; the last one VIPS accepts is the
            one that counts.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={VIPS_BID_REVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-on-brand transition-colors hover:bg-brand-strong"
            >
              Open Monthly Bid Review
            </a>
            <Button variant="secondary" onClick={() => setSent(false)}>
              Back
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Send this bid to VIPS" onClose={onClose}>
      <form
        method="POST"
        action={normalized ? vipsBidInputUrl(normalized) : undefined}
        target="_blank"
        onSubmit={handleSubmit}
        className="space-y-5 text-sm text-ink"
        data-vips-bid-form
      >
        <section>
          <p className="font-medium">
            {packLabel} &middot; {fullOrder.length} {fullOrder.length === 1 ? "choice" : "choices"}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Check VIPS says you&rsquo;re bidding this same domicile, fleet and seat before you submit.
          </p>
          {leftOutCheck && (
            <ul className="mt-2">
              <CheckRow check={leftOutCheck} onFix={applyFix} />
            </ul>
          )}
          {fullOrder.length > 0 && (
            <ol className="mt-2 flex flex-wrap gap-1.5 font-mono text-xs">
              {fullOrder.slice(0, PREVIEW_COUNT).map((n, i) => (
                <li key={n} className="rounded border border-hairline bg-canvas px-1.5 py-0.5">
                  <span className="text-ink-faint">{i + 1}.</span> {n}
                </li>
              ))}
              {fullOrder.length > PREVIEW_COUNT && (
                <li className="px-1 py-0.5 text-ink-muted">and {fullOrder.length - PREVIEW_COUNT} more</li>
              )}
            </ol>
          )}
        </section>

        <fieldset>
          <legend className="font-medium">If none of these are left</legend>
          <div className="mt-1.5 space-y-1">
            {ANY_LINE_LABELS.map(({ kind, label }) => (
              <label key={kind} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={anyLines.includes(kind)}
                  onChange={() => toggleAnyLine(kind)}
                  className="h-4 w-4 accent-brand"
                />
                {label} <span className="font-mono text-xs text-ink-faint">({ANY_LINE_CODES[kind]})</span>
              </label>
            ))}
          </div>
          {reserveLines.length > 0 && (
            <div className="mt-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={reserveAdded} onChange={(e) => setReserveAdded(e.target.checked)} className="h-4 w-4 accent-brand" data-reserve-lines />
                Name your {reserveLines.length} reserve lines, in your order, before any reserve line
              </label>
              <details className="mt-1 pl-6 text-xs text-ink-muted">
                <summary className="cursor-pointer">See the order</summary>
                <ol className="mt-1 space-y-0.5">
                  {reserveLines.map((l) => (
                    <li key={l.lineNumber}>
                      <span className="font-mono text-ink">{l.lineNumber}</span>
                      {l.reserveType ? ` ${RESERVE_TYPE_LABEL[l.reserveType]}` : ""}
                      {l.reason ? ` · ${l.reason}` : ""}
                    </li>
                  ))}
                </ol>
              </details>
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="font-medium">VIPS&rsquo;s bid questions</legend>
          <p className="text-xs leading-relaxed text-ink-faint">
            Answer each one &mdash; nothing is picked for you. The 2026 contract changes these questions from the
            December 2026 bid, so if VIPS shows different ones, answer them there before you submit.
          </p>
          <button
            type="button"
            onClick={() => setAdvice(recommendVipsAnswers({ pack: bidPack, order: lineNumbers, carryIn: carryIn.items, model: profile.pilotModel }))}
            className="text-xs font-medium text-brand underline underline-offset-2"
            data-vips-advice
          >
            What should I answer for this order?
          </button>
          {VIPS_QUESTIONS.map((q) => {
            const advised = advice?.find((a) => a.key === q.key);
            return (
            <div key={q.key} role="radiogroup" aria-label={q.text} className="flex items-start justify-between gap-4">
              <span className="text-xs leading-relaxed text-ink-muted">
                {q.text}
                <span className="mt-0.5 block text-ink-faint" data-vips-note={q.key}>
                  {notes[q.key].meaning}
                  {notes[q.key].forThisOrder ? ` ${notes[q.key].forThisOrder}` : ""}{" "}
                  <a href={contractQuestionHref(q.text)} target="_blank" rel="noopener" className="text-accent underline underline-offset-2">What does the contract say?</a>
                </span>
                {advised && (
                  <span className="mt-0.5 block text-ink" data-vips-advised={q.key}>
                    <span className="font-medium">{advised.answer === null ? "Your call." : advised.answer ? "We'd say Yes." : "We'd say No."}</span> {advised.reason} ({advised.section})
                  </span>
                )}
              </span>
              <span className="flex shrink-0 gap-3 pt-0.5">
                {(["Yes", "No"] as const).map((choice) => (
                  <label key={choice} className="flex items-center gap-1 text-xs">
                    <input
                      type="radio"
                      name={`vips-${q.key}`}
                      // Owned by no form, so these don't post their own fields to VIPS — the answers go as n003–n006 below.
                      form="vips-not-sent"
                      checked={answers[q.key] === (choice === "Yes")}
                      onChange={() => setAnswers((a) => ({ ...a, [q.key]: choice === "Yes" }))}
                      className="accent-brand"
                    />
                    {choice}
                  </label>
                ))}
              </span>
            </div>
            );
          })}
        </fieldset>

        <TextField
          label="FedEx employee number"
          inputMode="numeric"
          autoComplete="off"
          value={employee}
          error={employeeError}
          onChange={(e) => {
            setEmployee(e.target.value);
            setEmployeeError(undefined);
          }}
          aria-describedby="vips-employee-note"
        />
        <p id="vips-employee-note" className="-mt-3 text-xs text-ink-faint">
          VIPS needs it in the bid page&rsquo;s address. It stays in this browser and goes only to FedEx.
        </p>

        {build.ok &&
          build.fields.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}

        {!build.ok && <p className="text-xs text-danger">{build.reason}</p>}

        {laterChecks.length > 0 && (
          <section aria-label="Before you send">
            <h3 className="font-medium">Before you send</h3>
            <ul className="mt-1.5 space-y-1.5">
              {laterChecks.map((c) => (
                <CheckRow key={c.id} check={c} onFix={applyFix} />
              ))}
            </ul>
            {stopped && (
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={sendAnyway} onChange={(e) => setSendAnyway(e.target.checked)} className="h-4 w-4 accent-brand" data-send-anyway />
                I know, send it anyway
              </label>
            )}
          </section>
        )}

        <div className="space-y-2 border-t border-border pt-4">
          <Button type="submit" disabled={!build.ok || (stopped && !sendAnyway)} className="w-full">
            Open VIPS and send
          </Button>
          <p className="text-xs leading-relaxed text-ink-faint">
            Opens pilot.fedex.com in a new tab, where you sign in yourself &mdash; Line Select never sees your password.
            Not made or endorsed by FedEx; VIPS can change without notice, so always check Monthly Bid Review.
          </p>
        </div>
      </form>
    </Modal>
  );
}
