import { NextResponse } from "next/server";
import { DEVICE_COOKIE, deviceIdOf } from "@/lib/device-cookie";
import { getJson, incrementCounter, setJson } from "@/lib/server/kv";

/**
 * A minimal attempt counter for login, backed by the same persistent
 * kv store as everything else (`kv.ts`) — Redis in production, so this
 * actually holds up across serverless instances, not just a single warm
 * one. Scoped by both a `scope` (e.g. "login") and an `identifier` (e.g. a
 * normalized email) so different kinds of rate limits never collide.
 */

const WINDOW_SECONDS = 15 * 60;
export const MAX_ATTEMPTS = 6;

// A plain integer under its own prefix: Redis INCR can't touch the `{ count }` objects the old read-then-write limiter left.
function attemptKey(scope: string, identifier: string): string {
  return `line-select:attempts:${scope}:${identifier}`;
}

/**
 * Takes one attempt before the password (or code) is checked; false once the ceiling is reached. Counting
 * first, atomically, is what stops a burst of parallel guesses: checking and then recording a failure let every
 * request in the burst see the same count. The window runs from the first attempt; a success clears it.
 */
export async function takeAttempt(scope: string, identifier: string, max: number = MAX_ATTEMPTS): Promise<boolean> {
  return (await incrementCounter(attemptKey(scope, identifier), WINDOW_SECONDS)) <= max;
}

/** Like `takeAttempt`, but says how many attempts this caller has used in the window, this one included. */
export async function countAttempt(scope: string, identifier: string): Promise<number> {
  return incrementCounter(attemptKey(scope, identifier), WINDOW_SECONDS);
}

/** How many attempts are used in the window so far, without taking one. */
export async function attemptsUsed(scope: string, identifier: string): Promise<number> {
  return Number((await getJson<number>(attemptKey(scope, identifier))) ?? 0);
}

/** Clears the counter after a genuine success, so a legitimate pilot who mistyped a password twice isn't penalized once they get it right. */
export async function clearAttempts(scope: string, identifier: string): Promise<void> {
  await setJson(attemptKey(scope, identifier), 0, { ttlSeconds: WINDOW_SECONDS });
}

/**
 * A second, simpler limiter for routes that don't have a per-account
 * success/failure to key off of (signup, PDF parsing, LLM/Places-backed
 * lookups) — a fixed-window request counter rather than the failed-attempt
 * tracking above. Fixed windows (not sliding/token bucket) are a deliberate
 * simplicity choice: good enough to stop scripted abuse and runaway API
 * cost without needing more precision than that. A burst right at a window
 * boundary can momentarily allow up to ~2x the stated limit — an accepted
 * trade for staying this simple.
 */
export async function checkRateLimit(
  bucket: string,
  identity: string,
  limit: number,
  windowSeconds: number
): Promise<{ ok: boolean }> {
  const window = Math.floor(Date.now() / 1000 / windowSeconds);
  const key = `line-select:ratelimit:${bucket}:${identity}:${window}`;
  const count = await incrementCounter(key, windowSeconds);
  return { ok: count <= limit };
}

/** How many devices' worth of requests one address may make: a crew room or hotel shares one, and a device that drops its cookie lands here. */
export const ADDRESS_FACTOR = 10;

/** The device id from the request's cookie, when it has a well-formed one this server signed. */
export function deviceIdFrom(request: Request): string | null {
  const match = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([^;]+)`));
  return deviceIdOf(match?.[1]);
}

/**
 * The limit for a route anyone can call, per device rather than per address: fifteen pilots on one crew room's
 * Wi-Fi each get the full `limit`, while the address as a whole gets `ADDRESS_FACTOR` times it, so clearing cookies
 * to look like a new device only reaches that ceiling. A request with no device cookie counts against its address
 * at the plain `limit`.
 */
export async function checkRequestLimit(bucket: string, request: Request, limit: number, windowSeconds: number): Promise<{ ok: boolean }> {
  const ip = clientIp(request);
  const device = deviceIdFrom(request);
  if (!device) return checkRateLimit(bucket, `ip:${ip}`, limit, windowSeconds);
  const [mine, address] = await Promise.all([
    checkRateLimit(bucket, `device:${device}`, limit, windowSeconds),
    checkRateLimit(`${bucket}:address`, ip, limit * ADDRESS_FACTOR, windowSeconds),
  ]);
  return { ok: mine.ok && address.ok };
}

/**
 * Best-effort caller address for rate limits and allowances, read from the headers most hosts (Vercel included) set on
 * the incoming request. An IPv6 address is cut to its /64: one home or phone connection is handed a whole /64 and can
 * use any address in it, so counted one by one it was billions of addresses, each with its own limits (the lockout's
 * address ceiling, spending per address, sign-ups per address). An IPv4 address is kept whole.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const raw = forwarded ? forwarded.split(",")[0] : request.headers.get("x-real-ip");
  return raw ? addressGroup(raw) : "unknown";
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * The key one sender's address is counted under: an IPv4 address as it is; IPv6 as its first 64 bits, written
 * `2001:db8:1:2::/64` whatever way the address was spelled (zeros left out, `::` anywhere, upper case). An IPv4 address
 * written as IPv6 (`::ffff:203.0.113.5`) is the IPv4 address. Anything else is kept as it came, trimmed.
 */
export function addressGroup(raw: string): string {
  let ip = raw.trim().toLowerCase();
  // "[2001:db8::1]:443" and "203.0.113.5:443": the port isn't part of who's asking.
  const bracketed = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) ip = bracketed[1];
  else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(":"));
  if (IPV4.test(ip)) return ip;
  if (!ip.includes(":")) return ip;
  ip = ip.split("%")[0];
  const mapped = ip.match(/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/) ?? ip.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  const hextets = expandIpv6(ip);
  if (!hextets) return ip;
  return `${hextets.slice(0, 4).map((h) => h.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** The eight groups of an IPv6 address, or null when it isn't one. An embedded IPv4 tail counts as the last two. */
function expandIpv6(ip: string): string[] | null {
  const tail = ip.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  let text = ip;
  if (tail) {
    const parts = tail[1].split(".").map(Number);
    if (parts.some((p) => p > 255)) return null;
    text = ip.slice(0, -tail[1].length) + `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...left, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...right];
  return all.every((h) => /^[0-9a-f]{1,4}$/.test(h)) ? all : null;
}

export function rateLimitedResponse(): NextResponse {
  return NextResponse.json(
    { error: "Too many requests — please slow down and try again shortly." },
    { status: 429 }
  );
}
