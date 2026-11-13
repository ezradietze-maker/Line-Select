import { sendEmail } from "@/lib/server/email";
import { incrementCounter } from "@/lib/server/kv";
import { addressGroup } from "@/lib/server/rate-limit";

/**
 * How many account emails the whole site sends in an hour, by kind. The limits per address and per account still let
 * one sender mail every real account it knows of, or sign up with a hundred made-up addresses, and that would spend
 * the email quota every reset, confirm link and alert depends on. Each kind has its own allowance, so a busy hour of
 * sign-ups can't stop resets, nor resets sign-ups:
 *
 * - "reset": reset links a pilot asks for (`/api/auth/forgot`). Well above what pilots really ask for.
 * - "sign-up": everything signing up and "Send it again" send: confirm links, the note to an address that already has
 *   an account, the link that lets an address's owner take back an account someone else started. Room for a busy
 *   launch hour, well below the quota.
 *
 * Reaching one emails the owner (`ALERT_EMAIL`), once that hour, so a ceiling hit by real pilots gets raised rather than quietly
 * turning them away.
 */
export const SITE_MAILS_PER_HOUR = { reset: 40, "sign-up": 100 } as const;

/**
 * The most of one kind's hour a single sender may use, across every address it names: one address (an IPv6 /64 counts
 * as one) with a few made-up accounts asking for link after link could otherwise use up the hour, and every real
 * pilot who signed up then would get nothing.
 */
export const SITE_MAILS_PER_SENDER_PER_HOUR = 5;

export type SiteMailKind = keyof typeof SITE_MAILS_PER_HOUR;

/** The reset allowance keeps the key it always had, so an hour under way when this deploys keeps its count. */
const KEYS: Record<SiteMailKind, string> = { reset: "line-select:reset-mail", "sign-up": "line-select:sign-up-mail" };

/**
 * Takes one email from this hour's allowance, as sent for `from`; false once the sender's share or the site's hour is
 * used up. The sender's share is counted first, so one sender over theirs never touches the site's count. Past either,
 * the caller answers exactly as it would have, so the allowance says nothing about who has an account. When it can't
 * be counted the email goes ahead, held by the limits per address and per account as before.
 */
export async function siteMailLeft(kind: SiteMailKind, from: string, now = new Date()): Promise<boolean> {
  const hour = now.toISOString().slice(0, 13);
  try {
    if ((await incrementCounter(`${KEYS[kind]}:sender:${hour}:${addressGroup(from)}`, 2 * 60 * 60)) > SITE_MAILS_PER_SENDER_PER_HOUR) return false;
    const used = await incrementCounter(`${KEYS[kind]}:${hour}`, 2 * 60 * 60);
    if (used <= SITE_MAILS_PER_HOUR[kind]) return true;
    console.error("[auth] hourly email allowance reached", { kind, hour });
    const to = process.env.ALERT_EMAIL?.trim();
    if (used === SITE_MAILS_PER_HOUR[kind] + 1 && to) {
      await sendEmail({
        to,
        subject: `Line Select reached its hourly ${kind} email limit`,
        text: `${SITE_MAILS_PER_HOUR[kind]} ${kind} emails went out in the hour starting ${hour}:00 UTC, so more are held back until the next hour. If these are real pilots, raise SITE_MAILS_PER_HOUR in src/lib/server/mail-allowance.ts.`,
      });
    }
    return false;
  } catch (e) {
    console.error("[auth] email allowance not checked", { kind }, e);
    return true;
  }
}
