import { existsSync, readFileSync } from "node:fs";
import type { InterviewExchange } from "@/lib/brain/build-model";
import type { PilotModel } from "@/types/pilot-model";
import { EXPILOT_MODEL } from "./expilot-model";

/**
 * Pilots to test with. The first is real — the ex-pilot's own opening
 * answer, word for word. The rest are written to cover the range of how
 * pilots bid (local and commuting, senior and junior, pay and lifestyle,
 * body clock and family), each on a real October pack.
 */
export interface EvalPersona {
  id: string;
  pack: string;
  isCommuter: boolean;
  commuteFrom: string | null;
  /** Who they are, for the judge. */
  context: string;
  /** Their answer to the opening "walk us through how you bid" question. */
  story: string;
  /** A hand-written pilot model from their words, when there is one (to test scoring v2 on its own). */
  referenceModel?: PilotModel;
  /** The rest of a real interview after the story, when there is one. */
  followUps?: InterviewExchange[];
  /** The pilot's own verdicts on specific lines (real ground truth, from a readback). */
  lineLabels?: Record<string, "top" | "fine" | "never">;
}

/** What the interview knows about a simulated pilot before they answer anything — the app's pilot context, for their pack. */
export function simPilotContext(p: Pick<EvalPersona, "isCommuter" | "commuteFrom">, pack: { aircraft: string; seat: string; base: string; month: string; lines: unknown[] }): string {
  const home = p.commuteFrom;
  return `${pack.aircraft} ${pack.seat === "CAP" ? "captain" : "first officer"} based in ${pack.base} (${pack.month} bid pack, ${pack.lines.length} lines). ${p.isCommuter ? `Commutes to base${home ? ` from ${home}` : ""}.` : "Lives in base."} FedEx lets pilots deviate from a scheduled deadhead and ride a different airline flight on their own to the same city.`;
}

export const OPENING_QUESTION = "Walk us through how you bid, start to finish, in your own words.";

/** Everything the pilot said: the story as turn 0, then any follow-up answers. */
export function exchangesOf(p: EvalPersona): InterviewExchange[] {
  return [{ turn: 0, question: OPENING_QUESTION, answer: p.story }, ...(p.followUps ?? [])];
}

/** The same, as one block of text for the judge. */
export function pilotWordsOf(p: EvalPersona): string {
  if (!p.followUps?.length) return p.story;
  return exchangesOf(p)
    .map((e) => `Q${e.turn}: ${e.question}\nA: ${e.answer}`)
    .join("\n\n");
}

/**
 * The ex-pilot's real interview from Oct 7 2026 (21 questions after his story), saved from his profile into the
 * gitignored eval cache — his own words stay out of the repository.
 */
const REAL_INTERVIEW = ".cache/eval/expilot-real-interview.json";
function realFollowUps(): InterviewExchange[] | null {
  if (!existsSync(REAL_INTERVIEW)) return null;
  const turns = JSON.parse(readFileSync(REAL_INTERVIEW, "utf8")) as { turn: number; question: string; kind: string; answer: string }[];
  return turns.filter((t) => t.kind !== "skipped" && t.answer.trim()).map((t) => ({ turn: t.turn, question: t.question, answer: t.answer }));
}

/**
 * The ex-pilot collaborator's own data (his opening story, where he lives, his real interview and readback) is
 * kept in the gitignored eval cache, never in this public repository. Without it, his personas are simply absent.
 */
const EXPILOT_FILE = ".cache/eval/expilot-persona.json";
const expilot = existsSync(EXPILOT_FILE) ? (JSON.parse(readFileSync(EXPILOT_FILE, "utf8")) as { story: string; context: string; commuteFrom: string; pack: string }) : null;

const followUps = realFollowUps();

/** His answers to the readback of the brain's model (Oct 10 2026): corrections, answers to its questions, and verdicts on 15 lines. */
const READBACK = ".cache/eval/expilot-readback.json";
const readback = existsSync(READBACK)
  ? (JSON.parse(readFileSync(READBACK, "utf8")) as { lineLabels: Record<string, "top" | "fine" | "never">; lineNotes?: Record<string, string>; exchanges: { question: string; answer: string }[] })
  : null;

export const PERSONAS: EvalPersona[] = [
  ...(expilot
    ? [
        { id: "expilot", pack: expilot.pack, isCommuter: true, commuteFrom: expilot.commuteFrom, context: expilot.context, story: expilot.story, referenceModel: EXPILOT_MODEL ?? undefined },
        ...(followUps
          ? [
              {
                id: "expilot-full",
                pack: expilot.pack,
                isCommuter: true,
                commuteFrom: expilot.commuteFrom,
                context: `${expilot.context} This is his real interview: his opening story, then every follow-up question he answered.`,
                story: expilot.story,
                followUps,
              },
              ...(readback
                ? [
                    {
                      id: "expilot-readback",
                      pack: expilot.pack,
                      isCommuter: true,
                      commuteFrom: expilot.commuteFrom,
                      context: `${expilot.context} This is his real interview — his opening story, every follow-up he answered, then his corrections when the system read his priorities back to him.`,
                      story: expilot.story,
                      followUps: [
                        ...followUps,
                        ...readback.exchanges.map((e, i) => ({ turn: followUps.length + 1 + i, question: e.question, answer: e.answer })),
                        // Why he said he'd never bid the lines he rejected, in his own words — without which line numbers, so his
                        // verdicts stay a test the simulated pilot can't see.
                        ...[...new Set(Object.entries(readback.lineNotes ?? {}).filter(([l]) => readback.lineLabels[l] === "never").map(([, n]) => n))].map((n, i) => ({
                          turn: followUps.length + readback.exchanges.length + 1 + i,
                          question: "Readback: you marked some lines as ones you'd never bid. What rules them out?",
                          answer: n,
                        })),
                      ],
                      lineLabels: readback.lineLabels,
                    },
                  ]
                : []),
            ]
          : []),
      ]
    : []),
  {
    id: "ind-local-family",
    pack: "OCT26-IND-B767-FO",
    isCommuter: false,
    commuteFrom: null,
    context: "B767 first officer based in Indianapolis (IND), lives 25 minutes from the airport. Mid-seniority, two young kids.",
    story: `I live in Indy so no commute, which is the whole reason I'm on the 767 here. Two kids under eight so everything is about being home. Weekends are the big one, my wife works Monday to Friday and Saturdays are soccer, so I want as many Saturdays and Sundays off as I can get. I'd rather have shorter trips, 2 or 3 days, than a 5 day trip even if it pays more. A 4 day is OK once in a while. I like my days off in a couple of big chunks instead of scattered singles, a single day off between trips is useless to me. I don't care much about where I lay over, it's all the same hotels, but I don't love the long sits in random places, I'd rather be working and get home. Pay matters less than time at home, but I don't want to be the lowest credit line either, somewhere in the middle is fine. Back to back all nighters wreck me for the first day home and then I'm useless with the kids, so I try to avoid lines that end trips with a red-eye into Indy at 5 am. Early sign ins are fine. Holidays don't matter this month.`,
  },
  {
    id: "mem-md11-paymax",
    pack: "OCT26-MEM-MD11-CAP",
    isCommuter: false,
    commuteFrom: null,
    context: "MD-11 captain based in Memphis (MEM), lives locally. Senior, kids grown, three years from retirement.",
    story: `Senior guy, couple years left, and I'm maximizing pay. Simple as that. Top credit lines first. I'll fly every day of the month if it pays. I like the international flying, Europe especially, Cologne and Paris and Liege are great layovers, I'll take long trips no problem, 10 or 12 days is fine. What I don't want is junk pay, lines that keep you away forever for nothing. Credit per day matters to me, if two lines pay the same I want the one that has me gone less. Asia is fine too. I don't care about weekends. I don't do reserve. I hate short layovers where you get to the hotel and turn around 12 hours later, give me at least a day. That's about it.`,
  },
  {
    id: "mem-757-bodyclock",
    pack: "OCT26-MEM-B757-FO",
    isCommuter: false,
    commuteFrom: null,
    context: "B757 first officer based in Memphis (MEM), lives locally. Had sleep problems after years of night flying; a doctor told them to protect their sleep.",
    story: `For me it's all about sleep now. I had a rough couple of years with insomnia from the back side of the clock and my doc basically told me to protect my sleep or else. So the first thing I look at is how much night flying is in the line. Some is unavoidable at FedEx, I get it, but I will not bid back to back to back all-nighters anymore, two in a row is my absolute limit. I'd rather be on a day schedule, the day turns and the sorts that report in the afternoon are perfect. Long duty days kill me too, anything over 12 hours I try to stay away from. I don't mind more landings if it's daytime. Layovers I need real sleep, so a layover where I arrive at 6 am and leave at 8 pm is worthless, I need the nighttime in the hotel. Days off I want 14 or so, more is nice. Pay is secondary. I don't care about cities really, though I'd rather not do the Mexico trips.`,
  },
  {
    id: "anc-777fo-sea-commuter",
    pack: "OCT26-ANC-B777-FO",
    isCommuter: true,
    commuteFrom: "SEA",
    context: "B777 first officer based in Anchorage (ANC), commutes from Seattle (SEA). Junior on the 777.",
    story: `Commute from Seattle. Fewest trips possible, every trip is two commute days. I need the trip to report late enough that I can come up same day, after noon-ish, or I lose a day. Same thing at the end, if I land in ANC after 10 at night there's no way home and I'm stuck in the crash pad. Big blocks of days off. Don't care about the Asia cities much. Not a fan of IND trips. Max credit is nice but secondary.`,
  },
  {
    id: "mem-767cap-dfw-commuter",
    pack: "OCT26-MEM-B767-CAP",
    isCommuter: true,
    commuteFrom: "DFW",
    context: "B767 captain based in Memphis (MEM), commutes from Dallas–Fort Worth (DFW). Mid-seniority, about 11 years at FedEx.",
    story: `I commute from Dallas so the first thing I look at is how a trip starts and ends. If the first report is before about ten in the morning I have to come in the night before and pay for a hotel, so I want late first-day reports. Same on the back end, if I'm released after 8 or 9 at night I'm stuck in Memphis another night. Fewer trips means fewer commutes so I'd rather have three longer trips than six short ones. Money matters to me right now, kid starting college, so I want 80 plus credit hours if I can get it. I love the Europe flying, Paris and Cologne and Liege, good food, easy layovers. I don't love the long Asia trips out of Anchorage, they wreck me. The domestic night sort turns are fine as long as they're not five nights in a row. That's about it.`,
  },
  {
    id: "mem-777fo-junior-local",
    pack: "OCT26-MEM-B777-FO",
    isCommuter: false,
    commuteFrom: null,
    context: "B777 first officer based in Memphis (MEM), lives locally. Junior on the 777, single, no kids.",
    story: `Junior FO, single, live ten minutes from the airport, so I'm in it for the flying and the money. Max credit. I like the long international trips, especially Asia, Hong Kong, Taipei, Singapore are awesome layovers, I'll take a 10 day trip all day long. Days off don't matter much, 12 or 13 is fine. I don't want reserve or standby lines if I can help it, I want real trips. I'd rather avoid the short domestic turns, they pay nothing and you're always at work.`,
  },
  {
    id: "mem-a300-captain-dates",
    pack: "OCT26-MEM-A300-CAP",
    isCommuter: true,
    commuteFrom: "BNA",
    context: "A300 captain based in Memphis (MEM), lives in Nashville and drives in (about 3.5 hours). Mid-seniority.",
    story: `I drive in from Nashville, about three and a half hours each way, so I don't fly a commute but I do have to plan around that drive. I won't drive in for a 3 am report, so early reports at Memphis are a problem, I'd have to come in the night before. Same at the end, landing at 4 am and then driving three hours is dangerous, I try to avoid that. So I like trips that start in the afternoon or evening and end mid-morning or later. I prefer longer trips, 4 or 5 days, so I make the drive fewer times. Fewer trips is better. I'd like the 10th through the 13th off for my daughter's wedding, that's the one hard date this month. Overall I want around 15 days off and decent credit, nothing crazy. I like the layovers where I can get to a gym, the bigger cities like Newark and Ontario and Seattle. I don't love the A300 hub turns where you sit at a station for 8 hours at night with nowhere to sleep.`,
  },
];
