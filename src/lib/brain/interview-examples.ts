/**
 * What the interviewer learns from: the ex-pilot's real questions and answers (Oct 15 and Oct 21, 2026), the ones
 * that taught the app the most and the ones he couldn't answer, plus questions written the same way for a different
 * pilot. The owner reviewed this set (Nov 11, 2026) after AI-written questions kept weighing several things at once,
 * asking what the app already knows, and showing lines that didn't fit. Worked examples, not more rules: four times the
 * ex-pilot answered a question in the abstract with "show me real lines or trips", and his best answers came from real
 * choices and from questions about his own words.
 */

export type QuestionKind = "real-choice" | "their-words" | "feature" | "their-number";

export const QUESTION_KINDS: { kind: QuestionKind; when: string; rule: string }[] = [
  {
    kind: "real-choice",
    when: "To weigh their priorities against each other. About every other question.",
    rule: "Two real lines (an offered line pair) or two real trips (an offered trip pair) from their pack, shown in full, that differ on what's being weighed; ask which they'd bid higher, or rather fly. Never a trade asked in words.",
  },
  {
    kind: "their-words",
    when: "They said something whose meaning would change their ranking.",
    rule: "Say back what they meant in your own plain words, the way one pilot would to another (\"You said you prefer several days off in a row\"), never their phrase repeated clumsily; put their exact words in theirWords, for the app's check only. Ask one concrete thing, and offer the two or three likely answers as options when you can — never \"What is it about…?\".",
  },
  {
    kind: "feature",
    when: "Something in their top lines they haven't mentioned, that varies a lot between those lines.",
    rule: "Name it the way the pack and pilots do, show a line or trip that has it, and ask how they feel about it.",
  },
  {
    kind: "their-number",
    when: "A number only they know, about their own life, that would move their list.",
    rule: "Once per topic. Never one the app works out (commute times, flights home, what counts as a departure).",
  },
];

/** His questions that worked: what was asked, how he answered, and what it taught. */
export const WORKED: { question: string; kind: QuestionKind; answer: string; taught: string }[] = [
  {
    question: "1010 or 1016: which goes higher on your bid?",
    kind: "real-choice",
    answer: "\"Not even close.\" 1010: a double deadhead and a long Honolulu layover. 1016: eight times to and from Memphis, \"never more than a couple or three days at home between trips\".",
    taught: "Departures and Memphis commutes outweigh layovers in cities he loves.",
  },
  {
    question: "1039 or 1033?",
    kind: "real-choice",
    answer: "1033, easily: it's 3 departures, not 7 trips; 1039 is weeks of night hub turns in Indianapolis, \"pretty onerous work\".",
    taught: "How he counts departures, and night hub turns as a feature. The app's own comparison had favoured the other line.",
  },
  {
    question: "How many days in a row at home before it feels like a real break?",
    kind: "their-number",
    answer: "\"Three or four days\", so ideally 2, maybe 3, departures in a four-week bid month.",
    taught: "His real-break number and his departure number, in one answer.",
  },
  {
    question: "Line 1016: would you count it as 5 departures, or did those still feel like separate trips?",
    kind: "their-words",
    answer: "\"Definitely 5.\"",
    taught: "Trips chained back to back are one departure.",
  },
  {
    question: "When are two departures really two? 12 hours in Memphis, 24, 36, more?",
    kind: "their-words",
    answer: "He'd go home with 24 hours at home, \"for sure\" with 48.",
    taught: "Where one departure becomes two.",
  },
  {
    question: "How many waking hours make a layover feel like \"a full day\" in a city?",
    kind: "their-words",
    answer: "Land one day, a full night's sleep, all day free, a second full night, up no earlier than 6 am.",
    taught: "What a full day on a layover means to him.",
  },
  {
    question: "Which months do you mean by \"the dead of winter\" and \"mid-summer\"?",
    kind: "their-words",
    answer: "Forecasts in the 30s °F (December to March in ANC, BOS, EWR); 100 °F and up in Phoenix. And de-icing is \"a huge pain\".",
    taught: "His seasons, and de-icing as a feature.",
  },
  {
    question: "1041 or 1035?",
    kind: "real-choice",
    answer: "1035 easily: 2 of its 3 departures are double deadheads, and he'd drop the small third trip. \"Both of those lines are really not good though!\"",
    taught: "What a hub turn is, and that he'd drop a small trip.",
  },
  {
    question: "Which trip would you rather fly, #50 or #104?",
    kind: "real-choice",
    answer: "\"50, not even close! West coast double deadhead! HNL layover! One-leg trip!\" 104 means commuting to Memphis, and four days thinking about work for 12 hours of pay.",
    taught: "Commuting, pay per day away from home, work per trip and layovers, all at once.",
  },
];

/** His questions that didn't work, and why, in his words. */
export const DIDNT: { question: string; why: string }[] = [
  {
    question: "Say a trip joins from LAX or the Pacific and you can shorten it, but the layovers are ordinary. How much of your layover value would you give up to take it?",
    why: "\"Hard to say in a generic way… it would be way more helpful for both of us if you gave me actual trips to choose between.\" The words were wrong too: it's a front-end deadhead to LAX, not \"joins from\".",
  },
  {
    question: "How much does the body clock weigh against layovers? Would you give up a Honolulu-type layover to avoid a couple weeks of back-to-back night flying?",
    why: "\"Really hard to give you a generic answer.\" And the line builders don't put a nice Honolulu trip and night hub turns on the same line, so the choice doesn't exist.",
  },
  {
    question: "How bad is a Memphis hotel night compared with a whole extra departure?",
    why: "\"I could give you a better answer if I had specific examples to choose between.\"",
  },
  {
    question: "One long Pacific trip of 10 days, or two 5-day trips with 3 days at home between?",
    why: "\"Very trip dependent! Show me two lines to compare and I'll tell you.\"",
  },
  {
    question: "Is there anything that rules a line out, no matter how good the rest of it is?",
    why: "\"I tend to think in terms of rank-ordering the lines rather than filtering out lines.\" The reply then called his number a firm cap, which he never said.",
  },
  {
    question: "How many days in a row at home before it feels like a real break, and how much does that matter next to your layovers?",
    why: "He answered the first half and skipped the second: two asks in one.",
  },
];

/** The same style for a different pilot: a 777 first officer in Anchorage who commutes from Seattle. */
export const ANOTHER_PILOT: { story: string; questions: { kind: QuestionKind; question: string; shown: string; why: string }[]; notToAsk: string[] } = {
  story:
    "Fewest trips possible, because every trip is two commute days; a report after noon so he can come up the same day; back before 10 pm; big blocks off; Asia cities don't matter much; not a fan of IND trips; credit secondary.",
  questions: [
    {
      kind: "feature",
      question: "Lines 2001 to 2008 are one 13-day trip with 11 days of hotel standby in Anchorage. How do you feel about hotel standby?",
      shown: "Line 2001",
      why: "8 of his top 10 were these lines and he never mentioned standby: his answer decides most of his top 10.",
    },
    {
      kind: "real-choice",
      question: "Which line would you bid higher: 2014 or 2020?",
      shown: "Both lines in full. 2014: one 13-day trip, 9:50 pm show, 83.5 credit. 2020: two trips, one starting with a deadhead from Seattle, an 8:58 am show, 16 nights at home in a row.",
      why: "Weighs fewest departures against a late show, a long stretch at home and credit, all at once.",
    },
    {
      kind: "their-words",
      question: "You said you're not a fan of IND trips. Is it the Indianapolis layover, or the flying on those trips? (Options: The layover / The flying / Both)",
      shown: "Trip #97, Anchorage to Osaka to Indianapolis, 5 days",
      why: "Tells the app whether to mark down the city or the kind of flying.",
    },
    {
      kind: "their-words",
      question: "You said you prefer several days off in a row. How many nights at home would that be?",
      shown: "Lines 2021 (15 nights in a row) and 2018 (9)",
      why: "Where a real stretch at home starts, for every line in the pack.",
    },
    {
      kind: "their-number",
      question: "Every trip costs you two commute days. How many departures in a month is ideal?",
      shown: "Lines 2017 (1 departure) and 2076 (4)",
      why: "Where departures start to cost him.",
    },
  ],
  notToAsk: [
    "\"You said you want big blocks of days off. How many nights at home in a row make a big block?\" Their phrase repeated back reads like a form; say it the way a pilot would.",
    "\"What is it about a Memphis start or finish that bothers you most?\" Vague, and it makes them do the work: offer the likely answers (\"the commute in, or the hotel night before an early show?\").",
    "\"Where do extra days off stop mattering to you?\" Every pilot wants more days off; what's worth knowing is what they'd give up for them, so ask it as a real choice between a line with more days off and one better on something else.",
    "\"What's the earliest show you can still come up for the same day?\" The app works it out from his home airport, his time before a report and real flights.",
    "\"How much credit would you give up to cut one departure?\" A trade in words; the line choice asks it with real lines.",
    "\"How many other flights would you want?\" The owner called it unnecessary.",
  ],
};

/** The set as the interviewer reads it. */
export function workedExamplesForPrompt(): string {
  return [
    "THE FOUR KINDS OF QUESTION (set questionKind):",
    ...QUESTION_KINDS.map((k) => `- ${k.kind}: ${k.when} ${k.rule}`),
    "",
    "WHAT WORKED WITH A REAL PILOT (an ex-FedEx MD-11 captain who commuted from San Diego to Memphis):",
    ...WORKED.map((w) => `- [${w.kind}] "${w.question}" → ${w.answer} Taught: ${w.taught}`),
    "",
    "WHAT DIDN'T WORK WITH HIM, AND WHY:",
    ...DIDNT.map((d) => `- "${d.question}" → ${d.why}`),
    "",
    `THE SAME STYLE FOR A DIFFERENT PILOT (777 first officer in Anchorage, commutes from Seattle. ${ANOTHER_PILOT.story}):`,
    ...ANOTHER_PILOT.questions.map((q) => `- [${q.kind}] "${q.question}" Shown: ${q.shown}. Why: ${q.why}`),
    "Not to ask him:",
    ...ANOTHER_PILOT.notToAsk.map((n) => `- ${n}`),
  ].join("\n");
}
