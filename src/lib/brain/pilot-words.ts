/**
 * The words pilots use for their work, gathered from how the ex-pilot wrote and talked about bidding (Oct 2026), and the
 * phrases the app had made up that no pilot says. He read the app's question "Say a trip joins from LAX or the Pacific…
 * how much of your layover value would you give up?" and said the terminology was off: a trip has a front-end deadhead
 * to LAX; nobody's trip "joins from" anywhere, and nobody has a "layover value". Everything the app says to a pilot —
 * the interviewer's questions and replies, the brain's names for their priorities, the screens — speaks these words, and
 * the checks (`avoidedPhrases`, `scripts/eval/interview-quality.ts`) catch the made-up ones.
 *
 * A pilot's own words come first: if they call it "sign-in", say sign-in.
 */

export interface PilotWord {
  term: string;
  /** What it means, as a pilot would explain it. */
  means: string;
  /** Other ways pilots say it. */
  alsoSaid?: string[];
}

export const PILOT_WORDS: PilotWord[] = [
  { term: "departure", means: "leaving home once to fly one or more trips back to back — what a commuter counts", alsoSaid: ["series of trips", "trip sequence"] },
  { term: "trip", means: "one pairing as the bid pack prints it, report to release", alsoSaid: ["pairing"] },
  { term: "commute", means: "getting from home to base, or back, on your own time" },
  { term: "front-end deadhead", means: "a trip that starts by riding as a passenger to where the flying begins — caught from home, it saves the commute in", alsoSaid: ["front end d/h"] },
  { term: "back-end deadhead", means: "a trip that ends by riding as a passenger", alsoSaid: ["back end d/h"] },
  { term: "double deadhead", means: "a trip with a deadhead at both ends — from home and back home, no commute to base at all" },
  { term: "deviate", means: "ride home from where the flying ends instead of back to base" },
  { term: "jumpseat", means: "riding the cockpit jumpseat, e.g. commuting in to base for a show" },
  { term: "show time", means: "when the duty starts", alsoSaid: ["show", "report"] },
  { term: "hub turn", means: "flying into a sort hub, sitting through the sort, and flying back out — at night, a night hub turn" },
  { term: "crew-rest hotel", means: "a short airport hotel during a long hub sit, for a nap" },
  { term: "block time", means: "actual flying time", alsoSaid: ["block"] },
  { term: "credit", means: "what a trip or line pays, in hours" },
  { term: "TAFB", means: "time away from base" },
  { term: "duty period", means: "show to release" },
  { term: "layover", means: "the hotel stay between duty periods" },
  { term: "a full day", means: "on a layover, a whole day free in the city" },
  { term: "backside of the clock", means: "working through the small hours, when the body wants to sleep" },
];

/** Phrases the app made up, and what a pilot says instead. */
export const AVOIDED: { phrase: RegExp; say: string }[] = [
  { phrase: /\b(?:joins?|joined|joining)\s+(?:(?:it|the trip|straight)\s+)?from\b/i, say: "starts with a deadhead from (a front-end deadhead)" },
  { phrase: /\b(?:trips?|lines?)\s+(?:(?:you|i|we|they)\s+)?(?:can\s+)?join\b/i, say: "trips that start with a deadhead from home (a front-end deadhead)" },
  { phrase: /\blayover value\b/i, say: "the layovers themselves, or time in cities they like" },
  { phrase: /\bweighted hours\b/i, say: "hours in cities they like" },
  { phrase: /\b(?:utility|utilities|criterion|criteria|metrics?)\b/i, say: "what they care about — their priorities" },
];

/** The made-up phrases in a piece of text, as found — except any kind the pilot used themselves (`theirs`: their own words). */
export function avoidedPhrases(text: string, theirs = ""): string[] {
  return AVOIDED.flatMap((a) => {
    const m = text.match(a.phrase);
    return m && !a.phrase.test(theirs) ? [m[0]] : [];
  });
}

/** What to say instead of a made-up phrase found by `avoidedPhrases`. */
export function insteadOf(found: string): string {
  return AVOIDED.find((a) => a.phrase.test(found))?.say ?? "a pilot's own words";
}

/** The word list, for a prompt: each term with what it means, then the phrases never to use. */
export function pilotWordsForPrompt(): string {
  const terms = PILOT_WORDS.map((w) => `- ${w.term}${w.alsoSaid?.length ? ` (also "${w.alsoSaid.join('", "')}")` : ""}: ${w.means}`).join("\n");
  const avoided = ['"joins from", "trips you can join"', '"layover value"', '"weighted hours"', '"utility", "criterion", "metric"'].join(", ");
  return `${terms}\nNever say ${avoided} — made-up words no pilot uses. A trip doesn't "join from" a city: it starts with a front-end deadhead from there. Say what the layovers are like ("time in cities you like"), not their "value".`;
}

/**
 * Words that state a limit — a line ruled out, not a preference. A reply that says one puts a rule in the pilot's mouth
 * unless they said one: the ex-pilot answered the Dealbreakers question by saying he ranks lines rather than filtering
 * them out and wouldn't rule anything out, ideally no more than about two Memphis commutes — and the reply was "That's a
 * firm cap on Memphis" (Oct 2026). He noticed.
 */
const LIMIT_WORDS = /\b(?:firm|hard (?:no|line|limit|cap|cutoff|stop|number)|caps?|never(?=\s+(?:bid|take|fly|do|more|over|under|below|again|any|a|an|one|two|three|four|five)\b|\s*(?:[—–.,;!]|$))|rules? (?:\w+ ){0,2}out|ruled out|dealbreakers?|deal-breakers?|non-negotiable|absolute(?:ly)?|walk(?:s|ed)? away|you walk|off the table|(?:is|are|it's|that's) out|no way (?=I\b|I'd|I'm|would|am)|no-go)\b/i;
/** How a pilot says they won't bid something — their own limit, in their own words. */
const STATED_LIMIT = /\b(?:firm|hard (?:no|line|limit|cap|cutoff|stop|number)|caps?|never(?=\s+(?:bid|take|fly|do|more|over|under|below|again|any|a|an|one|two|three|four|five)\b|\s*(?:[—–.,;!]|$))|rules? (?:\w+ ){0,2}out|rule (?:it|that|them) out|dealbreakers?|deal-breakers?|non-negotiable|absolute(?:ly)?|my (?:limit|max(?:imum)?|floor|ceiling)|(?:the|a) (?:limit|max(?:imum)?)\b|at most|won't (?:bid|take|fly|do)|wouldn't (?:bid|take|fly)|will not bid|(?:is|are|it's|that's) out|off my list|throw (?:it |that |them )?out|no matter (?:how|what)|(?:is|it's|that's) a no|dead to me|pass on|walk away|no way (?=I\b|I'd|I'm|would|am)|no-go)\b/i;
/** A limit word that's denied ("I wouldn't rule anything out", "nothing's an absolute", "not a dealbreaker") states no limit. */
const DENIED = /\b(?:not|no|nothing(?:'s| is)?|isn't|aren't|wasn't|don't|doesn't|didn't|wouldn't|won't|can't|never)\b[^.,;!?]{0,40}?\b(?:rule|absolute|hard|firm|caps?|limit|dealbreakers?|deal-breakers?|cutoff|max(?:imum)?|off the table)\w*(?:\s+(?:anything|it|that|them|a line|lines))?(?:\s+out)?|\bhow (?:firm|hard|absolute)\b/gi;

/** A limit only come near ("the closest thing to a dealbreaker", "almost a hard no") is no limit either. */
const HEDGED = /\b(?:closest thing to|close to|closer to|nearly|almost|near|borderline)\s+(?:a |an |the )?(?:dealbreaker|deal-breaker|hard no|hard line|limit|cap)\b/gi;

/** The limit words a text states, denials ("not a dealbreaker") and hedges left out. */
export function limitWordsIn(text: string): string[] {
  const m = text.replace(DENIED, " ").replace(HEDGED, " ").match(LIMIT_WORDS);
  return m ? [m[0]] : [];
}

/** Whether a pilot's answer states a limit of their own, as against a preference ("ideally no more than two"). */
export function statesALimit(answer: string): boolean {
  return STATED_LIMIT.test(answer.replace(DENIED, " "));
}

/** A reply that states a limit the pilot's answer didn't: the limit word it invented, or null. */
export function inventedLimit(reply: string, answer: string): string | null {
  const found = limitWordsIn(reply)[0];
  return found && !statesALimit(answer) ? found : null;
}
