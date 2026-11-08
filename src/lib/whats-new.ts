/**
 * What's changed in Line Select, newest first, in a pilot's words — for the What's new page, and the dot beside its
 * link until a pilot has seen the latest. Add an entry when something a pilot would notice ships.
 */
export interface WhatsNewEntry {
  /** "2026-11-05" — also the entry's id. */
  date: string;
  title: string;
  body: string;
  /** Where to see it. */
  href?: string;
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    date: "2026-11-08",
    title: "Only real offers on your Trade Board",
    body: "Example offers now appear only with the sample pack. With your own pack, the board shows real pilots' offers, or says plainly that there aren't any yet.",
    href: "/trade-board",
  },
  {
    date: "2026-11-08",
    title: "Lines scored as they'll really fly with your carry-in",
    body: "Enter what runs in from last month, a trip or R-days, above your rankings. Each line is re-scored with what the contract does to it: the trips your carry-in drops, the make-up you're owed and the days off you gain, each with its section. It also suggests how to answer the bid's waiver questions. Our reading of the contract, not an official award.",
    href: "/results",
  },
  {
    date: "2026-11-08",
    title: "Sort by anything, filter on real commutes, and sort lines into tiers",
    body: "Sort your lines by anything Line Select measures, with a look at what lands on top first; sorting is for looking, and what you send still follows your ranking and tiers. New filters cover takeoff times, deadheads, out-and-backs, TAFB and credit ranges, any city a line touches, and whether real flights get you to work and home on the day. Open a line to put it in Best, Better, Good, Backup or Not bid (or press 1\u20135), pick several with shift-click or a long press, and undo as far back as you like. Tier moves teach your priorities the way swaps do, and Send to VIPS and Copy follow your tiers, leaving out Not bid.",
    href: "/results",
  },
  {
    date: "2026-11-07",
    title: "The countdown reads your bid pack",
    body: "Bid close now comes straight from the bid calendar printed on your pack's cover, for your seat, in Memphis time — nothing to type in. You can still set your own time if FedEx announces a change. Upload this month's pack again to pick it up.",
    href: "/results",
  },
  {
    date: "2026-11-07",
    title: "Send to VIPS",
    body: "Your ranked order goes straight into VIPS's Monthly Bid Input: open it from \"Ready to bid?\", answer VIPS's bid questions, and sign in to FedEx in the new tab. Line Select never sees your FedEx password. Check Monthly Bid Review afterwards.",
    href: "/results",
  },
  {
    date: "2026-11-05",
    title: "Your bid checklist and countdown",
    body: "Above your rankings: when bidding closes, counted down, with a reminder in your phone's calendar the day before and an hour before — and the month's bid step by step, ticking itself off as you go.",
    href: "/results",
  },
  {
    date: "2026-11-05",
    title: "Ask your pack",
    body: "Ask a question in plain words — \"lines with Honolulu and no weekends worked\" — and get the pack's own lines back, each with the figures it was picked on.",
    href: "/results",
  },
  {
    date: "2026-11-05",
    title: "Layover cities",
    body: "Every city your pack lays you over in: the local time and daylight there, last year's weather for your bid month's dates, the hotel, and every stay and the lines that fly it.",
    href: "/cities",
  },
  {
    date: "2026-11-05",
    title: "Logbook",
    body: "Log each month's award and how the month flew. It adds up to what you've held, where you've been and where your seniority's heading — and, if you choose to share it anonymously, sharpens which lines pilots like you can hold.",
    href: "/logbook",
  },
  {
    date: "2026-11-05",
    title: "Tools: world clock and commute planner",
    body: "The time everywhere your pack goes (or at any time you pick), and the airline flights to and from each trip of your top lines.",
    href: "/tools",
  },
  {
    date: "2026-11-05",
    title: "Full days in your layover cities",
    body: "A layover that gives you a whole day off in a city you like counts for more — land, a full night's sleep, the whole next day free, a second full night. They're marked on the calendar and in each trip.",
    href: "/results",
  },
  {
    date: "2026-11-01",
    title: "Lines judged on their own bid month",
    body: "What a line's last trip flies into next month is counted apart — its C/O credit and days are shown, but the month's numbers, and the ranking, are this month's alone.",
    href: "/results",
  },
  {
    date: "2026-10-30",
    title: "Body clock score",
    body: "Every line and trip scored 1–100 for how gentle it is on your body clock — night work, early shows, flips, time zones — with the reasons a tap away.",
    href: "/results",
  },
  {
    date: "2026-10-30",
    title: "Lines laid out like the bid pack",
    body: "Your rankings open on compact strips that read like the pack's own line pages, with a timeline view beside them. Tap a line for its whole month.",
    href: "/results",
  },
];

export const LATEST_WHATS_NEW = WHATS_NEW[0].date;
const SEEN_KEY = "line-select:whats-new-seen:v1";

/** Whether this device has seen the latest entry. */
export function hasSeenLatest(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === LATEST_WHATS_NEW;
  } catch {
    return true;
  }
}

export function markLatestSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, LATEST_WHATS_NEW);
  } catch {
    // Nothing to remember it in — the dot just shows again next visit.
  }
}
