import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { sendEmail } from "@/lib/server/email";
import { addToCounter, getJson, incrementCounter } from "@/lib/server/kv";
import { clientIp } from "@/lib/server/rate-limit";

/**
 * A dollar ceiling on everything that costs money per call — the AI, dictation, hotel lookups — for the whole site
 * and for each pilot, per UTC day. Rate limits count requests, but one request can cost a tenth of a cent or half a
 * dollar, so only a running total of what was actually spent stops someone running up the bill (or a bug looping).
 *
 * Checked before a paid call, recorded after it with the call's real cost. Calls already under way when a ceiling is
 * reached still finish, so a day can end a few cents over — never by more than the calls in flight.
 *
 * Totals are kept in millionths of a dollar so Redis can add them atomically (INCRBY takes whole numbers).
 */

const MICRO = 1_000_000;
const DAY_SECONDS = 26 * 60 * 60; // a little over a day, so a counter outlives the day it counts

function dollars(envName: string, fallback: number): number {
  const v = Number(process.env[envName]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** The ceilings, in dollars per UTC day. Each can be changed in the environment without a deploy of new code. */
export function spendCaps() {
  return {
    site: dollars("SPEND_SITE_DAILY_USD", 100),
    pilot: dollars("SPEND_PILOT_DAILY_USD", 8),
    guest: dollars("SPEND_GUEST_DAILY_USD", 2),
  };
}

/** Who a call is charged to: the signed-in account, or for a guest the address they call from. */
export interface Spender {
  key: string;
  signedIn: boolean;
}

export async function spenderFor(request: Request): Promise<Spender> {
  const user = await getCurrentServerUser().catch(() => null);
  return user ? { key: `u:${user.id}`, signedIn: true } : { key: `ip:${clientIp(request)}`, signedIn: false };
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const siteKey = (day: string) => `line-select:spend:site:${day}`;
const spenderKey = (day: string, s: Spender) => `line-select:spend:who:${day}:${s.key}`;

/** What the whole site spent on one UTC day (`YYYY-MM-DD`), in dollars — for the daily summary. */
export async function siteSpentOn(day: string): Promise<number> {
  return ((await getJson<number>(siteKey(day))) ?? 0) / MICRO;
}

export type SpendCheck = { ok: true } | { ok: false; scope: "site" | "pilot" };

/**
 * Whether a paid call may start. `siteOnly` charges the call to the site's total alone — for hotel lookups, whose
 * results are cached for every pilot, so the first pilot to open a fresh pack shouldn't pay for everyone.
 */
export async function checkSpend(spender: Spender, { siteOnly = false, now = new Date() } = {}): Promise<SpendCheck> {
  const caps = spendCaps();
  const day = today(now);
  const [site, mine] = await Promise.all([getJson<number>(siteKey(day)), siteOnly ? Promise.resolve(0) : getJson<number>(spenderKey(day, spender))]);
  if ((site ?? 0) >= caps.site * MICRO) return { ok: false, scope: "site" };
  if ((mine ?? 0) >= (spender.signedIn ? caps.pilot : caps.guest) * MICRO) return { ok: false, scope: "pilot" };
  return { ok: true };
}

/** Adds a finished call's cost. Never throws: a counter that can't be written must not fail the pilot's answer. */
export async function recordSpend(spender: Spender, usd: number, { siteOnly = false, now = new Date() } = {}): Promise<void> {
  if (!(usd > 0)) return;
  const amount = Math.ceil(usd * MICRO);
  const day = today(now);
  try {
    const [site] = await Promise.all([
      addToCounter(siteKey(day), amount, DAY_SECONDS),
      siteOnly ? Promise.resolve(0) : addToCounter(spenderKey(day, spender), amount, DAY_SECONDS),
    ]);
    if (site >= spendCaps().site * MICRO) await alertSiteCapReached(day, site / MICRO);
  } catch (e) {
    console.error("[spend] not recorded", e);
  }
}

/** One email a day, the first time the site's ceiling is reached, to `ALERT_EMAIL` (when email is set up). */
async function alertSiteCapReached(day: string, spentUsd: number): Promise<void> {
  if ((await incrementCounter(`line-select:spend:alerted:${day}`, DAY_SECONDS)) !== 1) return;
  console.error("[spend] site daily ceiling reached", { day, spentUsd: +spentUsd.toFixed(2) });
  const to = process.env.ALERT_EMAIL?.trim();
  if (!to) return;
  await sendEmail({
    to,
    subject: "Line Select reached its daily AI spending limit",
    text: `Paid features (the interview, Ask your pack, dictation, new hotel lookups) are paused until midnight UTC. Spent today: $${spentUsd.toFixed(2)}; the limit is $${spendCaps().site}. Raise SPEND_SITE_DAILY_USD in Vercel to resume sooner.`,
  });
}

/** What a pilot sees when a ceiling stops a call — the same 429 shape as a rate limit, so every caller already shows it. */
export function spendLimitResponse(check: Extract<SpendCheck, { ok: false }>): NextResponse {
  const error =
    check.scope === "site"
      ? "Line Select's AI is resting until tomorrow — it's had a very busy day. Everything you've done is saved."
      : "You've reached today's limit for the AI features. They'll be back tomorrow — everything you've done is saved.";
  return NextResponse.json({ error }, { status: 429 });
}
