import { incrementCounter } from "@/lib/server/kv";

/**
 * How many account emails the whole site sends in an hour, by kind. The limits per address and per account still let
 * one address mail every real account it knows of, or sign up with a hundred made-up addresses, and that would spend
 * the email quota every reset, confirm link and alert depends on. Each kind has its own allowance, so a busy hour of
 * sign-ups can't stop resets, nor resets sign-ups:
 *
 * - "reset": reset links a pilot asks for (`/api/auth/forgot`). Well above what pilots really ask for.
 * - "sign-up": everything signing up and "Send it again" send: confirm links, the note to an address that already has
 *   an account, the link that lets an address's owner take back an account someone else started. Room for a busy
 *   launch hour, well below the quota.
 */
export const SITE_MAILS_PER_HOUR = { reset: 20, "sign-up": 40 } as const;

export type SiteMailKind = keyof typeof SITE_MAILS_PER_HOUR;

/** The reset allowance keeps the key it always had, so an hour under way when this deploys keeps its count. */
const KEYS: Record<SiteMailKind, string> = { reset: "line-select:reset-mail", "sign-up": "line-select:sign-up-mail" };

/**
 * Takes one email from this hour's allowance; false once it's used up. Past it the caller answers exactly as it would
 * have, so the allowance says nothing about who has an account. When it can't be counted the email goes ahead, held by
 * the limits per address and per account as before.
 */
export async function siteMailLeft(kind: SiteMailKind, now = new Date()): Promise<boolean> {
  const hour = now.toISOString().slice(0, 13);
  try {
    if ((await incrementCounter(`${KEYS[kind]}:${hour}`, 2 * 60 * 60)) <= SITE_MAILS_PER_HOUR[kind]) return true;
    console.error("[auth] hourly email allowance reached", { kind, hour });
    return false;
  } catch (e) {
    console.error("[auth] email allowance not checked", { kind }, e);
    return true;
  }
}
