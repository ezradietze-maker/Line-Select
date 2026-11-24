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
  const words = answer.replace(/[.!]+$/, "").split(/\s+/);
  return words.length <= SHORT ? `${words.join(" ")}. Got it.` : "Got it.";
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
