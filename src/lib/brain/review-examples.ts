/**
 * The owner's own calls on interview questions (Nov 2026): the ones he flagged as clunky or wrong, in his words, and
 * the ones he approved. The second reader (`question-review.ts`) learns from them the way the interviewer learns from
 * the ex-pilot's interview; the rest of the test set (scripts/eval/question-review-set.json) is held out to measure it.
 */
export const SEND_BACK: { question: string; why: string }[] = [
  {
    "question": "You said you want big blocks of days off. How many nights at home in a row make a big block?",
    "why": "Their phrase repeated back awkwardly"
  },
  {
    "question": "You said the more you can avoid Memphis the better. What is it about a Memphis start or finish that bothers you most?",
    "why": "Vague \"what is it about\""
  },
  {
    "question": "You said 14 days off or so, and more is nice. Where do extra days off stop mattering to you?",
    "why": "Every pilot wants more days off"
  },
  {
    "question": "Which line would you bid higher: 2035 or 2068? — help text: 2035: 16 days off, no duties through the night, 20.8 hours on the backside of the clock, 4 layovers with no real night, 75.7 credit. 2068: 13 days off, duties through the night one at a time, 11.3 hours on the backside of the clock, 2 layovers with no real night, 79.5 credit.",
    "why": "A list of figures no pilot can follow; contradictory-looking"
  },
  {
    "question": "Which trip would you rather fly: #79 on Oct 11 or #50 on Oct 22? — help text: #79 is 11 days with 138 hours in cities you like, 3 full days, and a body clock score of 31. #50 is 3 days with a deadhead out to Honolulu, a body clock score of 88 and 10.6 credit hours a day.",
    "why": "\"3 full days\" of what; measurements"
  },
  {
    "question": "Which line would you bid higher: 2011 or 2052? — help text: 2011 has 15 days off, 78.5 credit and only 5.1 hours after midnight, but carries 2 duty periods over 12 hours. 2052 has 14 days off, 72.6 credit and 15.4 hours after midnight, with no long duty periods.",
    "why": "\"5.1 hours after midnight\" makes no sense"
  },
  {
    "question": "Line 1005 has 175 hours in cities you like, but its 11-day trip starts and ends with deadheads through SFO and PHX. Would you take a trip like that over one with weaker layovers but ends you can shorten from the Pacific, and what would tip it?",
    "why": "Confusing; several asks"
  },
  {
    "question": "How much does having one long trip and one short trip in a line matter next to layovers and days off?",
    "why": "Weighs several things at once"
  },
  {
    "question": "What's the earliest show in Anchorage that still lets you come up from Seattle the same day?",
    "why": "The pack answers it"
  },
  {
    "question": "If your planned flight fills up, how many other flights would you want that still get you there in time?",
    "why": "Unnecessary"
  },
  {
    "question": "How many departures in a month before it starts to bother you? — help text: For example, line 1005 has just one trip. Line 1055 has five trips, each one a separate departure from Anchorage.",
    "why": "Names a line it doesn't show"
  },
  {
    "question": "Is line 1030 in the right spot at #30 on your list?",
    "why": "Pointless: the list isn't finished"
  },
  {
    "question": "Is there anything that rules a line out, no matter how good the rest of it is?",
    "why": "Pilots rank lines rather than rule them out"
  },
  {
    "question": "On a trip that starts with a deadhead from the West Coast, how much does catching it from LAX change how much you like the trip?",
    "why": "Have to read it twice"
  },
  {
    "question": "On a layover, how many full days free in a city you like would make a line clearly better for you? (options: One is plenty / Two or more is what really lifts a line / It barely changes how I rank a line)",
    "why": "Leans toward \"enough\""
  },
  {
    "question": "Some lines have days of hotel standby on a trip. How do you feel about those? — help text: Standby days away from Memphis are paid, on call at a hotel the company provides, with no flying. Line 1004's long trip is an example of the kind of line you've been weighing. (options: I like them / I don't mind them / I'd rather fly)",
    "why": "Vague pointer to a line"
  }
];

export const PASS: string[] = [
  "Which line would you bid higher: 1013 or 1011? — help text: 1013 has 4 departures, but it's much easier on the body clock and has 3 trips that start with a deadhead from home. 1011 has just 2 departures, more time in cities you like and better pay for the days away from home, but it's hard on the body clock.",
  "Which line would you bid higher: 1026 or 1014? — help text: 1026 has 2 departures and is easier on the body clock, but no time in cities you like. 1014 has 4 departures, more time in cities you like (Seattle, Phoenix) and 2 full days off in them.",
  "Which line would you bid higher: 1010 or 1025? — help text: 1010 is two trips with Honolulu layovers and two front-end deadheads, but it's harder on the body clock. 1025 is six trips to Toronto, easier on the body clock, with no time in cities you love.",
  "Which trip would you rather fly: #1 on Oct 2 or #52 on Oct 3? — help text: #1 is a 3-day trip that starts and ends with a deadhead, so no Memphis night and easier on the body clock. #52 is a 7-day trip with Honolulu layovers.",
  "You have no crash pad in Memphis: which Memphis hotel night bothers you more? — help text: Either the night before an early show you can't commute in for, or a night waiting in Memphis between trips that chain into one departure. (options: The night before an early show / Waiting in Memphis between chained trips / Both bother me about the same / Neither bothers me much)",
  "You mentioned being home Wednesday nights and Sunday mornings. Is that a standing commitment, or just nice when it happens? (options: A standing commitment I plan around / Nice to have, a tiebreaker only / Doesn't matter for this month)",
  "When a line has a lot of two-leg duty periods, does it change how high you'd bid it? — help text: Line 1015 has no extra legs at all; line 1019 has three extra legs, where a duty period has a second leg. (options: It's a big mark against the line / A small mark, a tiebreaker / It doesn't change my bid)",
  "Some lines have long stretches of hotel standby. How do you feel about hotel standby days? (options: I like them / I don't mind them / I'd rather fly)",
  "You said you're not a fan of IND trips. Is it the Indianapolis layover, or the flying on those trips? (options: The layover / The flying / Both)",
  "Does a 3 or 4 am report cost you sleep even when the flying after it is in the daytime? (options: Yes, an early report hurts my sleep by itself / Only when the flying runs into the night / Not really, if the flying is daytime)",
  "When commuting in, how much time would you like to leave before your report?",
  "You said you prefer multiple days off in a row. How many nights at home would that be?"
];
