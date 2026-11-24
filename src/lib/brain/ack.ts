import { TRIP_GRADES_LEAD } from "@/lib/brain/trip-sort";

/**
 * The "got it" line over a question, when the app has to say it itself: over the questions it builds (trip grades,
 * dealbreakers, hub turning, the commute), which never had one, and over the interviewer's when its own is missing or
 * takes in an older answer than the last (on the owner's Nov 24 run, the line over a question after a line pick
 * repeated the Paris answer from two questions back). Always about the last answer, said plainly.
 */

/** The trip and line numbers in a text: "#459", "line 1210", or "1210" on its own. */
const numbersIn = (text: string) => [...text.matchAll(/#\s*(\d{1,5})\b|\b(\d{3,5})\b/g)].map((m) => m[1] ?? m[2]);

/** Plain words short enough to say back whole. */
const SHORT = 8;

export function answerAck(last: { question: string; answer: string } | undefined): string {
  if (!last) return "";
  const answer = last.answer.trim();
  if (!answer || answer === "(skipped)") return "Skipping that one is fine.";
  if (last.question.startsWith(TRIP_GRADES_LEAD)) {
    const graded = answer.split(" Why: ")[0].split(";").filter((s) => s.includes(":")).length;
    return graded ? `${graded} ${graded === 1 ? "trip" : "trips"} graded, got it.` : "Got it.";
  }
  // A line or trip pick, as the pair screens write it.
  const pick = answer.match(/^I'd (?:bid line (\d{3,5}) over line (\d{3,5})|rather fly Trip #(\d{1,5})[^(]*? than Trip #(\d{1,5})[^(]*?) \((easily|just)\)/);
  if (pick) {
    const [better, worse] = pick[1] ? [`Line ${pick[1]}`, pick[2]] : [`#${pick[3]}`, `#${pick[4]}`];
    return `${better} over ${worse}${pick[5] === "easily" ? ", easily" : ""}. Got it.`;
  }
  const tie = answer.match(/^Couldn't choose between (?:line (\d{3,5}) and line (\d{3,5})|Trip #(\d{1,5})[^—]*? and Trip #(\d{1,5}))/);
  if (tie) return tie[1] ? `Lines ${tie[1]} and ${tie[2]} about even. Got it.` : `#${tie[3]} and #${tie[4]} about even. Got it.`;
  // A question of theirs isn't said back as if it were an answer ("What's a hub turn?. Got it.").
  if (/\?\s*$/.test(answer)) return "Got it.";
  const words = answer.replace(/[.!,;:…\s]+$/, "").split(/\s+/);
  return words.length <= SHORT ? `${toYou(words).join(" ")}. Got it.` : "Got it.";
}

/** Their "I" and "me" said back as "you": in the app's voice, "I'd take the nap. Got it." read as the app taking it. */
const YOU: Record<string, string> = { "i'd": "you'd", "i'm": "you're", "i've": "you've", "i'll": "you'll", me: "you", my: "your", mine: "yours", myself: "yourself" };
const BE: Record<string, string> = { am: "are", was: "were" };
function toYou(words: string[]): string[] {
  const out = words.map((w, i) => {
    const [, core, end] = w.match(/^(.*?)([.,;:!?)]*)$/)!;
    const k = core.toLowerCase().replace(/’/g, "'");
    if (k === "i") return `you${end}`;
    if (BE[k] && words[i - 1]?.toLowerCase() === "i") return `${BE[k]}${end}`;
    return YOU[k] ? `${YOU[k]}${end}` : w;
  });
  return out.length ? [out[0].charAt(0).toUpperCase() + out[0].slice(1), ...out.slice(1)] : out;
}

/**
 * Whether the interviewer's line takes in the last answer: after a pick or a screen of grades it names one of the
 * numbers that answer was about, or the grades. Any other answer it can't be checked against, so it stands.
 */
export function ackFitsLast(ack: string, last: { question: string; answer: string } | undefined): boolean {
  if (!last) return true;
  const named = new Set(numbersIn(ack));
  if (last.question.startsWith(TRIP_GRADES_LEAD)) return /\bgrad/i.test(ack) || numbersIn(last.answer).some((n) => named.has(n));
  if (/^(?:I'd bid line|I'd rather fly Trip|Couldn't choose between)/.test(last.answer.trim())) return numbersIn(last.answer).some((n) => named.has(n));
  return true;
}
