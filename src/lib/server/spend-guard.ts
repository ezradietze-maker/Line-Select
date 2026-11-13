import { NextResponse } from "next/server";
import { getCurrentServerUser } from "@/lib/server/auth";
import { sendEmail } from "@/lib/server/email";
import { addToCounter, getJson, incrementCounter, releaseSlot, takeSlot } from "@/lib/server/kv";
import { clientIp, deviceIdFrom } from "@/lib/server/rate-limit";

/**
 * A dollar ceiling on everything that costs money per call — the AI, dictation, hotel and flight lookups — for the whole site
 * and for each pilot, per UTC day. Rate limits count requests, but one request can cost a tenth of a cent or half a
 * dollar, so only a running total of what was actually spent stops someone running up the bill (or a bug looping).
 *
 * An AI call holds the most it could cost against every ceiling before it starts, and settles to its real cost when it
 * ends (`startPaidCall`): checking first and recording after let fifty calls sent at once all pass the check before any
 * was recorded — one guest ran $15 against a $2 ceiling. A day can still end over a ceiling by one call's hold, the
 * last one let in while there was room. How many paid calls one pilot or one address has running is capped too.
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
    /** All the guests on one address together — a crew room's worth, so clearing cookies doesn't buy a fresh guest allowance. */
    guestAddress: dollars("SPEND_GUEST_ADDRESS_DAILY_USD", 10),
    /**
     * All the signed-in pilots on one address together. Accounts cost nothing to make, so without this one address could
     * make a dozen and spend the site's whole ceiling, pausing paid features for everyone. Room for a few pilots in one
     * crew room using the AI hard on the same day.
     */
    pilotAddress: dollars("SPEND_PILOT_ADDRESS_DAILY_USD", 30),
    /** Flight lookups have their own allowance beside the AI's, so neither can use up the other; the site's ceiling covers both. */
    flights: {
      pilot: dollars("SPEND_FLIGHTS_PILOT_DAILY_USD", 2),
      guest: dollars("SPEND_FLIGHTS_GUEST_DAILY_USD", 0.5),
      guestAddress: dollars("SPEND_FLIGHTS_GUEST_ADDRESS_DAILY_USD", 2.5),
      pilotAddress: dollars("SPEND_FLIGHTS_PILOT_ADDRESS_DAILY_USD", 7.5),
    },
  };
}

/** A paid feature with its own daily allowance (see `spendCaps`). */
export type SpendFeature = "flights";

interface SpendOptions {
  /** Charges the call to the site's total alone — see `checkSpend`. */
  siteOnly?: boolean;
  /** Charges the call to this feature's allowance instead of the pilot's general one. The site's total counts it either way. */
  feature?: SpendFeature;
  now?: Date;
}

/**
 * Who a call is charged to: the signed-in account, or for a guest their device (the address when there's no device
 * cookie); and also the address everyone of their kind on it shares (`addressKey`): guests together, and signed-in
 * pilots together, each with its own ceiling (`guestAddress`, `pilotAddress`).
 */
export interface Spender {
  key: string;
  signedIn: boolean;
  addressKey?: string;
}

/** A signed-in pilot, charged to their account and to the address all signed-in pilots on it share. */
export function pilotSpender(userId: string, request: Request): Spender {
  return { key: `u:${userId}`, signedIn: true, addressKey: `pilot-address:${clientIp(request)}` };
}

export async function spenderFor(request: Request): Promise<Spender> {
  const user = await getCurrentServerUser().catch(() => null);
  if (user) return pilotSpender(user.id, request);
  const ip = clientIp(request);
  const device = deviceIdFrom(request);
  return { key: device ? `device:${device}` : `ip:${ip}`, signedIn: false, addressKey: `address:${ip}` };
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

const siteKey = (day: string) => `line-select:spend:site:${day}`;
const whoKey = (day: string, key: string) => `line-select:spend:who:${day}:${key}`;
const chargedTo = (key: string, feature?: SpendFeature) => (feature ? `${feature}:${key}` : key);

/** What the whole site spent on one UTC day (`YYYY-MM-DD`), in dollars — for the daily summary. */
export async function siteSpentOn(day: string): Promise<number> {
  return ((await getJson<number>(siteKey(day))) ?? 0) / MICRO;
}

/** The ceiling for everyone of this spender's kind on their address together. */
function addressCap(spender: Spender, limits: { guestAddress: number; pilotAddress: number }): number {
  return spender.signedIn ? limits.pilotAddress : limits.guestAddress;
}

/** `leftUsd`, asked for with a `feature`, is how much more can be spent today — so a call that buys many things at once can stop in time. */
export type SpendCheck = { ok: true; leftUsd?: number } | { ok: false; scope: "site" | "pilot" };

/**
 * Whether a paid call may start. `siteOnly` charges the call to the site's total alone — for hotel lookups, whose
 * results are cached for every pilot, so the first pilot to open a fresh pack shouldn't pay for everyone.
 */
export async function checkSpend(spender: Spender, { siteOnly = false, feature, now = new Date() }: SpendOptions = {}): Promise<SpendCheck> {
  const caps = spendCaps();
  const limits = feature ? caps[feature] : caps;
  const day = today(now);
  const [site, mine, address] = await Promise.all([
    getJson<number>(siteKey(day)),
    siteOnly ? Promise.resolve(0) : getJson<number>(whoKey(day, chargedTo(spender.key, feature))),
    siteOnly || !spender.addressKey ? Promise.resolve(0) : getJson<number>(whoKey(day, chargedTo(spender.addressKey, feature))),
  ]);
  const siteLeft = caps.site * MICRO - (site ?? 0);
  const mineLeft = (spender.signedIn ? limits.pilot : limits.guest) * MICRO - (mine ?? 0);
  const addressLeft = addressCap(spender, limits) * MICRO - (address ?? 0);
  if (siteLeft <= 0) return { ok: false, scope: "site" };
  if (mineLeft <= 0 || addressLeft <= 0) return { ok: false, scope: "pilot" };
  return feature ? { ok: true, leftUsd: Math.min(siteLeft, mineLeft, addressLeft) / MICRO } : { ok: true };
}

/** Adds a finished call's cost. Never throws: a counter that can't be written must not fail the pilot's answer. */
export async function recordSpend(spender: Spender, usd: number, { siteOnly = false, feature, now = new Date() }: SpendOptions = {}): Promise<void> {
  if (!(usd > 0)) return;
  const amount = Math.ceil(usd * MICRO);
  const day = today(now);
  try {
    const [site] = await Promise.all([
      addToCounter(siteKey(day), amount, DAY_SECONDS),
      siteOnly ? Promise.resolve(0) : addToCounter(whoKey(day, chargedTo(spender.key, feature)), amount, DAY_SECONDS),
      siteOnly || !spender.addressKey ? Promise.resolve(0) : addToCounter(whoKey(day, chargedTo(spender.addressKey, feature)), amount, DAY_SECONDS),
    ]);
    if (site >= spendCaps().site * MICRO) await alertSiteCapReached(day, site / MICRO);
  } catch (e) {
    console.error("[spend] not recorded", e);
  }
}

/** The counters a call is charged to, each with its ceiling in millionths of a dollar. */
function countersFor(spender: Spender, feature: SpendFeature | undefined, day: string): { key: string; cap: number }[] {
  const caps = spendCaps();
  const limits = feature ? caps[feature] : caps;
  return [
    { key: siteKey(day), cap: caps.site * MICRO },
    { key: whoKey(day, chargedTo(spender.key, feature)), cap: (spender.signedIn ? limits.pilot : limits.guest) * MICRO },
    ...(spender.addressKey ? [{ key: whoKey(day, chargedTo(spender.addressKey, feature)), cap: addressCap(spender, limits) * MICRO }] : []),
  ];
}

/**
 * Takes up to `usd` of what's left, before a call that buys many things at once (flight boards): what two such calls
 * at the same moment take can't add up past a ceiling, as each spending all that `checkSpend` said was left could.
 * Returns what was taken; `releaseSpend` gives back what the call didn't use. Nothing is taken if it can't be counted.
 */
export async function reserveSpend(spender: Spender, usd: number, { feature, now = new Date() }: Omit<SpendOptions, "siteOnly"> = {}): Promise<number> {
  if (!(usd > 0)) return 0;
  const amount = Math.floor(usd * MICRO);
  const counters = countersFor(spender, feature, today(now));
  try {
    const totals = await Promise.all(counters.map((c) => addToCounter(c.key, amount, DAY_SECONDS)));
    const over = Math.max(0, ...totals.map((t, i) => t - counters[i].cap));
    const kept = Math.max(0, amount - over);
    if (kept < amount) await Promise.all(counters.map((c) => addToCounter(c.key, kept - amount, DAY_SECONDS)));
    return kept / MICRO;
  } catch (e) {
    console.error("[spend] not reserved", e);
    return 0;
  }
}

/** Gives back the part of a `reserveSpend` the call didn't spend. Never throws. */
export async function releaseSpend(spender: Spender, usd: number, { feature, now = new Date() }: Omit<SpendOptions, "siteOnly"> = {}): Promise<void> {
  const amount = Math.floor(usd * MICRO);
  if (!(amount > 0)) return;
  try {
    await Promise.all(countersFor(spender, feature, today(now)).map((c) => addToCounter(c.key, -amount, DAY_SECONDS)));
  } catch (e) {
    console.error("[spend] not released", e);
  }
}

/**
 * How many paid calls one pilot (or guest) may have running at once, and all of them on one address together. A real
 * interview runs a read of the answers beside the next question, now and then with dictation or Ask your pack; a
 * crew room has several pilots. Past these it's a script, and each call it holds is money held against the ceilings.
 */
export function inFlightCaps() {
  const count = (envName: string, fallback: number) => {
    const v = Number(process.env[envName]);
    return Number.isInteger(v) && v > 0 ? v : fallback;
  };
  return { spender: count("SPEND_IN_FLIGHT_PER_PILOT", 4), address: count("SPEND_IN_FLIGHT_PER_ADDRESS", 12) };
}

/**
 * A place in flight lets itself go this long after the last call on that key started — longer than the longest paid
 * route may run (the brain's read, 300 s) — so a function that crashed before giving its place back can't keep it.
 */
const IN_FLIGHT_SECONDS = 6 * 60;
const inFlightKey = (key: string) => `line-select:spend:in-flight:${key}`;

/** A paid call let in. `finish` must be called once, however the call ends, with what it really cost (0 if nothing). */
export interface PaidCall {
  finish: (usd: number) => Promise<void>;
}

export type PaidCallStart = ({ ok: true } & PaidCall) | { ok: false; scope: "site" | "pilot" | "busy" };

/**
 * Lets a paid call start, or says why not. It takes a place in flight for the spender and their address, then holds
 * `ceilingUsd` — the most the call can cost: every output token it may write, its whole input — against the site's,
 * the spender's and the address's totals for the day, all at once, so calls started together can't each see the same
 * room left. A call is let in while there was room before its hold, as `checkSpend` let one in while anything was
 * left. `finish` then trades the hold for the real cost, a failed call's included (`failedCallCost`), and gives the
 * place back. Throws only when the store can't be reached, like `checkSpend`.
 */
export async function startPaidCall(spender: Spender, ceilingUsd: number, { now = new Date() }: { now?: Date } = {}): Promise<PaidCallStart> {
  const caps = inFlightCaps();
  const places = [{ key: inFlightKey(spender.key), limit: caps.spender }, ...(spender.addressKey ? [{ key: inFlightKey(spender.addressKey), limit: caps.address }] : [])];
  const taken: string[] = [];
  const giveBack = () => Promise.all(taken.map((k) => releaseSlot(k).catch((e) => console.error("[spend] place not given back", e))));
  try {
    for (const p of places) {
      if (!(await takeSlot(p.key, p.limit, IN_FLIGHT_SECONDS))) {
        await giveBack();
        return { ok: false, scope: "busy" };
      }
      taken.push(p.key);
    }
  } catch (e) {
    await giveBack();
    throw e;
  }

  // The day it started is the day it's settled on, even if it ends after midnight.
  const day = today(now);
  const amount = Math.max(1, Math.ceil((ceilingUsd > 0 && Number.isFinite(ceilingUsd) ? ceilingUsd : 0) * MICRO));
  const counters = countersFor(spender, undefined, day);
  const held = await Promise.allSettled(counters.map((c) => addToCounter(c.key, amount, DAY_SECONDS)));
  const unhold = (only: (i: number) => boolean) =>
    Promise.all(counters.map((c, i) => (only(i) ? addToCounter(c.key, -amount, DAY_SECONDS).catch((e) => console.error("[spend] hold not given back", e)) : null)));
  const failed = held.find((h): h is PromiseRejectedResult => h.status === "rejected");
  if (failed) {
    await Promise.all([unhold((i) => held[i].status === "fulfilled"), giveBack()]);
    throw failed.reason;
  }
  const totals = held.map((h) => (h as PromiseFulfilledResult<number>).value);
  const full = totals.findIndex((t, i) => t - amount >= counters[i].cap);
  if (full >= 0) {
    await Promise.all([unhold(() => true), giveBack()]);
    // The site's counter is the first; reaching it pauses paid features for everyone, so the owner hears of it.
    if (full === 0) await alertSiteCapReached(day, (totals[0] - amount) / MICRO).catch((e) => console.error("[spend] alert not sent", e));
    return { ok: false, scope: full === 0 ? "site" : "pilot" };
  }

  let finished = false;
  return {
    ok: true,
    finish: async (usd: number) => {
      if (finished) return;
      finished = true;
      const spent = usd > 0 && Number.isFinite(usd) ? Math.ceil(usd * MICRO) : 0;
      try {
        if (spent !== amount) await Promise.all(counters.map((c) => addToCounter(c.key, spent - amount, DAY_SECONDS)));
      } catch (e) {
        console.error("[spend] not settled", e);
      }
      await giveBack();
    },
  };
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
    text: `Paid features (the interview, Ask your pack, dictation, new hotel and flight lookups) are paused until midnight UTC. Spent today: $${spentUsd.toFixed(2)}; the limit is $${spendCaps().site}. Raise SPEND_SITE_DAILY_USD in Vercel to resume sooner.`,
  });
}

/** What a pilot sees when a ceiling stops a call — the same 429 shape as a rate limit, so every caller already shows it. */
export function spendLimitResponse(check: { ok: false; scope: "site" | "pilot" | "busy" }): NextResponse {
  const error =
    check.scope === "site"
      ? "Line Select's AI is resting until tomorrow — it's had a very busy day. Everything you've done is saved."
      : check.scope === "busy"
        ? "You've got a few AI requests running already. Try again when one finishes — everything you've done is saved."
        : "You've reached today's limit for the AI features. They'll be back tomorrow — everything you've done is saved.";
  return NextResponse.json({ error }, { status: 429 });
}
