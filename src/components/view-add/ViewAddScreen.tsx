"use client";

import { DateTime } from "luxon";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ConnectFedexPanel } from "@/components/fedex-connect/ConnectFedexPanel";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FIELD } from "@/components/ui/field";
import { Notice } from "@/components/ui/Notice";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { eventInstant } from "@/lib/bid-calendar";
import { loadCarryIn } from "@/lib/carry-in-storage";
import { buildViewAdd, viewAddCopyText, type ViewAddChoice, type ViewAddPlan } from "@/lib/view-add";
import { placeInPack } from "@/lib/strategy-engine";
import { vacationId } from "@/lib/vacation-lines";
import { vacationsInReach } from "@/lib/vacation-slide";
import type { BidPack, Trip } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";

const CHOICES_SHOWN = 15;
const VIPS_MENU = "https://pilot.fedex.com/vips-bin/vipscgi?webmenu?all";

const name = (t: Trip) => (t.pairingNumber ? `trip ${t.pairingNumber}` : "a trip");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function ChoiceRow({ choice, index, byModel }: { choice: ViewAddChoice; index: number; byModel: boolean }) {
  return (
    <li className="text-xs text-ink-muted">
      <span className="font-medium text-ink">
        {index + 1}. {choice.text}.
      </span>{" "}
      {choice.why}
      {byModel && choice.score !== null ? ` Scores ${choice.score.toFixed(1)}.` : ""}
      {choice.check.map((c) => (
        <span key={c} className="block text-ink-faint">
          Check: {c}
        </span>
      ))}
    </li>
  );
}

function Plan({ plan }: { plan: ViewAddPlan }) {
  const [all, setAll] = useState(false);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const best = plan.combos[0];
  const shown = all ? plan.choices : plan.choices.slice(0, CHOICES_SHOWN);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(viewAddCopyText(plan));
      setCopied("yes");
    } catch {
      setCopied("no");
    }
  };

  return (
    <div className="mt-4 space-y-3">
      {plan.flown.dropped.length > 0 && (
        <p className="text-sm text-ink">
          Your carry-in drops {plan.flown.dropped.map((d) => `${name(d.trip)} (${d.makeUpCH.toFixed(1)} CH)`).join(" and ")}, so you&rsquo;re eligible to make that up (CBA 2026 25.F.5).
        </p>
      )}
      {best ? (
        <p className="text-sm text-ink">
          <span className="font-medium">Best combination:</span> {best.trips.map(name).join(" and ")}, {best.totalCH.toFixed(1)} CH
          {best.shortCH > 0 ? `, ${best.shortCH.toFixed(1)} CH short of your ${plan.targetCH.toFixed(1)}` : ""}. It leaves {plural(best.daysOffAfter, "day")} off{best.longestOff ? `, ${best.longestOff} in a row` : ""}
          {best.workStretches !== null ? `, in ${plural(best.workStretches, "stretch").replace("stretchs", "stretches")} of work` : ""}.
        </p>
      ) : (
        <p className="text-sm text-ink">{plan.targetCH > 0 ? "No legal combination of these trips makes up your hours." : "You've no make-up hours entered, so this is just the open trips, best for you first."}</p>
      )}
      {plan.combos.length > 1 && (
        <p className="text-xs text-ink-muted">
          Also close: {plan.combos.slice(1).map((c) => `${c.trips.map(name).join(" and ")} (${c.totalCH.toFixed(1)} CH, ${c.daysOffAfter} days off)`).join("; ")}.
        </p>
      )}

      {plan.choices.length > 0 && (
        <>
          <ol className="space-y-1.5">
            {shown.map((c, i) => (
              <ChoiceRow key={`${c.text}-${i}`} choice={c} index={i} byModel={plan.byModel} />
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={copy}>
              Copy my list
            </Button>
            {plan.choices.length > CHOICES_SHOWN && (
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setAll((v) => !v)}>
                {all ? "Show fewer" : `Show all ${plan.choices.length}`}
              </Button>
            )}
            {copied === "yes" && <span className="text-xs text-ink-muted">Copied.</span>}
          </div>
          {copied === "no" && <textarea readOnly aria-label="Your list, to copy" className={`${FIELD} h-32 w-full text-xs`} value={viewAddCopyText(plan)} />}
        </>
      )}

      {plan.fromPackOnly && <p className="text-xs text-ink-faint">From your bid pack alone: trips other pilots drop in conflicts join open time later, and some of these may be gone. Paste VIPS&rsquo;s list above during the window for the real thing.</p>}
      {(plan.notRead.length > 0 || plan.notInPack.length > 0) && (
        <p className="text-xs text-ink-muted">
          {plan.notInPack.length > 0 && `Not in this pack, so left off: ${plan.notInPack.join("; ")}. `}
          {plan.notRead.length > 0 && `Couldn't read: ${plan.notRead.join("; ")}.`}
        </p>
      )}
      {plan.dateChecks.length > 0 && (
        <p className="text-xs text-warn">
          Check the date against VIPS — the pack has these a day from the date shown, or on two days next to each other, and we took the nearest: {plan.dateChecks.join("; ")}.
        </p>
      )}
      {plan.ruledOut.length > 0 && (
        <details className="text-xs text-ink-muted">
          <summary className="cursor-pointer">{plural(plan.ruledOut.length, "trip")} ruled out</summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {plan.ruledOut.slice(0, 40).map((r) => (
              <li key={`${r.trip.id}@${r.trip.startDayIndex}`}>
                {name(r.trip)}: {r.why}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

interface ViewAddScreenProps {
  bidPack: BidPack | null;
  /** To find the pilot's vacation in the pack; without it, none is checked. */
  seniority: SeniorityInput | null;
  profile: PreferenceProfile | null;
  userId: string | null;
  onGoToUpload: () => void;
  onTrySample?: () => void;
}

export function ViewAddScreen({ bidPack, seniority, profile, userId, onGoToUpload, onTrySample }: ViewAddScreenProps) {
  if (!bidPack) {
    return (
      <EmptyState
        title="Upload a bid pack first"
        description="Your View/Add list is built from your bid pack's own open trips, so upload one before Line Select can find them."
        actionLabel="Upload bid pack"
        onAction={onGoToUpload}
        secondaryLabel={onTrySample ? "Or try it with sample data" : undefined}
        onSecondary={onTrySample}
      />
    );
  }
  return <ViewAddBuilder key={bidPack.id} bidPack={bidPack} seniority={seniority} profile={profile} userId={userId} />;
}

/** What to bid in View/Add once the award's in: the open trips legal on the pilot's line, the combination that wins back the hours, and the list to copy. Nothing is sent to VIPS from here. */
function ViewAddBuilder({ bidPack, seniority, profile, userId }: { bidPack: BidPack; seniority: SeniorityInput | null; profile: PreferenceProfile | null; userId: string | null }) {
  const logged = useMemo(() => (profile?.logbook ?? []).find((m) => m.month === bidPack.month && m.outcome === "line")?.lineNumber ?? "", [profile?.logbook, bidPack.month]);
  const [lineNumber, setLineNumber] = useState(logged);
  const [cia, setCia] = useState("");
  const [muv, setMuv] = useState("");
  const [pasted, setPasted] = useState("");
  const [labels, setLabels] = useState("");
  const [plan, setPlan] = useState<ViewAddPlan | null>(null);
  const line = bidPack.lines.find((l) => l.lineNumber === lineNumber.trim());
  const hasOpen = !!bidPack.openPairings;
  const seat = bidPack.seat === "CAP" ? /\bCap/i : /F\s*\/\s*O/i;
  const windowOpens = (bidPack.bidCalendar ?? []).find((e) => /View\/Add\s+Input\s+Window\s+Opens/i.test(e.text) && e.text.startsWith(bidPack.month) && (!/\b(Cap|F\/O)\b/i.test(e.text) || seat.test(e.text)));
  const opensAt = windowOpens ? eventInstant(windowOpens, bidPack.base) : null;

  const build = () => {
    if (!line) return;
    const carry = loadCarryIn(userId, bidPack.id);
    const number = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? undefined : Number(v));
    setPlan(
      buildViewAdd({
        pack: bidPack,
        line,
        carryIn: carry.items,
        elections: carry.elections,
        makeUp: { cia: number(cia), muv: number(muv) },
        pasted,
        labels,
        vacations: seniority ? vacationsInReach(placeInPack(bidPack, seniority).me?.vacations ?? [], bidPack).filter((v) => carry.vacationChoices?.[vacationId(v)] !== "not-taking") : [],
        model: profile?.pilotModel,
      })
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow={packEyebrow(bidPack)}
        title="Your View/Add list"
        description="The open trips that are legal on your awarded line, the combination that wins back your make-up with the most days off, and the list to enter."
      />
      <Notice className="mt-4">
        <span className="block">
          <span className="font-medium text-ink">What it&rsquo;s for:</span> building one list of open trips to bid, in order, to win back phase-in or vacation make-up. Bids are awarded in seniority order, so the list goes on past your first choices.
        </span>
        <span className="mt-1 block">
          <span className="font-medium text-ink">When to use it:</span> during the View/Add window, which opens when conflict processing closes and runs at least 48 hours (CBA 2026 25.E.4). Once that&rsquo;s over, use{" "}
          <Link href="/open-time" className="underline underline-offset-2 hover:text-ink">
            Open Time
          </Link>
          .
        </span>
      </Notice>
      <section aria-label="View/Add list" className="panel-glass mt-6 p-4 sm:p-5 print:hidden">
        {!hasOpen && bidPack.bidPeriodStart && <p className="mt-2 text-xs text-ink">This pack was saved before we kept its open trips. Upload it again to see them, or paste VIPS&rsquo;s list below.</p>}
        {!bidPack.bidPeriodStart && <p className="mt-2 text-xs text-ink">This pack&rsquo;s trips aren&rsquo;t on dates, so we can&rsquo;t check them against your line.</p>}

        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-ink-muted">
            Your awarded line
            <input className={`${FIELD} mt-1 block w-full`} value={lineNumber} onChange={(e) => setLineNumber(e.target.value)} placeholder="1025" inputMode="numeric" />
          </label>
          <label className="text-xs text-ink-muted">
            Phase-in make-up (CIA), CH
            <input className={`${FIELD} mt-1 block w-full`} value={cia} onChange={(e) => setCia(e.target.value)} placeholder="From your carry-in" inputMode="decimal" />
          </label>
          <label className="text-xs text-ink-muted">
            Vacation make-up (MUV), CH
            <input className={`${FIELD} mt-1 block w-full`} value={muv} onChange={(e) => setMuv(e.target.value)} placeholder="0" inputMode="decimal" />
          </label>
        </div>
        {lineNumber.trim() !== "" && !line && <p className="mt-1 text-xs text-danger">Line {lineNumber.trim()} isn&rsquo;t in this pack.</p>}

        <label className="mt-3 block text-xs text-ink-muted">
          VIPS&rsquo;s open-time list, pasted (trip number and date on each line). Optional until the window opens.
          <textarea className={`${FIELD} mt-1 block h-20 w-full`} value={pasted} onChange={(e) => setPasted(e.target.value)} />
        </label>
        <label className="mt-2 block text-xs text-ink-muted">
          Any reserve blocks or simulator events you want, by label, one a line. They go after the trips, as typed.
          <textarea className={`${FIELD} mt-1 block h-14 w-full`} value={labels} onChange={(e) => setLabels(e.target.value)} />
        </label>

        <Button variant="secondary" className="mt-3 px-3 py-1.5 text-xs" disabled={!line} onClick={build}>
          Build my list
        </Button>

        {plan && <Plan plan={plan} />}

        <div className="mt-4 border-t border-hairline pt-3 text-xs text-ink-muted">
          <p className="font-medium text-ink">To enter it</p>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>
              Open the{" "}
              <a href={VIPS_MENU} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">
                VIPS menu
              </a>{" "}
              during the View/Add window{opensAt ? ` (it opens ${DateTime.fromISO(opensAt, { zone: "America/Chicago" }).toFormat("LLL d, HH:mm 'CT'")})` : ""}, and go to your make-up bids.
            </li>
            <li>Enter each choice in order: by trip number with its date, reserve block label or simulator event label (CBA 2026 25.E.4).</li>
            <li>Check the trip&rsquo;s date against VIPS: we show the pairing page&rsquo;s date, which can be a day off the line grid&rsquo;s.</li>
          </ol>
          <p className="mt-1 text-ink-faint">We don&rsquo;t send this for you yet: a current pilot has to confirm VIPS&rsquo;s form first. Our reading of the contract, not an official award.</p>
        </div>
      </section>

      <ConnectFedexPanel signedIn={!!userId} reads="your View/Add make-up list" />
    </div>
  );
}
