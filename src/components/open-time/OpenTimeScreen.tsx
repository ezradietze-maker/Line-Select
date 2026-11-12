"use client";

import { DateTime } from "luxon";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ConnectFedexPanel } from "@/components/fedex-connect/ConnectFedexPanel";
import { ScoreRing } from "@/components/results/ScoreRing";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { FIELD } from "@/components/ui/field";
import { Notice } from "@/components/ui/Notice";
import { PageHeader, packEyebrow } from "@/components/ui/PageHeader";
import { loadCarryIn } from "@/lib/carry-in-storage";
import { canCheckCommute, commuteNeedsForTrips, loadCommuteAnswers, runCommuteCheck, type CommuteAnswers, type CommuteCheckEnd } from "@/lib/commute-filter";
import { cachedFlightAnswers } from "@/lib/flights/client";
import { evaluateOpenTime, type GiveUpAs, type OpenTimeBoard, type OpenTimeSituation, type OpenTrip } from "@/lib/open-time/engine";
import { pasteSnapshot } from "@/lib/open-time/parse";
import type { AssignedAs, BankCode, Banks, RuleLevel } from "@/lib/open-time/rules";
import { samplePaste } from "@/lib/open-time/sample";
import type { OpenTimeSnapshot } from "@/lib/open-time/source";
import { placeInPack } from "@/lib/strategy-engine";
import { startingSettings } from "@/lib/use-commute-check";
import { vacationId } from "@/lib/vacation-lines";
import { vacationsInReach } from "@/lib/vacation-slide";
import { tripKey } from "@/lib/view-add";
import type { BidPack, Trip } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";
import { dayTripsOf } from "@/lib/trip-anchor";

/** Each up to four questions to the flight server: enough to decide on, and a list of hundreds shouldn't run up the boards. */
const COMMUTE_TRIPS = 30;
const SHOWN = 20;

const BANKS: { code: BankCode; label: string }[] = [
  { code: "PMU", label: "PMU (OTP)" },
  { code: "PNP", label: "PNP" },
  { code: "M/U", label: "M/U" },
  { code: "MUS", label: "MUS" },
  { code: "MUV", label: "MUV" },
];

/** CBA 2026 25.L.1.h's codes, for a trip the pilot is thinking of giving up. */
const ASSIGNED_AS: AssignedAs[] = ["LINE", "PMU", "CMU", "PDO", "AVA", "VLT", "DRF", "RSV"];

const VERDICT: Record<OpenTrip["verdict"], { label: string; tone: string }> = {
  open: { label: "Looks legal", tone: "text-good" },
  check: { label: "Looks legal, with something to check", tone: "text-ink" },
  late: { label: "Past the deadline", tone: "text-warn" },
  no: { label: "Can't take", tone: "text-danger" },
};

const LEVEL_TONE: Record<RuleLevel, string> = { no: "text-danger", late: "text-warn", check: "text-ink", note: "text-ink-muted" };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const tripLabel = (t: Trip) => `Trip ${t.pairingNumber ?? "?"}`;

function tripFacts(t: OpenTrip): string {
  const date = t.date ? DateTime.fromISO(t.date, { zone: "utc" }).toFormat("LLL d") : "No date";
  const cities = t.trip.layoverCities.length ? t.trip.layoverCities.join(" ") : "no layover";
  return `${date} · ${plural(t.trip.days, "day")} · ${t.trip.creditHours.toFixed(1)} CH · ${cities}`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function TripRow({ t, scored, scheduleChecked }: { t: OpenTrip; scored: boolean; scheduleChecked: boolean }) {
  // "Looks legal" is a claim about the pilot's schedule: with no line entered there's no schedule to have checked.
  const verdict = !scheduleChecked && (t.verdict === "open" || t.verdict === "check") ? { label: "Not checked against your line", tone: "text-ink-muted" } : VERDICT[t.verdict];
  const usable = t.banks.filter((b) => b.eligible);
  const blockers = t.findings.filter((f) => f.level === "no" || f.level === "late" || f.level === "check");
  const notes = t.findings.filter((f) => f.level === "note");
  return (
    <li className="panel-glass p-3 sm:p-4">
      <div className="flex items-start gap-3">
        {scored && t.fit !== null && (
          <div className="shrink-0" title={t.monthEffect === null ? "The trip's own score for you" : `The trip scores ${Math.round(t.tripScore ?? 0)} for you; what it does to your month moves that ${t.monthEffect >= 0 ? "+" : ""}${t.monthEffect.toFixed(1)}, against the other open trips`}>
            <ScoreRing score={t.fit} size={48} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm font-medium text-ink">{tripLabel(t.trip)}</p>
            <p className={`text-xs font-medium ${verdict.tone}`}>{verdict.label}</p>
          </div>
          <p className="text-xs text-ink-muted">{tripFacts(t)}</p>
          {t.reasons.length > 0 && <p className="mt-1.5 text-sm text-ink">{capitalised(t.reasons.join(", "))}.</p>}
          {blockers.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {blockers.map((f) => (
                <li key={`${f.section}-${f.text}`} className={LEVEL_TONE[f.level]}>
                  {f.text}
                </li>
              ))}
            </ul>
          )}
          {usable.length > 0 && t.verdict !== "no" && <p className="mt-1.5 text-xs text-ink-muted">Fits your {usable.map((b) => b.code).join(", ")}{usable.length > 1 ? `; ${usable[0].code} is processed first` : ""}.</p>}
          {(notes.length > 0 || t.banks.length > 0) && (
            <details className="mt-1.5 text-xs text-ink-muted">
              <summary className="cursor-pointer">The rules on this one</summary>
              <ul className="mt-1 space-y-0.5 pl-3">
                {notes.map((f) => (
                  <li key={`${f.section}-${f.text}`}>{f.text}</li>
                ))}
                {t.banks.flatMap((b) => b.notes.map((n) => <li key={`${b.code}-${n}`}>{n}</li>))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

function RowsBack({ title, rows, tone }: { title: string; rows: { raw: string; why: string }[]; tone: "warn" | "info" }) {
  if (!rows.length) return null;
  return (
    <Notice tone={tone} className="mt-3 [&>span:last-of-type]:min-w-0">
      <span className="block font-medium">
        {title} ({rows.length})
      </span>
      <ul className="mt-1 space-y-1 text-xs">
        {rows.slice(0, 40).map((r, i) => (
          <li key={`${r.raw}-${i}`} className="break-words">
            <code className="font-mono">{r.raw}</code>
            <span className="block text-ink-muted">{r.why}</span>
          </li>
        ))}
      </ul>
      {rows.length > 40 && <p className="mt-1 text-xs">And {rows.length - 40} more.</p>}
    </Notice>
  );
}

function Board({ board, commuteEnd }: { board: OpenTimeBoard; commuteEnd: CommuteCheckEnd | "checking" | null }) {
  const [all, setAll] = useState(false);
  const can = board.trips.filter((t) => t.verdict !== "no");
  const cannot = board.trips.filter((t) => t.verdict === "no");
  const shown = all ? can : can.slice(0, SHOWN);
  return (
    <div className="mt-4">
      <RowsBack title="We couldn't read these rows, so they aren't below" rows={board.unread} tone="warn" />
      <RowsBack title="Read, but not in your pack, so not scored or checked" rows={board.notInPack} tone="warn" />
      {board.rowsLeftOff > 0 && <p className="mt-2 text-xs text-danger">{plural(board.rowsLeftOff, "row")} past the first 400 left off. Paste a shorter list.</p>}
      {board.noDates && <p className="mt-2 text-xs text-danger">This pack&rsquo;s trips aren&rsquo;t on dates, so no row can be matched to one.</p>}
      {!board.scheduleChecked && <p className="mt-3 text-xs text-ink">No line entered, so nothing&rsquo;s been checked against your schedule yet.</p>}
      {!board.scored && <p className="mt-3 text-xs text-ink">No scores yet: finish your preferences and every trip gets one. Until then they&rsquo;re sorted by days off left.</p>}
      {commuteEnd === "unavailable" && <p className="mt-2 text-xs text-ink-muted">Flight data isn&rsquo;t available right now, so commutes aren&rsquo;t in these reasons.</p>}
      {commuteEnd === "paused" && <p className="mt-2 text-xs text-ink-muted">The flight check stopped partway; what came back is in these reasons.</p>}
      {board.onLine.length > 0 && <p className="mt-3 text-xs text-ink-muted">Already on your line: {board.onLine.map((r) => r.raw).join("; ")}.</p>}

      {board.trips.length > 0 && <p className="mt-3 text-xs text-ink-muted">{!board.scheduleChecked ? `${plural(board.trips.length, "trip")} read. Enter your line to see which you could take.` : can.length ? `${plural(can.length, "trip")} you could take${cannot.length ? `, ${cannot.length} you can't` : ""}, best for you first.` : "None of these can go on your line."}</p>}
      {shown.length > 0 && (
        <ul className="mt-2 space-y-2">
          {shown.map((t) => (
            <TripRow key={t.key} t={t} scored={board.scored} scheduleChecked={board.scheduleChecked} />
          ))}
        </ul>
      )}
      {can.length > SHOWN && (
        <Button variant="ghost" className="mt-2 px-2 py-1 text-xs" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${can.length}`}
        </Button>
      )}
      {cannot.length > 0 && (
        <details open={can.length === 0} className="mt-3 text-sm text-ink-muted">
          <summary className="cursor-pointer">{plural(cannot.length, "trip")} you can&rsquo;t take</summary>
          <ul className="mt-2 space-y-2">
            {cannot.map((t) => (
              <TripRow key={t.key} t={t} scored={board.scored} scheduleChecked={board.scheduleChecked} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

interface OpenTimeScreenProps {
  bidPack: BidPack | null;
  /** To find the pilot's vacation in the pack; without it, none is checked. */
  seniority: SeniorityInput | null;
  profile: PreferenceProfile | null;
  userId: string | null;
  onGoToUpload: () => void;
  onTrySample?: () => void;
}

export function OpenTimeScreen({ bidPack, seniority, profile, userId, onGoToUpload, onTrySample }: OpenTimeScreenProps) {
  if (!bidPack) {
    return (
      <EmptyState
        title="Upload a bid pack first"
        description="Open time is matched to your bid pack's trips, so upload one before Line Select can score it."
        actionLabel="Upload bid pack"
        onAction={onGoToUpload}
        secondaryLabel={onTrySample ? "Or try it with sample data" : undefined}
        onSecondary={onTrySample}
      />
    );
  }
  return <OpenTimeBuilder key={bidPack.id} bidPack={bidPack} seniority={seniority} profile={profile} userId={userId} />;
}

/** Paste VIPS's open time and read it for this pilot: what fits, what's legal, what couldn't be read. Nothing is sent to VIPS or fetched from it. */
function OpenTimeBuilder({ bidPack, seniority, profile, userId }: { bidPack: BidPack; seniority: SeniorityInput | null; profile: PreferenceProfile | null; userId: string | null }) {
  const logged = useMemo(() => (profile?.logbook ?? []).find((m) => m.month === bidPack.month && m.outcome === "line")?.lineNumber ?? "", [profile?.logbook, bidPack.month]);
  const [lineNumber, setLineNumber] = useState(logged);
  const [pasted, setPasted] = useState("");
  const [banks, setBanks] = useState<Partial<Record<BankCode, string>>>({});
  const [giveUpKey, setGiveUpKey] = useState("");
  const [giveUpAs, setGiveUpAs] = useState<GiveUpAs>("trade");
  const [assignedAs, setAssignedAs] = useState<AssignedAs>("LINE");
  const [tradedSoFar, setTradedSoFar] = useState("");
  const [submitted, setSubmitted] = useState<{ snapshot: OpenTimeSnapshot; situation: Omit<OpenTimeSituation, "commute" | "now"> } | null>(null);
  const settings = useMemo(() => (profile ? startingSettings(profile) : null), [profile]);
  const [answers, setAnswers] = useState<CommuteAnswers>(() => (settings ? loadCommuteAnswers(bidPack.id, settings) : {}));
  const [commuteEnd, setCommuteEnd] = useState<CommuteCheckEnd | "checking" | null>(null);

  const hasDates = !!bidPack.bidPeriodStart;
  const typed = lineNumber.trim();
  const line = bidPack.lines.find((l) => l.lineNumber === typed) ?? null;
  const canCommute = !!settings && canCheckCommute(bidPack, settings.homeAirport);
  const number = (v: string | undefined) => {
    const n = Number(v);
    return v && v.trim() !== "" && Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const signed = (v: string | undefined) => {
    const n = Number(v);
    return v && v.trim() !== "" && Number.isFinite(n) ? n : 0;
  };

  const score = (text: string) => {
    // A new list starts with no flight check said about it: the last one's "stopped partway" isn't about this one.
    setCommuteEnd(null);
    const entered: Banks = {};
    for (const { code } of BANKS) entered[code] = number(banks[code]);
    const carry = loadCarryIn(userId, bidPack.id);
    setSubmitted({
      snapshot: pasteSnapshot(text),
      situation: {
        pack: bidPack,
        line,
        carryIn: carry.items,
        elections: carry.elections,
        // Not one the pilot has said they aren't taking (traded away, 7.E.1.a): its days are open to them.
        vacations: seniority ? vacationsInReach(placeInPack(bidPack, seniority).me?.vacations ?? [], bidPack).filter((v) => carry.vacationChoices?.[vacationId(v)] !== "not-taking") : [],
        model: profile?.pilotModel,
        banks: entered,
        giveUp: line && giveUpKey ? { key: giveUpKey, as: giveUpAs, assignedAs } : null,
        // Net of earlier trades (CBA 2026 25.L.8.a): a trade that lowered the line counts against one that raises it.
        tradedSoFarCH: signed(tradedSoFar),
        flights: cachedFlightAnswers(bidPack, profile?.pilotModel) ?? undefined,
      },
    });
  };

  const board = useMemo(() => {
    if (!submitted) return null;
    return evaluateOpenTime(submitted.snapshot, { ...submitted.situation, commute: canCommute && settings ? { settings, answers } : null, now: submitted.snapshot.readAt });
  }, [submitted, canCommute, settings, answers]);

  const checkCommutes = async () => {
    if (!board || !settings) return;
    const trips = board.trips.filter((t) => t.verdict !== "no").slice(0, COMMUTE_TRIPS).map((t) => t.trip);
    setCommuteEnd("checking");
    const end = await runCommuteCheck(bidPack, settings, (p) => setAnswers(p.answers), { needs: commuteNeedsForTrips(bidPack, trips, settings) });
    setCommuteEnd(end);
  };

  const trySample = () => {
    const text = samplePaste(bidPack);
    setPasted(text);
    score(text);
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader eyebrow={packEyebrow(bidPack)} title="Open time, scored for you" description="Paste the open-time list from VIPS. Every trip gets a score for you, with the reasons, and is checked against your line and the contract." />

      <Notice className="mt-4">
        <span className="block">
          <span className="font-medium text-ink">What it&rsquo;s for:</span> deciding on one trip at a time: picking it up with your make-up or priority hours, or trading or dropping one of your trips for it. PMU and PNP go first, then submissions go in the order received, so a good trip won&rsquo;t wait (CBA 2026 25.L.4&ndash;6).
        </span>
        <span className="mt-1 block">
          <span className="font-medium text-ink">When to use it:</span> once secondary lines are built, before or during the bid period (CBA 2026 25.G.1), up to 0900 LBT the day before the trip (CBA 2026 25.L.1.b). In the View/Add window, use{" "}
          <Link href="/view-add" className="underline underline-offset-2 hover:text-ink">
            View/Add
          </Link>{" "}
          instead.
        </span>
      </Notice>

      <Notice tone="warn" className="mt-3">
        We haven&rsquo;t seen a real VIPS open-time list yet, so this reads the list by its best guess at the format. Any row it can&rsquo;t read is shown to you. Check each trip against VIPS before you submit: this is our reading of the contract, not an official award.
      </Notice>

      <section aria-label="Your open-time list" className="panel-glass mt-4 p-4 sm:p-5 print:hidden">
        {!hasDates && <p className="mb-3 text-xs text-ink">This pack&rsquo;s trips aren&rsquo;t on dates, so an open-time list can&rsquo;t be matched to them. Upload a real bid pack to use this; the sample pack has no dates.</p>}
        <label className="block text-xs text-ink-muted">
          VIPS&rsquo;s open-time list, pasted (a trip number and a date on each line)
          <textarea className={`${FIELD} mt-1 block h-32 w-full font-mono text-xs`} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={"213 14OCT\nTrip 37 Oct 15 CH 12.5"} />
        </label>

        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_2fr]">
          <label className="text-xs text-ink-muted">
            Your awarded line
            <input className={`${FIELD} mt-1 block w-full`} value={lineNumber} onChange={(e) => setLineNumber(e.target.value)} placeholder="1025" inputMode="numeric" />
          </label>
          <fieldset className="min-w-0">
            <legend className="text-xs text-ink-muted">What you have to make up, CH</legend>
            <div className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-5">
              {BANKS.map(({ code, label }) => (
                <label key={code} className="text-[11px] text-ink-faint">
                  {label}
                  <input className={`${FIELD} mt-0.5 block w-full px-2`} value={banks[code] ?? ""} onChange={(e) => setBanks((b) => ({ ...b, [code]: e.target.value }))} placeholder="0" inputMode="decimal" />
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        {typed !== "" && !line && <p className="mt-1 text-xs text-danger">Line {typed} isn&rsquo;t in this pack, so your schedule won&rsquo;t be checked.</p>}

        {line && (
          <details className="mt-3 text-xs text-ink-muted">
            <summary className="cursor-pointer">Give up one of your trips for it</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label>
                Your trip
                <select className={`${FIELD} mt-1 block w-full`} value={giveUpKey} onChange={(e) => setGiveUpKey(e.target.value)}>
                  <option value="">None: just pick it up</option>
                  {line.trips.flatMap(dayTripsOf).map((t) => (
                    <option key={tripKey(t)} value={tripKey(t)}>
                      {tripLabel(t)}, {t.creditHours.toFixed(1)} CH
                    </option>
                  ))}
                </select>
              </label>
              <label>
                How
                <select className={`${FIELD} mt-1 block w-full`} value={giveUpAs} onChange={(e) => setGiveUpAs(e.target.value as GiveUpAs)}>
                  <option value="trade">Trade it for the open trip</option>
                  <option value="drop">Drop it if I get the open trip</option>
                </select>
              </label>
              <label>
                How you hold it
                <select className={`${FIELD} mt-1 block w-full`} value={assignedAs} onChange={(e) => setAssignedAs(e.target.value as AssignedAs)}>
                  {ASSIGNED_AS.map((c) => (
                    <option key={c} value={c}>
                      {c === "LINE" ? "On my awarded line" : c}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                CH your trades have added so far this month (a minus if they took some off)
                {/* Plain text keyboard: a phone's number pad has no minus sign. */}
                <input className={`${FIELD} mt-1 block w-full`} value={tradedSoFar} onChange={(e) => setTradedSoFar(e.target.value)} placeholder="0" inputMode="text" />
              </label>
            </div>
          </details>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={!pasted.trim()} onClick={() => score(pasted)}>
            Score these trips
          </Button>
          {hasDates && (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={trySample}>
              Try a made-up list
            </Button>
          )}
          {board && canCommute && board.trips.some((t) => t.verdict !== "no") && (
            <Button variant="ghost" className="px-2 py-1 text-xs" disabled={commuteEnd === "checking"} onClick={checkCommutes}>
              {commuteEnd === "checking" ? "Checking flights…" : `Check commute flights from ${settings?.homeAirport}`}
            </Button>
          )}
        </div>
        <p className="mt-2 text-xs text-ink-faint">Your list stays on this device. Line Select never signs in to VIPS or reads it for you.</p>
      </section>

      <ConnectFedexPanel signedIn={!!userId} />

      {board && <Board board={board} commuteEnd={commuteEnd} />}
    </div>
  );
}
