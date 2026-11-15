"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { FIELD } from "@/components/ui/field";
import { NotamStrip } from "@/components/ui/NotamStrip";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { tripDateLabel } from "@/lib/brain/line-text";
import { formatHoursValue } from "@/lib/interview-config";
import { guaranteeShortfall, linePay, parseCreditHours, payClaimText } from "@/lib/pay/trip-guarantee";
import type { BidPack } from "@/types/bidpack";

const VIPS_MENU = "https://pilot.fedex.com/vips-bin/vipscgi?webmenu?all";
/** Credit to the minute, as the pack prints it: tenths showed an 18:56 trip as 18.9, and 18.9 paid as "0.0 CH" owed. */
const ch = (n: number) => `${formatHoursValue(n)} CH`;

export function PayCheckScreen({ bidPack, onGoToUpload, onTrySample }: { bidPack: BidPack | null; onGoToUpload: () => void; onTrySample?: () => void }) {
  const lines = useMemo(() => (bidPack ? bidPack.lines.filter((l) => l.trips.length > 0 && !l.estimated) : []), [bidPack]);
  const [lineNumber, setLineNumber] = useState<string>("");
  // Which of the line's trips, by place: a line flying the same trip on three dates holds three copies with one id, and
  // picking the second by id went back to the first.
  const [tripAt, setTripAt] = useState(0);
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
  const claimAt = pay && tripAt < pay.trips.length ? tripAt : 0;
  const claimTrip = pay?.trips[claimAt];
  const dateOf = (dayIndex: number | null) => tripDateLabel(bidPack, dayIndex) || null;
  const claimDate = claimTrip ? dateOf(claimTrip.trip.startDayIndex) : null;
  const paidNum = parseCreditHours(paid);
  const shortfall = claimTrip && paidNum !== null ? guaranteeShortfall(claimTrip.guaranteeCH, paidNum) : null;

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
            <select className={`${FIELD} mt-1 w-full`} value={line.lineNumber} onChange={(e) => { setLineNumber(e.target.value); setTripAt(0); }}>
              {lines.map((l) => (
                <option key={l.id} value={l.lineNumber}>Line {l.lineNumber}</option>
              ))}
            </select>
          </label>

          {/* Bid Line Guarantee */}
          {pay && (
            <section className="panel-glass mt-5 p-4 sm:p-5">
              <p className="text-2xs font-medium uppercase tracking-wide text-ink-faint">Bid Line Guarantee</p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-ink">{formatHoursValue(pay.blg)}<span className="ml-1 text-sm font-normal text-ink-faint">CH</span></p>
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
                {pay?.trips.map((t, i) => (
                  <tr key={`${t.trip.id}-${i}`} className="border-b border-hairline/60">
                    <td className="py-1.5 pr-3 font-medium text-ink">
                      {t.trip.pairingNumber ?? "—"}
                      {dateOf(t.trip.startDayIndex) && <span className="ml-2 font-normal text-ink-muted">{dateOf(t.trip.startDayIndex)}</span>}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-ink">{formatHoursValue(t.guaranteeCH)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-ink-muted">{formatHoursValue(t.rigCH)}</td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-ink-muted">{t.creditPerDayAway === null ? "—" : formatHoursValue(t.creditPerDayAway)}</td>
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
                  <select className={`${FIELD} mt-1 block`} value={claimAt} onChange={(e) => setTripAt(Number(e.target.value))}>
                    {pay?.trips.map((t, i) => (
                      <option key={`${t.trip.id}-${i}`} value={i}>
                        {t.trip.pairingNumber ?? "trip"}
                        {dateOf(t.trip.startDayIndex) ? ` on ${dateOf(t.trip.startDayIndex)}` : ""} ({ch(t.guaranteeCH)})
                      </option>
                    ))}
                  </select>
                </label>
                {/* A full keyboard, not a phone's decimal pad: that has no colon, so 14:30 couldn't be typed on one. */}
                <label className="text-xs text-ink-muted">
                  Credit you were actually paid
                  <input type="text" autoComplete="off" placeholder="e.g. 14:30" className={`${FIELD} mt-1 block w-32 font-mono`} value={paid} onChange={(e) => setPaid(e.target.value)} />
                </label>
              </div>
              {paid.trim() !== "" && paidNum === null && <p className="mt-2 text-xs text-warn">Type the credit as hours and minutes, 14:30, or as hours, 14.5.</p>}

              {shortfall !== null && paidNum !== null && (
                shortfall > 0 ? (
                  <div className="mt-4">
                    <p className="text-sm text-ink">
                      You may be owed <span className="font-semibold text-ink">{ch(shortfall)}</span> — the difference between the trip&rsquo;s {ch(claimTrip.guaranteeCH)} guarantee and the {ch(paidNum)} you were paid.
                    </p>
                    <p className="mt-2 text-2xs font-medium uppercase tracking-wide text-ink-faint">Draft claim</p>
                    <textarea
                      readOnly
                      className={`${FIELD} mt-1 h-28 w-full font-mono text-xs`}
                      value={payClaimText({ pack: bidPack, trip: claimTrip.trip, date: claimDate, guaranteeCH: claimTrip.guaranteeCH, paidCH: paidNum })}
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
