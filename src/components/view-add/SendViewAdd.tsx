"use client";

import { DateTime } from "luxon";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { FIELD } from "@/components/ui/field";
import { formatHoursValue as hm } from "@/lib/interview-config";
import type { ViewAddPlan } from "@/lib/view-add";
import { getVipsEmployeeNumber, normalizeEmployeeNumber, setVipsEmployeeNumber } from "@/lib/vips-bid";
import { buildViewAddFields, parseViewAddSent, saveViewAddSent, useViewAddSentRaw, vipsViewAddUrl, type MakeUpType } from "@/lib/vips-view-add";
import type { BidPack } from "@/types/bidpack";

/**
 * Send to VIPS for View/Add: the list posted to VIPS's make-up page in a new tab, where the pilot signs in themselves.
 * One make-up type a submission, as the page takes it; a pilot owed both sends twice. New, and built from another tool's
 * reading of the page, so it says to check the list on VIPS before submitting, and keeps a record of what was sent.
 */
export function SendViewAdd({ plan, pack }: { plan: ViewAddPlan; pack: BidPack }) {
  const owedType: MakeUpType = plan.makeUp.muv > plan.makeUp.cia ? "MUV" : "CIA";
  const [type, setType] = useState<MakeUpType>(owedType);
  const owed = type === "CIA" ? plan.makeUp.cia : plan.makeUp.muv;
  const [hoursText, setHoursText] = useState(() => (owed > 0 ? hm(owed) : ""));
  const [employee, setEmployee] = useState(() => getVipsEmployeeNumber() ?? "");
  const [error, setError] = useState<string | null>(null);
  const sent = parseViewAddSent(useViewAddSentRaw(pack.id));

  const hours = readHours(hoursText);
  const preferences = useMemo(() => plan.preferences.flatMap((p) => (p.vips ? [p.vips] : [])), [plan.preferences]);
  const unwritten = plan.preferences.length - preferences.length;
  const build = useMemo(() => buildViewAddFields({ type, hours: hours ?? 0, preferences }), [type, hours, preferences]);
  const normalized = normalizeEmployeeNumber(employee);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    if (!normalized) {
      e.preventDefault();
      setError("Your FedEx employee number, digits only.");
      return;
    }
    if (!build.ok) {
      e.preventDefault();
      setError(build.reason);
      return;
    }
    setVipsEmployeeNumber(normalized);
    // After the browser has taken the post, as Send to VIPS for the bid does: changed during the submit, the form left the page unsent.
    const record = { at: new Date().toISOString(), type, hours: hours!, preferences: build.preferences };
    setTimeout(() => saveViewAddSent(pack.id, record), 0);
  }

  return (
    <section aria-label="Send to VIPS" className="mt-2 space-y-2 rounded-md border border-hairline p-3 print:hidden" data-view-add-send>
      <h3 className="text-sm font-semibold text-ink">
        Send to VIPS <span className="ml-1 rounded-[3px] border border-hairline px-1 py-px text-2xs font-medium text-ink-muted">New</span>
      </h3>
      <p className="text-xs leading-relaxed text-ink-muted">
        Opens VIPS&rsquo;s make-up page in a new tab with your {build.ok ? build.preferences.length : preferences.length} choices filled in, in this order. You
        sign in there and submit it yourself. It&rsquo;s new and no current pilot has tried it yet, so check every choice on VIPS before you submit. If
        VIPS asks for your make-up hours first, enter them there, then send again.
      </p>
      <form method="POST" target="_blank" action={normalized ? vipsViewAddUrl(normalized) : undefined} onSubmit={submit} className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-ink-muted">
            Make-up type
            <select className={`${FIELD} mt-1 block w-full`} value={type} onChange={(e) => {
              const next = e.target.value as MakeUpType;
              setType(next);
              const nextOwed = next === "CIA" ? plan.makeUp.cia : plan.makeUp.muv;
              setHoursText(nextOwed > 0 ? hm(nextOwed) : "");
              setError(null);
            }}>
              <option value="CIA">CIA, phase-in</option>
              <option value="MUV">MUV, vacation</option>
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            Hours to make up
            <input className={`${FIELD} mt-1 block w-full`} value={hoursText} inputMode="decimal" placeholder="12:00" onChange={(e) => {
              setHoursText(e.target.value);
              setError(null);
            }} />
          </label>
          <label className="text-xs text-ink-muted">
            FedEx employee number
            <input className={`${FIELD} mt-1 block w-full`} value={employee} inputMode="numeric" autoComplete="off" onChange={(e) => {
              setEmployee(e.target.value);
              setError(null);
            }} />
          </label>
        </div>
        {plan.makeUp.cia > 0 && plan.makeUp.muv > 0 && (
          <p className="text-xs text-ink-muted">
            You&rsquo;re owed both: {hm(plan.makeUp.cia)} CIA and {hm(plan.makeUp.muv)} MUV. VIPS takes one type at a time, so send once for each. A trip goes
            under one pay code (25.L.6.d).
          </p>
        )}
        {unwritten > 0 && <p className="text-xs text-warn">{unwritten} of your choices have no trip number or date in the pack, so they&rsquo;re left out: enter them on VIPS yourself.</p>}
        {build.ok && build.fields.map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs" disabled={!build.ok}>
          Open VIPS and send
        </Button>
        <p className="text-2xs text-ink-faint">Your employee number is only for VIPS&rsquo;s address. It stays in this browser and goes only to FedEx. Not made or endorsed by FedEx.</p>
      </form>
      {sent && (
        <details className="text-xs text-ink-muted" data-view-add-sent>
          <summary className="cursor-pointer">
            Last sent {DateTime.fromISO(sent.at).toFormat("LLL d, HH:mm")}: {sent.preferences.length} {sent.preferences.length === 1 ? "choice" : "choices"} as{" "}
            {sent.type}, {hm(sent.hours)} to make up
          </summary>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5 font-mono">
            {sent.preferences.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

/** "18:30", "18.5" or "18". */
function readHours(text: string): number | null {
  const t = text.trim();
  const hmMatch = /^(\d{1,2}):([0-5]\d)$/.exec(t);
  if (hmMatch) return Number(hmMatch[1]) + Number(hmMatch[2]) / 60;
  return /^\d{1,2}(\.\d+)?$/.test(t) ? Number(t) : null;
}
