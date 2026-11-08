"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { NumberTicker } from "@/components/ui/NumberTicker";
import { NightGlobe } from "@/components/welcome/NightGlobe";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { CalendarSubscribe } from "@/components/results/CalendarSubscribe";
import { MIN_SHARED_PILOTS, ownListEntry, submitAwardHistory, withdrawAwardShares } from "@/lib/award-history";
import { loggedMonthFor } from "@/lib/bid-checklist";
import { cityName } from "@/lib/city-names";
import { rankingAsShown } from "@/lib/ranking-as-shown";
import { checkInShare, logbookStats, loggedMonthFrom, withCheckIn, withLoggedMonth, withoutLoggedMonth, withoutShares } from "@/lib/logbook";
import { rankingSnapshotFor } from "@/lib/ranking-snapshot";
import { hm as hmMinutes } from "@/lib/trip-day-stats";
import type { UserAccount } from "@/types/auth";
import type { BidPack } from "@/types/bidpack";
import type { LoggedMonth, MonthFeel } from "@/types/logbook";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";

const LABEL = "font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint";
const hm = (h: number | null | undefined) => (typeof h === "number" ? hmMinutes(h * 60) : "—");
const FEELS: { feel: MonthFeel; label: string }[] = [
  { feel: "better", label: "Better than I expected" },
  { feel: "asExpected", label: "About what I expected" },
  { feel: "worse", label: "Worse than I expected" },
];

interface LogbookScreenProps {
  bidPack: BidPack | null;
  profile: PreferenceProfile | null;
  user: UserAccount | null;
  seniority: SeniorityInput | null;
  onUpdateProfile: (profile: PreferenceProfile) => void;
}

/**
 * The pilot's logbook: each month's award, logged once it's out, and how the month flew — adding up over time to what
 * they've held, where they've been and how their seniority has moved. Shared only if they say so, never with a name.
 */
export function LogbookScreen({ bidPack, profile, user, seniority, onUpdateProfile }: LogbookScreenProps) {
  const entries = useMemo(() => profile?.logbook ?? [], [profile?.logbook]);
  const stats = useMemo(() => logbookStats(entries), [entries]);
  const thisMonth = bidPack && profile ? loggedMonthFor(profile, bidPack) : null;
  const [relogging, setRelogging] = useState(false);
  // Said here, not in the form: a saved award closes the form, and a failed share has to outlive it.
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        eyebrow={packEyebrow(bidPack) ?? "Your logbook"}
        title="Logbook"
        description="Log each month’s award once it’s out, and how the month flew once you’ve flown it. Over the months it adds up to what you’ve held, where you’ve been and where your seniority is heading."
      />

      {bidPack && profile && (!thisMonth || relogging) && (
        <LogAward
          bidPack={bidPack}
          profile={profile}
          user={user}
          seniority={seniority}
          existing={thisMonth}
          onSave={(p, warning) => {
            onUpdateProfile(p);
            setRelogging(false);
            setNotice(warning);
          }}
          onCancel={thisMonth ? () => setRelogging(false) : undefined}
        />
      )}

      {notice && <p className="mt-4 rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm text-warn">{notice}</p>}

      {bidPack && profile && <CalendarSubscribe />}

      <WhySharing
        canWithdraw={!!user}
        onWithdrawAll={async () => {
          const r = await withdrawAwardShares();
          if (!r.ok) {
            setNotice(`Nothing withdrawn: ${r.error}`);
            return;
          }
          if (profile) onUpdateProfile(withoutShares(profile));
          setNotice(r.removed ? `Withdrawn: ${r.removed} shared ${r.removed === 1 ? "award" : "awards"} removed. Your logbook stays as it was.` : "You have nothing shared.");
        }}
      />

      {entries.length > 0 && <Stats stats={stats} base={bidPack?.base ?? entries[0].base} />}

      <section className="mt-8">
        <h2 className={LABEL}>Months logged {entries.length > 0 ? entries.length : ""}</h2>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nothing logged yet. Your first month shows here once you log its award.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {entries.map((m) => (
              <li key={m.id}>
                <MonthEntry
                  entry={m}
                  isThisPack={m.id === thisMonth?.id}
                  onRelog={() => setRelogging(true)}
                  onCheckIn={(feel, words) => {
                    if (!profile) return;
                    const updated = withCheckIn(profile, m.id, feel, words);
                    onUpdateProfile(updated);
                    // A month already shared is shared again with how it flew: the real-outcome signal the brain is judged by.
                    const share = user ? checkInShare(updated.logbook?.find((e) => e.id === m.id) ?? m, profile.pilotModel) : null;
                    if (share) void submitAwardHistory(share).then((r) => !r.ok && setNotice(`Saved here, but not shared: ${r.error}`));
                  }}
                  onDelete={() => profile && onUpdateProfile(withoutLoggedMonth(profile, m.id))}
                  onWithdraw={
                    user && m.sharedAt
                      ? async () => {
                          const r = await withdrawAwardShares({ base: m.base, aircraft: m.aircraft, seat: m.seat, month: m.month });
                          if (!r.ok) setNotice(`Still shared: ${r.error}`);
                          else {
                            if (profile) onUpdateProfile(withoutShares(profile, m.id));
                            setNotice(`Your ${m.month} share is withdrawn. The month stays in your logbook.`);
                          }
                        }
                      : undefined
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function LogAward({
  bidPack,
  profile,
  user,
  seniority,
  existing,
  onSave,
  onCancel,
}: {
  bidPack: BidPack;
  profile: PreferenceProfile;
  user: UserAccount | null;
  seniority: SeniorityInput | null;
  existing: LoggedMonth | null;
  onSave: (profile: PreferenceProfile, warning: string | null) => void;
  onCancel?: () => void;
}) {
  // The pilot's own ranking, best first — to list the lines in their order and say which choice they got. The order My
  // Rankings showed this visit when there is one: it also weighs hotels and airline flights, which aren't loaded here.
  const shown = rankingSnapshotFor(bidPack.id);
  const ranked = useMemo(() => {
    if (shown) {
      const place = (id: string) => shown.byLineId.get(id)?.rank ?? Number.MAX_SAFE_INTEGER;
      return [...bidPack.lines].sort((a, b) => place(a.id) - place(b.id));
    }
    return rankingAsShown(bidPack, profile, user?.id ?? null).map((r) => r.line);
  }, [bidPack, profile, shown, user]);
  const [outcome, setOutcome] = useState<LoggedMonth["outcome"]>(existing?.outcome ?? "line");
  const [lineId, setLineId] = useState(() => bidPack.lines.find((l) => l.lineNumber === existing?.lineNumber)?.id ?? ranked[0]?.id ?? "");
  // Only an exact place on the pack's list can be shown as "held by seniority #N".
  const ownEntry = ownListEntry(bidPack, profile.seniorityNumber);
  const placeIsExact = !!ownEntry && ownEntry.bidNumber === seniority?.rank;
  // Off until the pilot ticks it (shared only when they say so); on when correcting an award they shared, so the
  // correction replaces what was shared. A month shared before this showed a seniority number asks again.
  const [share, setShare] = useState(!!user && !!seniority && !!existing?.sharedAt && (!placeIsExact || existing.outcome !== "line" || !!existing.holderShown));
  const [saving, setSaving] = useState(false);
  const canShowHolder = placeIsExact && outcome === "line";

  async function save() {
    setSaving(true);
    let warning: string | null = null;
    const line = outcome === "line" ? (bidPack.lines.find((l) => l.id === lineId) ?? null) : null;
    const rank = line ? ranked.findIndex((l) => l.id === line.id) : -1;
    // A corrected award keeps the month's check-in and its shared mark.
    let entry: LoggedMonth = { ...loggedMonthFrom(bidPack, outcome, line, { rankedAt: rank >= 0 ? rank + 1 : null, seniority }), checkIn: existing?.checkIn, sharedAt: existing?.sharedAt, holderShown: existing?.holderShown };
    if (!share && user && existing?.sharedAt) {
      // Unticked on a month that was shared: unshared, not left standing with the old answer.
      const result = await withdrawAwardShares({ base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat, month: bidPack.month });
      if (!result.ok) warning = `Saved here, but still shared: ${result.error}`;
      else entry = { ...entry, sharedAt: undefined, holderShown: undefined };
    }
    if (share && user && seniority) {
      const whole = (x: number | null | undefined) => (typeof x === "number" ? Math.round(x) : null);
      const result = await submitAwardHistory({
        base: bidPack.base,
        aircraft: bidPack.aircraft,
        seat: bidPack.seat,
        month: bidPack.month,
        seniorityRank: seniority.rank,
        seniorityTotalPilots: seniority.totalPilots,
        outcome,
        lineNumber: line?.lineNumber ?? null,
        daysOff: whole(line?.daysOff),
        totalCreditHours: whole(line?.totalCreditHours),
        totalTafbHours: whole(line?.totalTafbHours),
        awardedChoice: entry.rankedAt ?? null,
        holderShown: canShowHolder,
        // Which brain ranked these lines, and how the month flew if it's already been checked in.
        monthFeel: entry.checkIn?.feel ?? null,
        brainVersion: profile.pilotModel?.brainVersion ?? null,
        notesUsed: profile.pilotModel?.notesUsed ?? null,
      });
      if (!result.ok) warning = `Logged here, but not shared: ${result.error}`;
      else entry = { ...entry, sharedAt: new Date().toISOString(), holderShown: canShowHolder };
    }
    setSaving(false);
    onSave(withLoggedMonth(profile, entry), warning);
  }

  return (
    <section className="panel-glass mt-6 p-5 sm:p-6">
      <h2 className="font-display text-xl font-semibold text-ink">Log your {bidPack.month} award</h2>
      <p className="mt-1 text-sm text-ink-muted">Once the award is out: what did you get?</p>
      <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="What you were awarded">
        {(
          [
            ["line", "A regular line"],
            ["reserve", "Reserve"],
            ["other", "Something else"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={outcome === value}
            onClick={() => setOutcome(value)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${outcome === value ? "border-accent bg-accent-soft text-ink" : "border-hairline text-ink-muted hover:border-border-strong"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {outcome === "line" && (
        <label className="mt-4 block text-sm">
          <span className="text-ink-muted">Which line?</span>
          <select value={lineId} onChange={(e) => setLineId(e.target.value)} className="mt-1 block w-full max-w-sm rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink">
            {ranked.map((l, i) => (
              <option key={l.id} value={l.id}>
                Line {l.lineNumber} — your #{i + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className={`mt-4 flex items-start gap-2.5 text-sm ${user && seniority ? "cursor-pointer" : "opacity-70"}`}>
        <input type="checkbox" checked={share} disabled={!user || !seniority} onChange={(e) => setShare(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]" />
        <span>
          <span className="text-ink">Share it with other pilots</span>
          <span className="block text-xs text-ink-muted">
            {!user ? (
              <>
                <Link href="/auth" className="underline decoration-dotted underline-offset-2">
                  Sign in
                </Link>{" "}
                to share — the sign-in keeps out spam and lets you withdraw it; what&rsquo;s shared never carries your name.
              </>
            ) : !seniority ? (
              <>
                Add your seniority number in{" "}
                <Link href="/preferences" className="underline decoration-dotted underline-offset-2">
                  Preferences
                </Link>{" "}
                to share — the award only means something next to it.
              </>
            ) : canShowHolder ? (
              <>
                Once at least {MIN_SHARED_PILOTS} pilots in your seat have shared this month, signed-in pilots see &ldquo;Held by seniority #{ownEntry.seniority}&rdquo; on this line. No name or employee number
                goes with it, but anyone with the seniority list can match that number to you. You can withdraw it any time.
              </>
            ) : (
              `Goes into group numbers only${outcome === "line" ? ", because your seniority number isn't on this pack's list" : ""}. Never your name, and you can withdraw it any time.`
            )}
          </span>
        </span>
      </label>
      <div className="mt-5 flex gap-2">
        <Button onClick={save} disabled={saving || (outcome === "line" && !lineId)}>
          {saving ? "Saving…" : existing ? "Update" : "Log it"}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </section>
  );
}

/** What sharing an award does — said plainly, and only what the app really does with it. */
function WhySharing({ canWithdraw, onWithdrawAll }: { canWithdraw: boolean; onWithdrawAll: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <section className="mt-6 rounded-xl border border-hairline bg-canvas/50 p-5">
      <h2 className="text-sm font-semibold text-ink">How sharing your award makes the results better</h2>
      <ul className="mt-3 space-y-2.5 text-sm text-ink-muted">
        <li>
          <span className="font-medium text-ink">Which lines you can really hold.</span> &ldquo;Likely open at your turn&rdquo; is estimated from your place on the
          seniority list. Real awards from pilots at each seniority show where lines actually went, and the estimate is checked against them &mdash; for
          everyone in your base, aircraft and seat.
        </li>
        <li>
          <span className="font-medium text-ink">Your ranking against reality.</span> Where the line you got sat in your own ranking is kept with your month,
          so over time you see how often you held one of your top choices &mdash; and how your seniority is moving.
        </li>
        <li>
          <span className="font-medium text-ink">Pilots like you.</span> &ldquo;What pilots near you actually held,&rdquo; in Strategies, fills in with real
          outcomes instead of staying empty.
        </li>
        <li>
          <span className="font-medium text-ink">Who held what.</span> Once enough pilots in a seat have shared a month, an opened line shows the seniority number that
          held it, so you can see how far down it went.
        </li>
      </ul>
      <p className="mt-3 text-xs text-ink-faint">Shared awards carry your place on the list and what you held &mdash; never your name, email or employee number. Your logbook itself stays yours.</p>
      {canWithdraw &&
        (confirming ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            <span>Remove everything you&rsquo;ve shared? Your private hold history goes with it; your logbook stays.</span>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onWithdrawAll();
                setBusy(false);
                setConfirming(false);
              }}
            >
              {busy ? "Withdrawing…" : "Yes, withdraw"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className="mt-3 text-xs text-ink-muted underline decoration-dotted underline-offset-2 hover:text-ink">
            Withdraw all my shares
          </button>
        ))}
    </section>
  );
}

function Stats({ stats, base }: { stats: ReturnType<typeof logbookStats>; base: string | null }) {
  const last = stats.seniority.at(-1);
  const first = stats.seniority[0];
  // Your own globe: base to every city you've laid over in.
  const pairs = useMemo(() => (base ? stats.cities.filter((c) => c.code !== base).slice(0, 24).map((c) => [base, c.code] as [string, string]) : []), [base, stats.cities]);
  return (
    <section className="panel-glass mt-6 p-5">
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_12rem] sm:items-center">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="Months logged" value={stats.months} format={(n) => String(Math.round(n))} />
          <Stat label="Avg credit" value={stats.avgCreditHours} format={hm} />
          <Stat label="Avg days off" value={stats.avgDaysOff} format={(n) => n.toFixed(1)} />
          <Stat label="Held a top-5 pick" value={stats.topFiveShare === null ? null : stats.topFiveShare * 100} format={(n) => `${Math.round(n)}%`} />
        </div>
        {pairs.length > 0 && (
          <div className="mx-auto w-48 sm:w-full">
            <NightGlobe pairs={pairs} readout={false} />
          </div>
        )}
      </div>
      {stats.cities.length > 0 && (
        <div className="mt-5">
          <div className={LABEL}>Where you&rsquo;ve laid over</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {stats.cities.slice(0, 12).map((c) => (
              <Link key={c.code} href={`/cities?city=${c.code}`} className="rounded-full border border-hairline bg-canvas/60 px-2.5 py-1 text-xs text-ink-muted hover:border-border-strong hover:text-ink">
                <span className="font-mono font-semibold text-ink">{c.code}</span> {cityName(c.code)} &times;{c.layovers}
              </Link>
            ))}
          </div>
        </div>
      )}
      {last && (
        <p className="mt-5 text-sm text-ink-muted">
          Seniority: top {Math.max(1, Math.round(last.percentile * 100))}% of your seat in {last.month}
          {first && first !== last ? `, from top ${Math.max(1, Math.round(first.percentile * 100))}% in ${first.month}` : ""}.
        </p>
      )}
    </section>
  );
}

function Stat({ label, value, format }: { label: string; value: number | null; format: (n: number) => string }) {
  return (
    <div>
      <div className={LABEL}>{label}</div>
      {/* Counting up to the figure the first time it shows. */}
      <div className="mt-0.5 font-mono text-xl font-semibold tabular-nums text-ink">{value === null ? "—" : <NumberTicker value={value} format={format} />}</div>
    </div>
  );
}

function MonthEntry({
  entry: m,
  isThisPack,
  onRelog,
  onCheckIn,
  onDelete,
  onWithdraw,
}: {
  entry: LoggedMonth;
  isThisPack: boolean;
  onRelog: () => void;
  onCheckIn: (feel: MonthFeel, words: { bestTrip?: string; worstTrip?: string; note?: string }) => void;
  onDelete: () => void;
  /** Present when the month is shared and the pilot is signed in. */
  onWithdraw?: () => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [feel, setFeel] = useState<MonthFeel | null>(m.checkIn?.feel ?? null);
  const [best, setBest] = useState(m.checkIn?.bestTrip ?? "");
  const [worst, setWorst] = useState(m.checkIn?.worstTrip ?? "");
  const [note, setNote] = useState(m.checkIn?.note ?? "");
  const cities = [...new Set(m.layoverCities ?? [])];
  return (
    <article className="panel-glass p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-sm font-semibold text-accent">{m.month}</span>
          <span className="font-display text-lg font-semibold text-ink">{m.outcome === "line" ? `Line ${m.lineNumber}` : m.outcome === "reserve" ? "Reserve" : "Something else"}</span>
          {m.rankedAt ? <span className="text-xs text-ink-muted">your #{m.rankedAt}</span> : null}
        </div>
        <span className="text-xs text-ink-faint">
          {m.base} {m.aircraft} {m.seat}
          {m.sharedAt ? (m.holderShown ? " · shared, number shown" : " · shared") : ""}
          {onWithdraw && (
            <>
              {" · "}
              <button
                type="button"
                disabled={withdrawing}
                onClick={async () => {
                  setWithdrawing(true);
                  await onWithdraw();
                  setWithdrawing(false);
                }}
                className="underline decoration-dotted underline-offset-2 hover:text-ink"
              >
                {withdrawing ? "withdrawing…" : "withdraw"}
              </button>
            </>
          )}
        </span>
      </div>
      {m.outcome === "line" && (
        <div className="mt-1.5 text-sm text-ink-muted">
          {hm(m.creditHours)} credit &middot; {m.daysOff ?? "—"} days off &middot; {m.tripCount ?? "—"} trips
          {cities.length > 0 && <> &middot; {cities.join(" ")}</>}
        </div>
      )}

      {m.checkIn && !checking ? (
        <div className="mt-3 rounded-md bg-canvas/60 px-3 py-2 text-sm">
          <span className="text-ink">{FEELS.find((f) => f.feel === m.checkIn!.feel)?.label}</span>
          {m.checkIn.bestTrip && <span className="text-ink-muted"> &middot; best: {m.checkIn.bestTrip}</span>}
          {m.checkIn.worstTrip && <span className="text-ink-muted"> &middot; worst: {m.checkIn.worstTrip}</span>}
          {m.checkIn.note && <p className="mt-1 italic text-ink-muted">&ldquo;{m.checkIn.note}&rdquo;</p>}
        </div>
      ) : checking ? (
        <div className="mt-3 space-y-3 rounded-md border border-hairline p-3">
          <div className="text-sm font-medium text-ink">How did {m.month} fly?</div>
          <div className="flex flex-wrap gap-2">
            {FEELS.map((f) => (
              <button
                key={f.feel}
                type="button"
                onClick={() => setFeel(f.feel)}
                aria-pressed={feel === f.feel}
                className={`rounded-md border px-3 py-1.5 text-sm ${feel === f.feel ? "border-accent bg-accent-soft text-ink" : "border-hairline text-ink-muted hover:border-border-strong"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={best} onChange={(e) => setBest(e.target.value)} placeholder="Best trip (e.g. #76, Honolulu)" className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink" />
            <input value={worst} onChange={(e) => setWorst(e.target.value)} placeholder="Worst trip" className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink" />
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Anything else about the month (optional)" className="w-full rounded-md border border-hairline bg-surface px-3 py-2 text-sm text-ink" />
          <div className="flex gap-2">
            <Button
              disabled={!feel}
              onClick={() => {
                if (!feel) return;
                onCheckIn(feel, { bestTrip: best, worstTrip: worst, note });
                setChecking(false);
              }}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setChecking(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {!checking && (
          <button type="button" onClick={() => setChecking(true)} className="font-medium text-accent underline decoration-dotted underline-offset-4">
            {m.checkIn ? "Change how it flew" : "How did it fly?"}
          </button>
        )}
        {isThisPack && (
          <button type="button" onClick={onRelog} className="text-ink-muted underline decoration-dotted underline-offset-4 hover:text-ink">
            Change the award
          </button>
        )}
        <button type="button" onClick={onDelete} className="text-ink-faint underline decoration-dotted underline-offset-4 hover:text-danger">
          Delete
        </button>
      </div>
    </article>
  );
}

