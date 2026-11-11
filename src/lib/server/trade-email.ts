import { getEmailConfig, sendEmail } from "@/lib/server/email";
import { incrementCounter } from "@/lib/server/kv";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { listTradeEmailTargets } from "@/lib/server/trade-suggestions";
import type { suggestionToStore } from "@/lib/trades/suggestions";

/**
 * The opt-in email when a new trade needs a pilot's answer. Each trade is stored once, so it's one email per pilot per
 * trade, and in-app they see it either way: an email not sent loses nothing, so this never throws or holds anything up.
 */

/** For the whole site: a busy morning must not use up the quota password resets depend on. Past it, pilots still see the trade in the app. */
const MAX_PER_HOUR = 30;
/** For one pilot, however many trades lapse and come back. */
const MAX_PER_PILOT_DAY = 2;

function tripText(trip: { pairingNumber: string | null; date: string | null }): string {
  const name = trip.pairingNumber ? `Pairing ${trip.pairingNumber}` : "a trip";
  if (!trip.date) return name;
  return `${name} on ${new Date(`${trip.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}

export async function emailNewTrade(trade: ReturnType<typeof suggestionToStore>, now = new Date()): Promise<number> {
  try {
    const config = getEmailConfig();
    if (!config) return 0;
    const targets = await listTradeEmailTargets(trade.members.map((m) => m.userId));
    let sent = 0;
    for (const m of trade.members) {
      const to = targets.get(m.userId);
      if (!to) continue;
      // The site's hour first: an email it stops must not use up one of the pilot's own for the day.
      const hour = now.toISOString().slice(0, 13);
      if ((await incrementCounter(`line-select:trade-email:${hour}`, 2 * 60 * 60)) > MAX_PER_HOUR) break;
      if (!(await checkRateLimit("trade-email-pilot", m.userId, MAX_PER_PILOT_DAY, 24 * 60 * 60)).ok) continue;
      const take = trade.members[(m.position + 1) % trade.members.length].give;
      const size = trade.members.length;
      const ok = await sendEmail({
        to,
        subject: "A trade for you on Line Select",
        text:
          `Line Select found a trade that may suit you: give ${tripText(m.give)}, get ${tripText(take)}.\n\n` +
          `${size === 2 ? "It's a swap with one other pilot." : `It's a chain of ${size} pilots.`} Nothing happens until everyone says yes.\n\n` +
          `See it and answer: ${config.appUrl}/trade-board\n\n` +
          `To stop these emails, turn them off under What you hold on the Trade Board.`,
      });
      if (ok) sent++;
    }
    return sent;
  } catch (e) {
    console.error("[trades] email not sent", e);
    return 0;
  }
}
