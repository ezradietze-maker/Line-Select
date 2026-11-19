/**
 * The tutorial video's chapters, in the order a pilot meets the features. Each is its own MP4 in public/tutorial, with
 * WebVTT captions of the narration and a poster frame. Recorded from the approved script in docs/tutorial/script.md;
 * the recording tools and how to re-record a chapter are in docs/tutorial/README.md.
 */
export interface TutorialChapter {
  /** The address's #fragment that opens this chapter (`/tutorial#strategies`). */
  id: string;
  title: string;
  /** One sentence on what the chapter shows, under the player. */
  summary: string;
  seconds: number;
  video: string;
  captions: string;
  poster: string;
}

const files = (n: number) => {
  const f = `/tutorial/ch${String(n).padStart(2, "0")}`;
  return { video: `${f}.mp4`, captions: `${f}.vtt`, poster: `${f}.jpg` };
};

export const TUTORIAL_CHAPTERS: TutorialChapter[] = [
  { id: "what-it-does", title: "What Line Select does", summary: "The four steps — load, brief, rank, check — and what the score is.", seconds: 57, ...files(1) },
  { id: "loading-your-pack", title: "Signing in and loading your bid pack", summary: "Creating an account, saving your recovery code, and loading your pack's PDF.", seconds: 67, ...files(2) },
  { id: "the-interview", title: "The interview", summary: "Your story in your own words, your commute and cities, real line and trip choices, and the review.", seconds: 95, ...files(3) },
  { id: "your-preferences", title: "Quick start and your preferences page", summary: "Ranking in about a minute, and changing what counts on your preferences page.", seconds: 70, ...files(4) },
  { id: "reading-your-rankings", title: "Reading your rankings", summary: "The score, the two ways to read a line, and a line's whole month.", seconds: 58, ...files(5) },
  { id: "inside-a-line", title: "Inside a line: trips, rest and the body clock", summary: "Trip details, each trip's score, the rest plan, the body-clock score and the route.", seconds: 57, ...files(6) },
  { id: "finding-lines", title: "Finding the lines you want", summary: "Ask your pack, sort, filters, compare, and jumping to a line.", seconds: 74, ...files(7) },
  { id: "swaps-and-tiers", title: "Putting your order right: swaps and tiers", summary: "Swapping lines, what each swap teaches, tiers, and the right-click menu.", seconds: 54, ...files(8) },
  { id: "this-months-bid", title: "This month's bid: deadline, carry-in, vacation and your chances", summary: "The countdown and checklist, carry-in, your vacation, and which lines you could hold.", seconds: 65, ...files(9) },
  { id: "sending-to-vips", title: "Sending your bid to VIPS", summary: "Copying your order, Send to VIPS, the bid questions and the checks before you send.", seconds: 60, ...files(10) },
  { id: "strategies", title: "Strategies", summary: "Your real place, the moves that fit it and what pilots held.", seconds: 59, ...files(11) },
  { id: "cities-and-hotels", title: "Cities and hotels", summary: "Every layover city at a glance, and the hotel your pack assigns, with reviews.", seconds: 42, ...files(12) },
  { id: "logbook-and-calendar", title: "Logbook and your calendar", summary: "Logging your award and how the month flew, sharing it, and the calendar link.", seconds: 53, ...files(13) },
  { id: "tools-and-pay", title: "Tools and Pay check", summary: "The world clock, the commute planner, and what each trip and line guarantee.", seconds: 51, ...files(14) },
  { id: "ask-the-contract", title: "Ask the Contract", summary: "Questions about the 2026 agreement, answered in its own words with the section and page.", seconds: 36, ...files(15) },
  { id: "trades-and-getting-around", title: "Trade Board, and getting around", summary: "Trade offers and trades found for you, Night mode, What's new and feedback.", seconds: 63, ...files(16) },
];

export function formatChapterLength(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The whole tutorial's length, as a pilot would say it ("about 16 minutes"). */
export function tutorialLength(): string {
  const total = TUTORIAL_CHAPTERS.reduce((s, c) => s + c.seconds, 0);
  return `about ${Math.round(total / 60)} minutes`;
}
