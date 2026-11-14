"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { FIELD } from "@/components/ui/field";
import { NotamStrip } from "@/components/ui/NotamStrip";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { guaranteeShortfall, linePay } from "@/lib/pay/trip-guarantee";
import type { BidPack } from "@/types/bidpack";

const VIPS_MENU = "https://pilot.fedex.com/vips-bin/vipscgi?webmenu?all";
const ch = (n: number) => `${n.toFixed(1)} CH`;

export function PayCheckScreen({ bidPack, onGoToUpload, onTrySample }: { bidPack: BidPack | null; onGoToUpload: () => void; onTrySample?: () => void }) {
  const lines = useMemo(() => (bidPack ? bidPack.lines.filter((l) => l.trips.length > 0 && !l.estimated) : []), [bidPack]);
  const [lineNumber, setLineNumber] = useState<string>("");
  const [tripId, setTripId] = useState<string>("");
  const [paid, setPaid] = useState<string>("");

  if (!bidPack) {
    return (
      <EmptyState
        title="Upload a bid pack first"
        description="Pay check reads your trips’ scheduled credit straight from the bid pack, so upload one to see what each trip and line guarantees."
        actionLabel="Upload bid pack"
        onAction={onGoToUpload}
        secondaryLabel={onTrySample ? "Or try it with sample data" : undefined}
        onSecondary={onTrySample}
      />
    );
  }

  const line = lines.find((l) => l.lineNumber === lineNumber) ?? lines[0];
  const pay = line ? linePay(line, bidPack) : null;
  const claimTrip = pay?.trips.find((t) => t.trip.id === tripId) ?? pay?.trips[0];
  const paidNum = Number(paid);
  const paidValid = paid !== "" && Number.isFinite(paidNum) && paidNum >= 0;
  const shortfall = claimTrip && paidValid ? guaranteeShortfall(claimTrip.guaranteeCH, paidNum) : null;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow={packEyebrow(bidPack)}
        title="Pay check"
        description="What each trip and your whole line guarantee this bid period — the floors you're paid to however the month actually flies — read from the pack, with the contract section each comes from."
      />

      <NotamStrip className="mt-4" headline={<>Guaranteed minimums, not an official pay calculation.</>}>
        These are the floors the contract sets, read from your pack’s own scheduled credit and time away — not crew pay, and
        not a promise of what you’ll be paid. Rigs, premiums and adjustments can push actual pay higher. Confirm anything you
        claim with your PSIT bid rep. Line Select never submits anything.
      </NotamStrip>

      {!line ? (
        <p className="mt-6 text-sm text-ink-muted">This pack has no regular lines with trips to check.</p>
      ) : (
        <>
          <label className="mt-6 block max-w-xs">
            <span className="text-xs font-medium text-ink-muted">Line you hold (or expect to)</span>
            <select className={`${FIELD} mt-1 w-full`} value={line.lineNumber} onChange={(e) => { setLineNumber(e.target.value); setTripId(""); }}>
              {lines.map((l) => (
                <option key={l.id} value={l.lineNumber}>Line {l.lineNumber}</option>
              ))}
            </select>
          </label>

          {/* Bid Line Guarantee */}
          {pay && (
            <section className="panel-glass mt-5 p-4 sm:p-5">
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-faint">Bid Line Guarantee</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{pay.blg.toFixed(1)}<span className="ml-1 text-sm font-normal text-ink-faint">CH</span></p>
              <p className="mt-2 text-sm text-ink-muted">
                Line {line.lineNumber} guarantees <span className="font-medium text-ink">{ch(pay.blg)}</span> this bid period.{" "}
                {pay.flooredUp && pay.floor
                  ? <>Its trips add to {ch(pay.tripGuaranteeTotal)}, below the {ch(pay.floor.ch)} minimum for a {bidPack.bidPeriodDays}-day period, so the floor sets it (CBA 2026 4.A.1, 4.B).</>
                  : <>That&rsquo;s the sum of its {pay.trips.length} trips&rsquo; guarantees{pay.floor ? `, above the ${ch(pay.floor.ch)} floor` : ""} (CBA 2026 4.B).</>}
                {pay.carryOverCH > 0 ? <> The {ch(pay.carryOverCH)} of its carryover trip that falls in the next bid period is left out; it counts there (CBA 2026 4.B, 4.G).</> : null}
              </p>
            </section>
          )}

          {/* Per-trip guarantees */}
          <SectionHeading className="mt-8" count={pay?.trips.length}>Each trip&rsquo;s guarantee</SectionHeading>
          <p className="mt-2 text-xs text-ink-faint">The scheduled credit a trip is worth however it flies (CBA 2026 4.F.1), the trip rig under it (1 CH per 3.75h away, CBA 2026 4.F.2.a), and how hard its credit works per day away.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-md text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-2xs uppercase tracking-wide text-ink-faint">
                  <th className="py-1.5 pr-3 font-medium">Trip</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Guarantee</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Trip rig</th>
                  <th className="py-1.5 pr-3 text-right font-medium">CH / day away</th>
                </tr>
              </thead>
              <tbody>
                {pay?.trips.map((t) => (
                  <tr key={t.trip.id} className="border-b border-hairline/60">
                    <td className="py-1.5 pr-3 font-medium text-ink">{t.trip.pairingNumber ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-ink">{t.guaranteeCH.toFixed(1)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-ink-muted">{t.rigCH.toFixed(1)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-ink-muted">{t.creditPerDayAway?.toFixed(1) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Disruption claim helper */}
          <SectionHeading className="mt-8">Paid less than a trip guaranteed?</SectionHeading>
          <p className="mt-2 text-xs text-ink-faint">
            If a trip was reassigned, rebuilt, or cancelled and you were credited less than its guarantee, you&rsquo;re generally
            protected to the greater of its value when it was awarded/assigned or when you started flying it (CBA 2026 4.F.1). Check the shortfall and draft a claim.
          </p>
          {claimTrip && (
            <div className="panel-glass mt-3 p-4 sm:p-5">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-ink-muted">
                  Trip
                  <select className={`${FIELD} mt-1 block`} value={claimTrip.trip.id} onChange={(e) => setTripId(e.target.value)}>
                    {pay?.trips.map((t) => (
                      <option key={t.trip.id} value={t.trip.id}>{t.trip.pairingNumber ?? "trip"} ({t.guaranteeCH.toFixed(1)} CH)</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-ink-muted">
                  Credit you were actually paid
                  <input type="number" min={0} step="0.1" placeholder="e.g. 14.5" className={`${FIELD} mt-1 block w-32`} value={paid} onChange={(e) => setPaid(e.target.value)} />
                </label>
              </div>

              {shortfall !== null && (
                shortfall > 0 ? (
                  <div className="mt-4">
                    <p className="text-sm text-ink">
                      You may be owed <span className="font-semibold text-ink">{ch(shortfall)}</span> — the difference between the trip&rsquo;s {ch(claimTrip.guaranteeCH)} guarantee and the {ch(paidNum)} you were paid.
                    </p>
                    <p className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-faint">Draft claim</p>
                    <textarea
                      readOnly
                      className={`${FIELD} mt-1 h-28 w-full font-mono text-xs`}
                      value={`Pay claim — trip ${claimTrip.trip.pairingNumber ?? ""}, ${bidPack.base} ${bidPack.aircraft} ${bidPack.seat}, bid period ${bidPack.month}.\n\nThe trip's scheduled credit (trip guarantee) was ${claimTrip.guaranteeCH.toFixed(1)} CH. I was credited ${paidNum.toFixed(1)} CH. Under CBA 2026 Section 4.F.1, a pilot's trip guarantee is the greater of the trip's scheduled credit value when it was awarded/assigned or when the pilot started flying it. I am claiming the ${shortfall.toFixed(1)} CH difference.`}
                    />
                    <p className="mt-2 text-xs text-ink-faint">
                      Our reading of the contract, not an official award — confirm the numbers and file it through the company&rsquo;s own pay-claim process.{" "}
                      <a href={VIPS_MENU} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-ink">Open the VIPS menu</a>.
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-ink-muted">That&rsquo;s at or above the trip&rsquo;s {ch(claimTrip.guaranteeCH)} guarantee — nothing to claim on the guarantee itself. Rigs or premiums may still apply.</p>
                )
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
