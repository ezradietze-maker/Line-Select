import { sendEmail } from "@/lib/server/email";
import { getJson, incrementCounter } from "@/lib/server/kv";
import { posthogServer } from "@/lib/server/posthog";
import { siteSpentOn, spendCaps } from "@/lib/server/spend-guard";

/**
 * How the owner hears that something broke, without watching logs. Every failure a route catches goes to
 * `reportProblem`: it's logged, sent to PostHog's error tracking, and counted by kind. The third failure of one kind
 * within a clock hour emails `ALERT_EMAIL` — once that hour, so an outage is one email, not hundreds. After the
 * daily learning run, `sendDailySummary` emails yesterday's numbers; it arriving each morning is also the sign that
 * the daily run itself still happens.
 */

export type ProblemKind = "brain-build" | "brain-question" | "brain-ask" | "swap-reason" | "dictation" | "hotels" | "flights" | "parse-bidpack" | "profile-save" | "forecast" | "learning" | "browser";

const LABELS: Record<ProblemKind, string> = {
  "brain-build": "Brain reads (the interview's model)",
  "brain-question": "Interview questions",
  "brain-ask": "Ask your pack",
  "swap-reason": "Reasons pilots typed for swapping lines",
  dictation: "Dictation",
  hotels: "Hotel lookups",
  flights: "Flight lookups",
  "parse-bidpack": "Bid pack uploads",
  "profile-save": "Saving pilots' profiles",
  forecast: "Hold forecasts",
  learning: "Fleet learning",
  browser: "The app in pilots' browsers",
};

/** Failures of one kind in a clock hour that send an email. */
export const ALERT_THRESHOLD = 3;
const HOUR_SECONDS = 60 * 60;
const KEEP_SECONDS = 3 * 24 * 60 * 60;

const day = (now: Date) => now.toISOString().slice(0, 10);
const hourKey = (kind: ProblemKind, now: Date) => `line-select:problems:hour:${kind}:${Math.floor(now.getTime() / 1000 / HOUR_SECONDS)}`;
const dayKey = (kind: ProblemKind, d: string) => `line-select:problems:day:${kind}:${d}`;

export type ActivityKind = "brain-read" | "interview-question" | "ask" | "pack-parsed";
const activityKey = (kind: ActivityKind, d: string) => `line-select:activity:${kind}:${d}`;

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 300);
  return String(error).slice(0, 300);
}

/** Logs, tracks and counts one failure; emails on the hour's third of a kind. Never throws, and never slows the pilot's answer by more than the counter. */
export async function reportProblem(kind: ProblemKind, error: unknown, context: Record<string, unknown> = {}, now = new Date()): Promise<void> {
  console.error(`[${kind}]`, error, context);
  try {
    const capture = posthogServer?.captureExceptionImmediate(error instanceof Error ? error : new Error(describe(error)), undefined, { kind, ...context });
    const [inHour] = await Promise.all([incrementCounter(hourKey(kind, now), 2 * HOUR_SECONDS), incrementCounter(dayKey(kind, day(now)), KEEP_SECONDS), capture]);
    if (inHour === ALERT_THRESHOLD) await sendAlert(kind, inHour, describe(error));
  } catch (e) {
    console.error("[alerts] couldn't record a problem", e);
  }
}

/** Counts something that went right, for the daily summary. Never throws. */
export async function noteActivity(kind: ActivityKind, now = new Date()): Promise<void> {
  try {
    await incrementCounter(activityKey(kind, day(now)), KEEP_SECONDS);
  } catch {
    // A missed count only makes the summary a little low.
  }
}

function alertAddress(): string | null {
  return process.env.ALERT_EMAIL?.trim() || null;
}

/** A tester's feedback, emailed as it arrives — at beta size each one is worth reading the day it's sent. Never throws. */
export async function sendFeedbackNote(f: { category: string; message: string; page: string; pilotDisplayName: string | null; pilotEmail: string | null }): Promise<void> {
  const to = alertAddress();
  if (!to) return;
  const who = f.pilotEmail ? `${f.pilotDisplayName ?? "A pilot"} (${f.pilotEmail})` : "A guest";
  try {
    await sendEmail({ to, subject: `Line Select feedback: ${f.category}${f.page ? ` on ${f.page}` : ""}`, text: `${who} wrote${f.page ? ` from ${f.page}` : ""}:\n\n${f.message}` });
  } catch (e) {
    console.error("[alerts] couldn't email feedback", e);
  }
}

async function sendAlert(kind: ProblemKind, count: number, latest: string): Promise<void> {
  const to = alertAddress();
  if (!to) return;
  await sendEmail({
    to,
    subject: `Line Select: ${LABELS[kind].toLowerCase()} failing`,
    text: `${LABELS[kind]}: ${count} failures in the last hour. You'll get at most one email about this per hour.\n\nLatest: ${latest}\n\nPostHog's error tracking has each one, with the page it came from.`,
  });
}

export interface DailySummary {
  day: string;
  spentUsd: number;
  activity: Record<ActivityKind, number>;
  problems: Partial<Record<ProblemKind, number>>;
}

/** Yesterday's numbers (UTC): spend, activity, failures by kind. */
export async function summarizeDay(d: string): Promise<DailySummary> {
  const kinds = Object.keys(LABELS) as ProblemKind[];
  const activityKinds: ActivityKind[] = ["brain-read", "interview-question", "ask", "pack-parsed"];
  const [spentUsd, problemCounts, activityCounts] = await Promise.all([
    siteSpentOn(d),
    Promise.all(kinds.map((k) => getJson<number>(dayKey(k, d)))),
    Promise.all(activityKinds.map((k) => getJson<number>(activityKey(k, d)))),
  ]);
  const problems: Partial<Record<ProblemKind, number>> = {};
  kinds.forEach((k, i) => {
    if (problemCounts[i]) problems[k] = problemCounts[i]!;
  });
  const activity = Object.fromEntries(activityKinds.map((k, i) => [k, activityCounts[i] ?? 0])) as Record<ActivityKind, number>;
  return { day: d, spentUsd, activity, problems };
}

/** The daily email's text: the day's summary, then what the learning run just did. */
export function dailySummaryText(s: DailySummary, learning: Record<string, unknown> | null): string {
  const problemLines = (Object.entries(s.problems) as [ProblemKind, number][]).map(([k, n]) => `  - ${LABELS[k]}: ${n}`);
  const steps = Array.isArray(learning?.results) ? (learning.results as Record<string, unknown>[]) : [];
  const stepLines = steps.map((r) => {
    if (r.error) return `  - ${String(r.step)}: FAILED — ${String(r.error)}`;
    if (r.skipped) return `  - ${String(r.kind)}: skipped (${String(r.skipped)})`;
    return `  - ${String(r.kind)}: ${r.promoted ? "new version in use" : "kept the current version"} (${String(r.version)})`;
  });
  return [
    `Line Select, ${s.day} (UTC)`,
    "",
    `AI and lookups spent: $${s.spentUsd.toFixed(2)} of the $${spendCaps().site} daily limit`,
    `Brain reads: ${s.activity["brain-read"]} · interview questions: ${s.activity["interview-question"]} · Ask your pack: ${s.activity.ask} · packs uploaded: ${s.activity["pack-parsed"]}`,
    "",
    problemLines.length ? "Failures:" : "Failures: none",
    ...problemLines,
    "",
    learning ? "This morning's learning run:" : "This morning's learning run: didn't run (another was already in progress)",
    ...stepLines,
  ].join("\n");
}

/** Emails the summary of the UTC day before `now`. Returns whether it was sent. */
export async function sendDailySummary(learning: Record<string, unknown> | null, now = new Date(), weekly: string | null = null): Promise<boolean> {
  const to = alertAddress();
  if (!to) {
    console.error("[alerts] daily summary not sent: ALERT_EMAIL isn't set");
    return false;
  }
  const yesterday = day(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  const s = await summarizeDay(yesterday);
  const failed = Object.keys(s.problems).length > 0 || (Array.isArray(learning?.results) && (learning.results as { error?: unknown }[]).some((r) => r.error));
  const text = weekly ? `${dailySummaryText(s, learning)}\n\n\n${weekly}` : dailySummaryText(s, learning);
  return sendEmail({ to, subject: `Line Select ${weekly ? "weekly" : "daily"}: ${failed ? "something needs a look" : "all clear"} (${yesterday})`, text });
}
