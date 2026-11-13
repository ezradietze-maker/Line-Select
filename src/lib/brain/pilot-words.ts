/**
 * The words the app may say to a pilot, and nothing else: the bid pack's own words, as it prints them, and the words
 * the ex-pilot used when he wrote and talked about bidding (his Oct 15 2026 story and interview, his Oct 21 notes). He
 * read the app's question "Say a trip joins from LAX or the Pacific… how much of your layover value would you give up?"
 * and said the terminology was off: a trip has a front-end deadhead to LAX; nobody's trip "joins from" anywhere, and
 * nobody has a "layover value". So everything the app says to a pilot — the interviewer's questions and replies, the
 * brain's names for their priorities, the screens — speaks these words. Anything else is said in plain words built
 * from them, and the checks (`avoidedPhrases`, `scripts/eval/interview-quality.ts`) catch the made-up ones.
 *
 * The one exception: a word a pilot brought up themselves can be said back to them. Nothing else on the banned list ever
 * can. If they call it "sign-in", say sign-in.
 */

/** Where a word comes from: printed in the bid pack, or said by the ex-pilot. */
export type WordSource = "pack" | "ex-pilot";

export interface PilotWord {
  term: string;
  /** What it means, as a pilot would explain it. */
  means: string;
  /** Other ways pilots say it. */
  alsoSaid?: string[];
  source: WordSource;
  /** Where it's from: the pack's own heading or legend, or the ex-pilot's words with it in. */
  from: string;
  /** An ordinary word any speech service already hears ("credit", "hotel") — left off the dictation word list. */
  everyday?: true;
}

/** The bid pack's words, as it prints them (an Oct 2026 FedEx pack: trip pages, line pages, the info page). */
export const PACK_WORDS: PilotWord[] = [
  { term: "trip", means: "one pairing as the bid pack prints it, report to the end of its last duty", alsoSaid: ["pairing"], source: "pack", from: "PAIRING SCHEDULE, one numbered pairing each", everyday: true },
  { term: "line", means: "a month of trips bid as one", alsoSaid: ["regular line"], source: "pack", from: "LINE 1001… under Regular Lines", everyday: true },
  { term: "reserve line", means: "a line of reserve days instead of trips", source: "pack", from: "Reserve Lines - Captain" },
  { term: "secondary line", means: "a line built from what's left, released after the bid", source: "pack", from: "Total # Secondary Lines" },
  { term: "domicile", means: "where the pilot's trips start and end — Memphis, for a MEM pack", source: "pack", from: "MD11 MEM DOMICILE", everyday: true },
  { term: "bid month", means: "the month the pack covers: four weeks, or five", alsoSaid: ["4-week bid month", "5-week bid month"], source: "pack", from: "4 Week Bidmonth", everyday: true },
  { term: "report", means: "when the duty starts, at the time the pack prints", alsoSaid: ["report time"], source: "pack", from: "REPORT AT 0806 (0306)", everyday: true },
  { term: "leg", means: "one flight, operated or deadheaded", source: "pack", from: "S - Leg is flown under Supplemental rules", everyday: true },
  { term: "deadhead", means: "riding as a passenger to or from where the flying is", alsoSaid: ["DH", "d/h"], source: "pack", from: "DH on a leg's line", everyday: true },
  { term: "block", means: "flying time, in hours — never a stretch of days", alsoSaid: ["block hours", "BLK"], source: "pack", from: "BLOCK, BLOCK HRS, BLK.", everyday: true },
  { term: "credit", means: "what a trip or line pays, in hours", alsoSaid: ["credit hours", "CR"], source: "pack", from: "CREDIT, CREDIT HRS, CR., High Line Credit", everyday: true },
  { term: "duty period", means: "one duty, from report to the end of its last leg", alsoSaid: ["duty", "DP"], source: "pack", from: "DUTY, NO. DP'S", everyday: true },
  { term: "layover", means: "the hotel stay between duty periods, with its length in hours", source: "pack", from: "LAYOVER ANC 33:43", everyday: true },
  { term: "TAFB", means: "time away from base, report to the end of the trip", source: "pack", from: "TAFB: 54:14" },
  { term: "landings", means: "how many landings a trip or line has", alsoSaid: ["LDGS"], source: "pack", from: "LDGS: 1, NO. LANDINGS", everyday: true },
  { term: "carry-over", means: "the credit and block a line's last trip flies into the next month", alsoSaid: ["C/O"], source: "pack", from: "CR. C/O. BLK. C/O." },
  { term: "days off", means: "the days in the bid month with no duty", source: "pack", from: "DAYS OFF, Average Days Off", everyday: true },
  { term: "hotel", means: "the hotel the pack names for a layover", source: "pack", from: "Hotel: HILTON (ANC)", everyday: true },
  { term: "pickup", means: "the hotel van's time, to and from the airport", alsoSaid: ["transportation"], source: "pack", from: "Trans To: …, pickup @1609", everyday: true },
  { term: "standby", means: "on call, paid, at a hotel the company provides", alsoSaid: ["hotel standby"], source: "pack", from: "All standby crews are required to notify Crew Resource Scheduling… of hotel room", everyday: true },
  { term: "local time", means: "the time where the pilot is, as against GMT", alsoSaid: ["local", "GMT", "Zulu"], source: "pack", from: "(hhmm) - Local Military Time; Local day is before GMT day", everyday: true }, // Zulu isn't printed: it's the calendar switch's word for GMT, kept by the owner (Nov 2026).
  { term: "captain", means: "the left seat", alsoSaid: ["CAP", "first officer", "F/O"], source: "pack", from: "Regular Lines - Captain / First Officer", everyday: true },
];

/** The ex-pilot's words: how a FedEx captain who commuted from San Diego talks about bidding (Oct 2026). */
export const EX_PILOT_WORDS: PilotWord[] = [
  { term: "departure", means: "leaving home once to fly one or more trips back to back — what a commuter counts", alsoSaid: ["series of trips", "trip sequence", "combination of trips"], source: "ex-pilot", from: "“That line has seven trips listed, but when I look at that line as a San Diego commuter, I see three departures.”", everyday: true },
  { term: "commute", means: "getting from home to the domicile, or back, on your own time", alsoSaid: ["commuter", "getting to and from Memphis"], source: "ex-pilot", from: "“I live in San Diego, and so commuting is probably one of the more important factors”", everyday: true },
  { term: "front-end deadhead", means: "a trip that starts by riding as a passenger to where the flying begins — caught from home, it saves the commute in", alsoSaid: ["front end d/h"], source: "ex-pilot", from: "“The first of those three trips begins with a front-end deadhead, which is great.”" },
  { term: "back-end deadhead", means: "a trip that ends by riding as a passenger", alsoSaid: ["back end d/h"], source: "ex-pilot", from: "“the back end d/h makes this a pretty easy call”" },
  { term: "double deadhead", means: "a trip with a deadhead at both ends — from home and back home, no commute at all", source: "ex-pilot", from: "“that really functions as a single double-deadhead departure”" },
  { term: "West Coast deadhead", means: "a deadhead to or from a West Coast airport, easy from home for a West Coast commuter", source: "ex-pilot", from: "“if trips start with a West Coast deadhead — one that is easy for me to get to from San Diego”" },
  { term: "deviate", means: "ride home from where the flying ends instead of back to the domicile", source: "ex-pilot", from: "“I’d probably deviate on the back end and be back in SAN by Saturday afternoon”" },
  { term: "jumpseat", means: "riding the cockpit jumpseat, e.g. commuting in for a show", alsoSaid: ["jumpseating"], source: "ex-pilot", from: "“I might be fine jumpseating in from SAN on the evening SAN-MEM flight”" },
  { term: "show time", means: "when the duty starts", alsoSaid: ["show"], source: "ex-pilot", from: "“the duty period that starts with the 02:00 local show time”" },
  { term: "crash pad", means: "a shared place to sleep in the domicile city", source: "ex-pilot", from: "“I don’t have a crash pad in Memphis”" },
  { term: "hub turn", means: "flying into a sort hub, sitting while the packages are sorted, and flying back out", alsoSaid: ["hub turning"], source: "ex-pilot", from: "“the pilots are scheduled to sit around while the packages are sorted at that hub”" },
  { term: "night hub turning", means: "hub turns at night, repeated night after night through a trip", alsoSaid: ["night hub turns"], source: "ex-pilot", from: "“That would be called night hub turning.”" },
  { term: "out station", means: "an airport that isn't a hub", source: "ex-pilot", from: "“operate one of those outbound flights to an out station”" },
  { term: "crew-rest hotel", means: "a short airport hotel during a hub turn of more than four hours, for a nap", source: "ex-pilot", from: "“the pickup time to go from the hub to the ‘crew rest’ hotel”" },
  { term: "sleep room", means: "where a pilot naps at the hub", source: "ex-pilot", from: "“I’d probably catch a quick nap in the ‘sleep room’ at the hub in MEM”" },
  { term: "single-leg duty period", means: "a duty with one leg; two-leg and three-leg duties are more work", alsoSaid: ["two-leg duty period", "three-leg duty period"], source: "ex-pilot", from: "“I prefer single-leg duty periods”" },
  { term: "operating leg", means: "a leg the pilot flies, not deadheads", source: "ex-pilot", from: "“one less operating (a.k.a. ‘work’) leg”", everyday: true },
  { term: "block time", means: "actual flying time", source: "ex-pilot", from: "“Almost 18 hours of block time (actual work/flying time)”", everyday: true },
  { term: "a full day", means: "on a layover, arrive one day, sleep, a whole day in the city, and a full night's sleep before the next duty", source: "ex-pilot", from: "“had all day to explore that layover city, eat nice meals, etc.—then still had time to go to bed and get another full night’s sleep”", everyday: true },
  { term: "eat-and-sleep layover", means: "a layover with only time to eat and sleep", source: "ex-pilot", from: "“Layovers that are very short, that basically only allow time to eat and sleep, are not very attractive.”", everyday: true },
  { term: "backside of the clock", means: "working through the night, when the body wants to sleep", alsoSaid: ["back side of the clock"], source: "ex-pilot", from: "“it tends to be on the backside of the clock, so it’s a lot of circadian disruption”" },
  { term: "night flying", means: "flying at night, as against day flying", alsoSaid: ["day flying"], source: "ex-pilot", from: "“I suppose in general I prefer day flying to night flying”", everyday: true },
  { term: "body clock", means: "the body's sleep rhythm, and how hard a trip is on it", alsoSaid: ["circadian disruption"], source: "ex-pilot", from: "“that really messes with your body clock”", everyday: true },
  { term: "trip efficiency", means: "pay per day away from home", alsoSaid: ["pay per day away from home"], source: "ex-pilot", from: "“what I might call trip efficiency, or pay per day away from home”" },
  { term: "a real break", means: "enough days in a row at home between trips to feel like time off", alsoSaid: ["time at home"], source: "ex-pilot", from: "“it probably requires three or four days at home to start to feel like a real break between trips”", everyday: true },
  { term: "nights in my own bed", means: "nights at home", source: "ex-pilot", from: "“close to 72 hours at home—and three nights in my own bed”", everyday: true },
  { term: "drop a trip", means: "give a trip away after the award", source: "ex-pilot", from: "“I might be able to drop that small 3rd trip”", everyday: true },
  { term: "reserve", means: "on call from home or the domicile, as against hotel standby", source: "ex-pilot", from: "“I don’t want to do reserve in Memphis”", everyday: true },
  { term: "de-ice", means: "clearing snow or ice off the airplane before takeoff", alsoSaid: ["deicing"], source: "ex-pilot", from: "“the possibility of having to de-ice the airplane when there is snow or freezing rain”" },
  { term: "the dead of winter", means: "the coldest months at a city", alsoSaid: ["mid summer", "shoulder seasons"], source: "ex-pilot", from: "“Maybe avoid Boston in the dead of winter.”", everyday: true },
  { term: "lifestyle guy", means: "a pilot who bids for the life, not the most pay", alsoSaid: ["pay guy"], source: "ex-pilot", from: "“I would characterize myself as more of a lifestyle guy than a pay guy”", everyday: true },
  { term: "the contract", means: "the pilots' collective bargaining agreement and its rules", source: "ex-pilot", from: "“the Collective Bargaining Agreement (the ‘contract’ that has all the of company ‘rules’)”", everyday: true },
];

/** Every word the app may say to a pilot: the pack's, then the ex-pilot's. */
export const PILOT_WORDS: PilotWord[] = [...PACK_WORDS, ...EX_PILOT_WORDS];

/**
 * Words the app made up or borrowed, and what to say instead: found by reading everything a pilot sees against the
 * pack and the ex-pilot's own words (Nov 2026). A pilot can still say any of them — the brain understands them. It's
 * the app that doesn't. `name` is how a prompt names the word.
 */
export const AVOIDED: { name: string; phrase: RegExp; say: string }[] = [
  // What he objected to, Oct 2026.
  { name: "joins from", phrase: /\b(?:joins?|joined|joining)\s+(?:(?:it|the trip|straight)\s+)?from\b/i, say: "starts with a deadhead from (a front-end deadhead)" },
  { name: "trips you can join", phrase: /\b(?:trips?|lines?)\s+(?:(?:you|i|we|they)\s+)?(?:can\s+)?join\b/i, say: "trips that start with a deadhead from home (a front-end deadhead)" },
  { name: "layover value", phrase: /\blayover value\b/i, say: "the layovers themselves, or time in cities they like" },
  { name: "weighted hours", phrase: /\bweighted hours\b/i, say: "hours in cities they like" },
  { name: "weighted days", phrase: /\bweighted days\b/i, say: "full days in cities they like" },
  { name: "metric", phrase: /\b(?:utility|utilities|criterion|criteria|metrics?)\b/i, say: "what they care about — their priorities" },
  // Nights and the body clock: he says night flying, the backside of the clock, night hub turning.
  { name: "red-eye", phrase: /\bred[- ]?eyes?\b/i, say: "night flying, or a night leg on the backside of the clock" },
  { name: "all-nighter", phrase: /\ball[- ]nighters?\b/i, say: "a duty through the night" },
  { name: "small hours", phrase: /\bsmall[- ]hours\b/i, say: "the backside of the clock (midnight to 5am)" },
  { name: "back of the clock", phrase: /\bback[- ]of[- ](?:the[- ])?clock\b/i, say: "the backside of the clock" },
  { name: "circadian low", phrase: /\bcircadian low\b/i, say: "the backside of the clock" },
  { name: "day/night flips", phrase: /\b(?:day|night)\/(?:day|night) flips?\b/i, say: "going from day flying to night flying" },
  { name: "jet lag", phrase: /\bjet[- ]?lag\b/i, say: "time zones crossed, and the body clock" },
  { name: "fatigue management", phrase: /\bfatigue (?:management|risk)\b|\bmanaging fatigue\b/i, say: "being tired, or the body clock" },
  { name: "sleep opportunity", phrase: /\bsleep opportunit(?:y|ies)\b/i, say: "time to sleep" },
  // Block is flying time in the pack: time at home is never a block.
  { name: "a block of days off", phrase: /\b(?:real|long|big|solid|days?[- ]off|\d+[- ]day)\s+blocks?\b(?!\s+(?:time|hours?))|\bblocks?\s+of\s+(?:days|time)\b|\bhow long a block\b/i, say: "a real break, or days in a row at home (in the pack, block means flying time)" },
  { name: "block-in", phrase: /\bblock[- ](?:in|off|out)\b/i, say: "the time a flight departs or arrives" },
  // The domicile: the pack prints DOMICILE, and he says Memphis. TAFB's own "time away from base" stands, and so does
  // the contract's "base transit".
  { name: "base", phrase: /(?<!away from )\bbase\b(?! transit)/i, say: "the domicile by its city (\"Memphis\"), or \"domicile\" where no city is known" },
  // The duty: the pack prints DUTY, and he says duty period and show time.
  { name: "duty day", phrase: /\bduty[- ]days?\b/i, say: "duty period" },
  { name: "release", phrase: /\breport[- ](?:to|and|&)[- ]release\b|\b(?:after|at|duty)\s+release\b|\b(?:early|earliest|late|latest|a)\s+release\b|\brelease\s+(?:times?|back)\b|&\s+release\b/i, say: "the end of the duty period (in the pack, release is lines going out)" },
  { name: "sign-in time", phrase: /\b(?:early|late)\s+sign-?ins?\b|\bsign-?in\s+times?\b/i, say: "show time" },
  { name: "launch", phrase: /\blaunch(?:es)?\b/i, say: "report, or show time" },
  { name: "duty-to-flying", phrase: /\bduty[- ]to[- ](?:block|flying)\b|\bduty-heavy\b/i, say: "how much of the duty period is flying" },
  { name: "day-rig", phrase: /\bday[- ]rig\b/i, say: "pay per day away from home" },
  // Hubs: he says the hub turn, sitting in the hub while the packages are sorted, the crew-rest hotel, the out station.
  { name: "hub sit", phrase: /\b(?:hub|long|longer|short|shorter)\s+sits?\b|\b(?:the|a)\s+sit\b/i, say: "the time in the hub on a hub turn" },
  { name: "rest hotel", phrase: /(?<!crew[- ])\brest hotels?\b/i, say: "crew-rest hotel" },
  { name: "outstation", phrase: /\boutstations?\b/i, say: "out station" },
  // The commute: he talks about commuting in, jumpseating and show time.
  { name: "backup flights", phrase: /\bbackup flights?\b|\bbackups\b|\b(?:no|\d+|one|two|three) backups?\b/i, say: "other flights you could commute on" },
  // The contract's own buffers around international trips stand: "international buffer", "24-hour buffer".
  { name: "buffer", phrase: /(?<!international |duty[- ]free |\d\d-hour )\bbuffers?\b/i, say: "the time you leave before show" },
  // Layovers and the rest.
  { name: "overnight", phrase: /\bovernights\b|\b(?:an?|long|short|real)\s+overnight\b|\bovernight\s+in\b/i, say: "layover" },
  { name: "short-rest", phrase: /\b(?:short|long)-rest\b/i, say: "a short layover, or a long one" },
  { name: "overseas", phrase: /\boverseas\b/i, say: "international" },
  { name: "hops", phrase: /\bhops\b/i, say: "short legs, or short trips" },
  { name: "stints", phrase: /\bstints?\b/i, say: "separate times" },
  { name: "takeoffs in freezing weather", phrase: /\btakeoffs? in freezing\b/i, say: "takeoffs where you'd likely de-ice" },
  { name: "compact schedule", phrase: /\bcompact,? (?:\w+[- ])?schedule\b/i, say: "fewer days off" },
  // The owner's call (Nov 2026), after the ex-pilot: pilots rank lines rather than throw them out, and a limit sinks a line.
  { name: "dealbreaker", phrase: /\bdeal[- ]?breakers?\b/i, say: "a limit that puts a line at the bottom of their list" },
  // App wording the owner couldn't follow (Nov 2026): "4 layovers with no real night", "no duties through the night but
  // 20.8 hours on the backside of the clock".
  { name: "no real night", phrase: /\b(?:no|without a|with a) real night\b|\breal nights?\b(?! ?'s sleep)/i, say: "layovers where you'd have to sleep in the daytime (or a night's sleep on every layover)" },
  { name: "duties through the night", phrase: /\bdut(?:y|ies) through the night\b/i, say: "all-night duties" },
  { name: "landings for currency", phrase: /\bproficiency\b|\bcurrency comfort\b|\bfor currency\b/i, say: "more landings" },
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

/** The word list, for a prompt: the pack's words, then the ex-pilot's, each with what it means, then the phrases never to use. */
export function pilotWordsForPrompt(): string {
  const list = (words: PilotWord[]) => words.map((w) => `- ${w.term}${w.alsoSaid?.length ? ` (also "${w.alsoSaid.join('", "')}")` : ""}: ${w.means}`).join("\n");
  return `Talk about the work ONLY in these words. For anything they don't cover, say it in plain words built from them; never reach for another term of art, however common it is in aviation.
The bid pack's words, as it prints them:\n${list(PACK_WORDS)}\nThe words pilots use (a FedEx captain who commuted from San Diego):\n${list(EX_PILOT_WORDS)}\n${neverSayForPrompt()}\nName the domicile by its city, as the pack brief gives it ("Memphis"); say "domicile" only where no city is known. Block is flying time, never days at home. A departure is leaving home, never a flight taking off. A trip doesn't "join from" a city: it starts with a front-end deadhead from there. Say what the layovers are like ("time in cities you like"), not their "value".`;
}

/** The banned words and what to say instead, for a prompt — on their own, for a short call that doesn't need the whole list. */
export function neverSayForPrompt(): string {
  const avoided = AVOIDED.map((a) => `- "${a.name}": say ${a.say}`).join("\n");
  return `Never say these, unless this pilot used the word first in their own answers — and then only as they meant it:\n${avoided}`;
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
