"use client";

import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { checkSeniority, parseSeniorityInput } from "@/components/interview/SeniorityStep";
import { Button } from "@/components/ui/Button";
import { FIELD } from "@/components/ui/field";
import { resolveBidPosition, seatSize } from "@/lib/forecast/forecast";
import { otherMonthsNote, type TypedVacation } from "@/lib/my-vacation";
import { zoneOf } from "@/lib/phase-in";
import type { CarryIn } from "@/lib/use-carry-in";
import { vacationId, type VacationChoice } from "@/lib/vacation-lines";
import { vacationLabel } from "@/lib/vacation-slide";
import type { BidPack, VacationPeriod } from "@/types/bidpack";
import type { PreferenceProfile } from "@/types/preferences";
import type { SeniorityInput } from "@/types/strategy";

const TOP_LINES = 20;
/** The longest vacation the pack's schedule prints (the October packs: 36 days). */
const MAX_TYPED_DAYS = 45;
const MAX_TYPED = 3;

const CHOICES: { value: VacationChoice; label: string; detail: string }[] = [
  { value: "use", label: "Use it", detail: "Trips under it come off and are paid from your vacation bank (CBA 2026 7.G.1)." },
  { value: "keep-flying", label: "Keep my flying", detail: "Those trips still come off, but a line ranks lower for the share of its credit your vacation takes, so lines it barely touches rise." },
  { value: "not-taking", label: "Not taking this one", detail: "Only if it's really off your schedule, traded or changed with flight management (CBA 2026 7.E.1.a). Otherwise those trips still come off." },
];

/**
 * Near the top of My Rankings: the pilot's vacation, found in the pack by their seniority number (`findMyVacation`) and
 * scored into every line, and what they want done with it. Where the pack can't say whose it is, this is where they
 * give their number, or type the vacation; and where it's wrong, where they put it right.
 */
export function VacationChoicePanel({
  bidPack,
  carry,
  order,
  profile,
  onUpdateProfile,
  onSaveSeniority,
  bare = false,
}: {
  bidPack: BidPack;
  carry: CarryIn;
  order: string[];
  profile: PreferenceProfile;
  onUpdateProfile: (profile: PreferenceProfile) => void;
  onSaveSeniority?: (input: SeniorityInput) => void;
  /** Inside "Your month"'s drawer, which is its frame. */
  bare?: boolean;
}) {
  const { state, update, flown, vacations } = carry;
  const zone = zoneOf(bidPack);
  const [typing, setTyping] = useState(false);
  const top = useMemo(() => {
    const ids = new Map(bidPack.lines.map((l) => [l.lineNumber, l.id]));
    return order.slice(0, TOP_LINES).flatMap((n) => {
      const v = flown.vacationLines.get(ids.get(n) ?? "");
      return v ? [v] : [];
    });
  }, [bidPack, order, flown.vacationLines]);

  // A pack with no dates can't place a vacation on its lines at all.
  if (!bidPack.bidPeriodStart) return null;

  const set = (v: VacationPeriod, choice: VacationChoice) => update({ ...state, vacationChoices: { ...state.vacationChoices, [vacationId(v)]: choice } });
  const saveTyped = (typed: TypedVacation[], preferTyped: boolean) => {
    update({ ...state, typedVacations: typed.length ? typed : undefined, preferTyped: typed.length && preferTyped ? true : undefined });
    setTyping(false);
  };
  const saveNumber = (seniorityNumber: number) => {
    onUpdateProfile({ ...profile, seniorityNumber });
    const list = bidPack.seniorityList ?? [];
    if (list.length && onSaveSeniority) {
      const position = resolveBidPosition(list, seniorityNumber);
      onSaveSeniority({ rank: position.bidNumber, totalPilots: Math.max(seatSize(list), position.bidNumber), source: position.exact ? "typed" : "between", seniorityNumber, packId: bidPack.id });
    }
  };
  const status = vacations.status;
  const number = vacations.seniorityNumber;
  const typedForm = (lead: string, preferTyped: boolean) => (
    <TypedVacationForm pack={bidPack} lead={lead} initial={state.typedVacations ?? []} onSave={(typed) => saveTyped(typed, preferTyped)} onCancel={typing ? () => setTyping(false) : undefined} />
  );

  let body: React.ReactNode;
  if (typing) {
    body = typedForm(status === "found" || status === "none" ? "Type your vacation as it really is, and it's used in place of the pack's." : "Type your vacation.", status === "found" || status === "none");
  } else if (status === "no-number" || status === "band") {
    body = (
      <SeniorityNumberForm
        pack={bidPack}
        lead={status === "band" ? "You gave where you sit in the seat, not your number, so the pack's vacation schedule can't say which vacation is yours." : "Give your seniority number and your vacation is found in the pack's vacation schedule."}
        onSave={saveNumber}
      />
    );
  } else if (status === "not-listed") {
    body = typedForm(`Seniority #${number} isn't on this pack's list, so its vacation schedule can't say which vacation is yours. Type it, or check your number in Preferences.`, false);
  } else if (status === "no-schedule") {
    body = typedForm("This pack doesn't print a vacation schedule. If you have vacation this bid month, type it.", false);
  } else if (status === "none") {
    body = (
      <p className="text-xs text-ink-muted">
        {otherMonthsNote(vacations.entry, bidPack) ?? <>The pack&rsquo;s vacation schedule has no vacation for seniority #{number} in or near this bid month.</>}{" "}
        <button type="button" className="font-medium text-brand underline underline-offset-2" onClick={() => setTyping(true)}>
          Not right?
        </button>
      </p>
    );
  } else {
    // Found, or typed.
    const losing = top.filter((t) => t.removed.length).length;
    body = (
      <>
        <p className="text-xs text-ink-muted">
          {status === "typed" ? "As you typed it." : `From the pack's vacation schedule, at seniority #${number}.`} Every line is scored with it where it falls; to slide it,
          say what you want from it below, or step it on any opened line, which also says what it does there.{" "}
          <button type="button" className="font-medium text-brand underline underline-offset-2" onClick={() => setTyping(true)}>
            {status === "typed" ? "Change" : "Not right?"}
          </button>
          {status === "typed" && vacations.entry && vacations.packHasSchedule && (
            <>
              {" · "}
              <button type="button" className="font-medium text-brand underline underline-offset-2" onClick={() => saveTyped([], false)}>
                Use the pack&rsquo;s instead
              </button>
            </>
          )}
        </p>
        <div className="mt-3 space-y-3">
          {vacations.vacations.map((v) => {
            const current = state.vacationChoices?.[vacationId(v)] ?? "use";
            return (
              <fieldset key={vacationId(v)} data-vacation={vacationId(v)}>
                <legend className="text-sm font-medium text-ink">{vacationLabel(v, zone)}</legend>
                <div className="mt-1 space-y-1">
                  {CHOICES.map((c) => (
                    <label key={c.value} className="flex items-start gap-2 text-sm text-ink">
                      <input type="radio" className="mt-1" name={`vacation-${vacationId(v)}`} checked={current === c.value} onChange={() => set(v, c.value)} />
                      <span>
                        {c.label}. <span className="text-xs text-ink-muted">{c.detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
        {top.length > 0 && (
          <p className="mt-3 text-sm text-ink">
            {losing} of your top {top.length} lines {losing === 1 ? "loses" : "lose"} a trip to it.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-faint">
          Our reading of the contract, not an official award; the ranking doesn&rsquo;t charge for a heavy draw on your bank, and says so on the line. Your bank balance
          isn&rsquo;t in the pack. Some of this is still being checked with a retired FedEx captain.
        </p>
      </>
    );
  }

  return (
    <section aria-label="Your vacation" className={`${bare ? "" : "panel-glass mt-4 p-4 sm:p-5 "}print:hidden`} data-vacation-status={status}>
      <h2 className="text-sm font-semibold text-ink">Your vacation</h2>
      <div className="mt-1">{body}</div>
    </section>
  );
}

/** The pilot's seniority number, checked against the pack's list as they type it. */
function SeniorityNumberForm({ pack, lead, onSave }: { pack: BidPack; lead: string; onSave: (n: number) => void }) {
  const [text, setText] = useState("");
  const list = pack.seniorityList ?? [];
  const check = checkSeniority(text, list);
  const n = parseSeniorityInput(text);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (n !== null) onSave(n);
      }}
    >
      <p className="text-xs text-ink-muted">{lead}</p>
      <div className="flex flex-wrap items-end gap-2">
        {/* No wider than the card: at 320px and 200% text the field's 8rem ran past the card's edge. */}
        <label className="max-w-full text-xs text-ink-muted">
          Seniority number
          <input className={`${FIELD} mt-1 block w-32`} value={text} inputMode="numeric" autoComplete="off" onChange={(e) => setText(e.target.value)} />
        </label>
        <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs" disabled={n === null}>
          Find my vacation
        </Button>
      </div>
      {check?.kind === "not-listed" && <p className="text-xs text-warn">That number isn&rsquo;t on this pack&rsquo;s list. You can still save it and type your vacation.</p>}
      {check?.kind === "not-a-number" && <p className="text-xs text-warn">That isn&rsquo;t a seniority number.</p>}
      <p className="text-2xs text-ink-faint">Kept with your preferences, as Preferences keeps it.</p>
    </form>
  );
}

/** One or more vacations as the pilot types them: the first day and how many days, on the base's calendar. */
function TypedVacationForm({ pack, lead, initial, onSave, onCancel }: { pack: BidPack; lead: string; initial: TypedVacation[]; onSave: (typed: TypedVacation[]) => void; onCancel?: () => void }) {
  const [rows, setRows] = useState<{ firstDay: string; days: string }[]>(() => (initial.length ? initial.map((t) => ({ firstDay: t.firstDay, days: String(t.days) })) : [{ firstDay: "", days: "7" }]));
  const start = pack.bidPeriodStart ? DateTime.fromISO(pack.bidPeriodStart) : null;
  // A vacation this month can feel starts up to a slide (5 days) and its own length before the month, or before it ends.
  const min = start?.minus({ days: 45 }).toISODate() ?? undefined;
  const max = start?.plus({ days: pack.bidPeriodDays + 5 }).toISODate() ?? undefined;
  const read = rows.map((r) => ({ firstDay: r.firstDay, days: Number(r.days) }));
  const valid = read.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.firstDay) && Number.isInteger(r.days) && r.days >= 1 && r.days <= MAX_TYPED_DAYS);
  const ready = valid.length === read.length && valid.length > 0;
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSave(valid);
      }}
    >
      <p className="text-xs text-ink-muted">{lead}</p>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2" data-typed-vacation>
          {/* No wider than the panel: on a 320 phone with the text at 200% the date field ran 60px past it and the page
              scrolled sideways. */}
          <label className="max-w-full text-xs text-ink-muted">
            First day
            <input type="date" className={`${FIELD} mt-1 block max-w-full`} min={min} max={max} value={r.firstDay} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, firstDay: e.target.value } : x)))} />
          </label>
          <label className="text-xs text-ink-muted">
            Days
            <input className={`${FIELD} mt-1 block w-20`} inputMode="numeric" value={r.days} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, days: e.target.value } : x)))} />
          </label>
          {rows.length > 1 && (
            <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              Remove
            </Button>
          )}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs" disabled={!ready}>
          Use this vacation
        </Button>
        {rows.length < MAX_TYPED && (
          <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => setRows([...rows, { firstDay: "", days: "7" }])}>
            Add another
          </Button>
        )}
        {onCancel && (
          <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {initial.length > 0 && (
          <Button type="button" variant="ghost" className="px-2 py-1 text-xs" onClick={() => onSave([])}>
            Clear what I typed
          </Button>
        )}
      </div>
      <p className="text-2xs text-ink-faint">Its days run from the start of your domicile&rsquo;s day, as the pack prints vacations. Kept on this device with this pack.</p>
    </form>
  );
}
