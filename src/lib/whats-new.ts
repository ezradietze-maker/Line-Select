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
    title: "Trades that help everyone on them",
    body: "Confirm what you hold on the Trade Board, and each day the site looks for trades that leave you and other pilots better off by your own priorities: a straight swap, or a chain of up to 5 pilots. Everyone says yes first, then you each submit your part in VIPS. Opens when your seat has enough pilots.",
    href: "/trade-board",
  },
  {
    date: "2026-11-08",
    title: "Open time, scored for you",
    body: "Paste the open-time list from VIPS and every trip gets a score for you, with the reasons: what it does to your days off, whether you can commute to it, and whether it's legal on your line. It checks overlaps and rest, the 0900 deadline, your make-up and trade limits, and holiday no-drops. We haven't seen a real VIPS list yet, so any row we can't read is shown to you, never guessed at.",
    href: "/open-time",
  },
  {
    date: "2026-11-08",
    title: "Your vacation now counts in your ranking",
    body: "If the pack shows a vacation for you this month, every line is scored with the trips it takes off, the days off you get, and what it draws from your bank, with the reason under each line. Rather keep your flying, or not taking it at all? Choose per vacation above your rankings. You need your seniority number in Preferences.",
    href: "/results",
  },
  {
    date: "2026-11-08",
    title: "See who held what, if pilots choose to share",
    body: "When you log an award you can now choose to show your seniority number beside your line. Once five pilots in a seat have said yes for a month, an opened line shows who held it. Your name never goes with it, and you can withdraw your share from the Logbook any time. Shared awards also check the odds against what really happened.",
    href: "/logbook",
  },
  {
    date: "2026-11-08",
    title: "A calendar that updates itself",
    body: "Subscribe in Apple Calendar, Google Calendar or Outlook with a private link: your bid dates for your seat, your #1 line's trips with hotels and pickups, and your award once you log it. Change your line here and your calendar follows, with nothing to export again. Find it under \"Ready to bid?\" or in your Logbook.",
    href: "/results",
  },
  {
    date: "2026-11-08",
    title: "Ask the contract",
    body: "A chat over the 2026 contract. Watch it search, read and check, then get a short answer and the contract's own words with the section and page, and when that rule starts. Ask follow-ups, or name a line to ask about your own pack. If it isn't in the text we have, it says so instead of guessing.",
    href: "/contract",
  },
  {
    date: "2026-11-08",
    title: "Quick start, in about a minute",
    body: "Short on time? Tap what matters, put it in order, and every line is ranked, reserve lines too. Dragging lines keeps teaching it, and the full interview is there when you want it sharper.",
    href: "/preferences",
  },
  {
    date: "2026-11-08",
    title: "Checks before you send to VIPS",
    body: "Send to VIPS now tells you how many of your lines will likely be gone at your turn, what to bid after your list, which reserve lines to name and in what order, and what each VIPS question means. It also warns if the bid has closed or the pack is the wrong one.",
    href: "/results",
  },
  {
    date: "2026-11-08",
    title: "Your View/Add list, built for you",
    body: "A page of its own: tell us your awarded line, and see the open trips that are legal on it, the combination that wins back your make-up with the most days off, and a list to copy into VIPS in order. Paste VIPS's own open-time list during the window. New bid packs you upload now keep their open trips.",
    href: "/view-add",
  },
  {
    date: "2026-11-08",
    title: "Find your best vacation slide",
    body: "On Strategies: every legal slide and expansion of your vacation on your top lines, scored on your own priorities, not just credit. See which trips come off, what it draws from your bank and the days off you end up with, the best three per line, and the best slide if you don't know which line you'll hold. You enter it in VIPS yourself, in the Conflict Input Window.",
    href: "/strategies",
  },
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
