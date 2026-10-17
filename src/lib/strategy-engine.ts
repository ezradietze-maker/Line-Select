import type { AwardHistorySummary } from "@/lib/award-history";
import { forecastBid } from "@/lib/forecast/forecast";
import { tripStartUtc } from "@/lib/flights/needs";
import { formatHoursValue } from "@/lib/interview-config";
import { computeTripFacts } from "@/lib/metrics/trip-facts";
import type { LineScore } from "@/lib/scoring";
import type { BidPack, Line, Trip, VacationPeriod } from "@/types/bidpack";
import type {
  FeasibilityTier,
  SeniorityInput,
  Strategy,
  StrategyFact,
  StrategyFit,
  StrategyLineRecommendation,
} from "@/types/strategy";

/**
 * Bidding moves read from the pilot's own bid pack and where their seniority actually lands in it — not generic advice.
 *
 * The foundation is a fact every pack read so far bears out exactly: the pilots on the seniority list who don't carry
 * the PAY status are precisely as many as the pack's regular + secondary + reserve lines. So a pilot's real place this
 * month is their position among those bidders, and it falls into one of three bands — inside the regular lines, the
 * secondary lines, or reserve. Each move below says which band it's for and stands on the pack's own numbers.
 *
 * None of it is FedEx's rules: how secondary lines, reserve, vacation and carry-over actually work is set by the
 * contract and crew scheduling, and some of these moves may run into them. Every move says so, and none is a sure thing.
 */

const hm = (hours: number) => formatHoursValue(hours);
const pct = (p: number) => `${Math.round(p * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------- where the pilot stands

export type Band = "regular" | "secondary" | "reserve";

export interface Standing {
  /** The pilot's place on the printed list (1 = first to bid). */
  printedBidNumber: number;
  listSize: number;
  /** Pilots above them marked PAY — paid this month without bidding a line. Null when the pack's list has no status column read. */
  payAhead: number | null;
  /** Their place among pilots actually bidding a line this month. Null without the PAY flags. */
  effective: number | null;
  /** Pilots actually bidding a line this month. */
  bidders: number | null;
  regular: number;
  secondary: number;
  reserve: number;
  /** Which kind of line their place lands on, if everyone ahead bids as the pack's numbers suggest. */
  band: Band;
  /** Places inside the end of the regular lines (negative: past it). */
  marginToRegular: number;
  /** The pilot is themselves marked PAY this month. */
  selfPay: boolean;
  /** Their own vacation inside this bid month, from the pack's vacation schedule. */
  vacations: VacationPeriod[];
  vacationDays: number;
}

const DAY_MS = 86_400_000;

function periodBounds(bidPack: BidPack): [number, number] | null {
  if (!bidPack.bidPeriodStart) return null;
  const start = Date.parse(`${bidPack.bidPeriodStart}T00:00:00Z`);
  return [start, start + bidPack.bidPeriodDays * DAY_MS];
}

function overlapDays(v: VacationPeriod, [from, to]: [number, number]): number {
  const a = Math.max(from, Date.parse(v.from));
  const b = Math.min(to, Date.parse(v.to));
  return b > a ? Math.round((b - a) / DAY_MS) : 0;
}

export function computeStanding(bidPack: BidPack, seniority: SeniorityInput): Standing {
  const list = bidPack.seniorityList ?? [];
  const hasPay = list.some((e) => e.pay);
  const me = list.find((e) => e.bidNumber === seniority.rank);
  const payAhead = hasPay ? list.filter((e) => e.pay && e.bidNumber < seniority.rank).length : null;
  const effective = payAhead !== null ? seniority.rank - payAhead : null;
  const regular = bidPack.info?.totalRegularLines ?? bidPack.lines.length;
  const secondary = bidPack.info?.totalSecondaryLines ?? 0;
  const reserve = bidPack.info?.totalReserveLines ?? 0;
  const position = effective ?? seniority.rank;
  const band: Band = position <= regular ? "regular" : position <= regular + secondary ? "secondary" : "reserve";
  const bounds = periodBounds(bidPack);
  const vacations = bounds ? (me?.vacations ?? []).filter((v) => overlapDays(v, bounds) > 0) : [];
  return {
    printedBidNumber: seniority.rank,
    listSize: seniority.totalPilots,
    payAhead,
    effective,
    bidders: hasPay ? list.filter((e) => !e.pay).length : null,
    regular,
    secondary,
    reserve,
    band,
    marginToRegular: regular - position,
    selfPay: !!me?.pay,
    vacations,
    vacationDays: bounds ? vacations.reduce((s, v) => s + overlapDays(v, bounds), 0) : 0,
  };
}

// ---------------------------------------------------------------- line helpers

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** What makes a line less wanted than the pack's middle line — the reasons senior pilots tend to pass on it. */
function whyPassedOver(line: Line, pack: { credit: number; daysOff: number; trips: number }): string {
  const reasons: string[] = [];
  if (line.totalCreditHours < pack.credit - 0.5) reasons.push(`${hm(pack.credit - line.totalCreditHours)} less credit than the middle line`);
  if (line.daysOff < pack.daysOff) reasons.push(`${plural(pack.daysOff - line.daysOff, "fewer day")} off`);
  if (line.trips.length > pack.trips) reasons.push(`${line.trips.length} trips where most lines have ${pack.trips}`);
  return reasons.length ? `Senior pilots tend to pass on it: ${reasons.slice(0, 2).join(", ")}.` : "Nothing about it stands out — it's simply further down most pilots' lists.";
}

function tierOf(p: number): FeasibilityTier {
  return p >= 0.7 ? "strong" : p >= 0.4 ? "possible" : "longshot";
}

function rec(line: Line, headline: string, detail: string, p: number | null, note: string): StrategyLineRecommendation {
  return {
    lineNumber: line.lineNumber,
    headline,
    detail,
    daysOff: line.daysOff,
    totalCreditHours: line.totalCreditHours,
    totalTafbHours: line.totalTafbHours,
    feasibility: p === null ? "possible" : tierOf(p),
    feasibilityNote: note,
    feasibilitySource: "heuristic",
    scoreContext: null,
  };
}

/** A trip's span in absolute time, for checking it against a vacation. */
function tripSpan(bidPack: BidPack, trip: Trip): [number, number] | null {
  const start = tripStartUtc(bidPack, trip);
  if (start === null) return null;
  const f = computeTripFacts(trip);
  const end = Math.max(0, ...f.duties.map((d) => d.end), ...f.layovers.map((l) => l.end));
  return [start, start + end * 60_000];
}

/** "0428" and "428" are the same flight: digits only, no leading zeros. */
const flightKey = (n: string) => String(Number(n.replace(/\D/g, "")) || n);

/** Operated legs on a line that fly a flight the pack lists as a sweep aircraft. */
function sweepLegs(line: Line, sweep: Set<string>): number {
  let n = 0;
  for (const t of line.trips) for (const l of computeTripFacts(t).operatedLegs) if (sweep.has(`${flightKey(l.flightNumber)}|${l.from}`)) n++;
  return n;
}

// ---------------------------------------------------------------- the moves

const FIT_ORDER: Record<StrategyFit, number> = { now: 0, maybe: 1, later: 2 };

export interface StrategyOptions {
  /** The pilot's own line scores, best first (absent before an interview) — used to order a move's lines by what they'd actually want. */
  lineScores?: LineScore[] | null;
  isCommuter?: boolean | null;
  /** Chance each line is still open at the pilot's turn, by line id. Worked out here from the pack's seniority list when not given. */
  pAvailable?: Record<string, number> | null;
}

/**
 * Every move, in the order that matters for this pilot this month: the ones that apply now first. `awardSummary` is
 * accepted for the board's real hold reports; it doesn't change which moves apply.
 */
export function generateStrategies(
  bidPack: BidPack,
  seniority: SeniorityInput,
  _awardSummary?: AwardHistorySummary | null,
  options: StrategyOptions = {}
): Strategy[] {
  const st = computeStanding(bidPack, seniority);
  const info = bidPack.info;
  const lines = bidPack.lines;
  const position = st.effective ?? st.printedBidNumber;
  const scoreOf = new Map((options.lineScores ?? []).map((r) => [r.line.lineNumber, r.score]));
  const hasScores = scoreOf.size > 0;
  const pack = {
    credit: median(lines.map((l) => l.totalCreditHours)),
    daysOff: Math.round(median(lines.map((l) => l.daysOff))),
    trips: Math.round(median(lines.map((l) => l.trips.length))),
  };

  // Chance each line is still there at the pilot's turn — the same simulation the line cards' "% open" uses.
  const pAvail: Record<string, number> = options.pAvailable ?? {};
  if (!options.pAvailable) {
    const me = bidPack.seniorityList?.find((e) => e.bidNumber === seniority.rank);
    const f = me ? forecastBid({ bidPack, seniorityNumber: me.seniority, myRanking: lines.map((l) => l.id), simulations: 300 }) : null;
    if (f) for (const [id, lf] of Object.entries(f.lines)) pAvail[id] = lf.pAvailable;
  }
  const hasForecast = Object.keys(pAvail).length > 0;
  const openAt = (l: Line) => pAvail[l.id] ?? null;

  const where =
    st.effective !== null
      ? `#${st.effective} of the ${st.bidders} pilots actually bidding a line`
      : `#${st.printedBidNumber} on the list`;
  const strategies: Strategy[] = [];

  // ---- Your real number ----
  {
    const facts: StrategyFact[] = [
      { label: "Your number on the printed list", value: `#${st.printedBidNumber} of ${st.listSize}` },
      ...(st.payAhead !== null ? [{ label: "Pilots above you marked PAY (not bidding a line)", value: String(st.payAhead), tone: "good" as const }] : []),
      ...(st.effective !== null ? [{ label: "Your place among pilots bidding a line", value: `#${st.effective} of ${st.bidders}`, tone: "good" as const }] : []),
      { label: "Regular lines", value: `#1–${st.regular}` },
      ...(st.secondary ? [{ label: "Secondary lines", value: `#${st.regular + 1}–${st.regular + st.secondary}` }] : []),
      ...(st.reserve ? [{ label: "Reserve lines", value: `#${st.regular + st.secondary + 1}–${st.regular + st.secondary + st.reserve}` }] : []),
    ];
    const bandLine =
      st.band === "regular"
        ? `You're ${plural(st.marginToRegular, "place")} inside the last regular line.`
        : st.band === "secondary"
          ? `You're ${plural(-st.marginToRegular, "place")} past the last regular line — inside the secondary lines.`
          : `You're past the regular and secondary lines — on the numbers, this month is reserve.`;
    strategies.push({
      id: "true-number",
      name: "Your real number this month",
      tagline: st.payAhead ? `${plural(st.payAhead, "pilot")} above you aren't bidding a line — you're really ${where}.` : "Count only the pilots who are actually bidding.",
      mechanism:
        "The seniority list prints every pilot in the seat, but not all of them bid a line every month. The ones whose status reads PAY are paid this month without taking a line — in every pack read so far, the pilots without it come to exactly the number of regular, secondary and reserve lines the pack builds. So your competition is only the non-PAY pilots above you, and your place among them is what decides which kind of line you get.",
      benefits: [],
      fit: "now",
      fitReason: st.selfPay ? "Your own entry is marked PAY this month — you may not be bidding a line at all." : bandLine,
      steps: [
        st.effective !== null ? `Read every line's odds against #${st.effective}, not #${st.printedBidNumber}.` : "Read every line's odds against your place on the list.",
        st.band === "regular"
          ? st.marginToRegular <= Math.max(5, Math.round(st.regular * 0.12))
            ? `You're near the cutoff: bid deep enough that the last regular lines are on your list — they're the ones still there at your number.`
            : `You're comfortably inside the regular lines: spend the top of your list on the lines you actually want.`
          : st.band === "secondary"
            ? `Still bid a full list of regular lines — a pilot above you bidding reserve by choice moves you up one — but plan your month around a secondary line (see "Aim for a secondary line").`
            : `Bid regular and secondary lines anyway, then plan around reserve: pick the reserve you'd rather hold (see "When reserve pays more than a line").`,
        "Check this again each month: who's marked PAY changes with vacations, training and leave, and your real number moves with it.",
      ],
      facts,
      risk: "That PAY means \"not bidding a line\" is read from the pack's own numbers matching exactly, not from FedEx's rules. Pilots above you can still choose reserve or secondary over a regular line, which moves the cutoffs in your favor; nothing moves them against you.",
      lines: [],
    });
  }

  // ---- The lines senior pilots leave behind ----
  {
    const likely = lines
      .filter((l) => (openAt(l) ?? 0) >= 0.5)
      .sort((a, b) => (hasScores ? (scoreOf.get(b.lineNumber) ?? 0) - (scoreOf.get(a.lineNumber) ?? 0) : (openAt(b) ?? 0) - (openAt(a) ?? 0)));
    // A senior pilot has nearly every line open — listing them says nothing; the move is for pilots the pack's favorites pass by.
    const recs = (st.band === "regular" && position <= st.regular * 0.35 ? [] : likely).slice(0, 6).map((l) => {
      const p = openAt(l)!;
      return rec(l, `About ${pct(p)} likely still open at your turn`, whyPassedOver(l, pack), p, "");
    });
    const openCount = lines.filter((l) => (openAt(l) ?? 0) >= 0.5).length;
    const fit: StrategyFit =
      !hasForecast ? "maybe" : st.band === "regular" && position > st.regular * 0.35 ? "now" : st.band === "secondary" && -st.marginToRegular <= 10 ? "maybe" : st.band === "regular" ? "later" : "later";
    strategies.push({
      id: "leftovers",
      name: "Bid the lines senior pilots leave behind",
      tagline: hasForecast ? `About ${plural(openCount, "regular line")} are likely still open at your number — put the best of them high on your list.` : "Rank the lines the pilots above you are least likely to take.",
      mechanism:
        "Pilots above you take the lines most pilots want: high credit, more days off, fewer trips. What's left at your turn is predictable — the lines with lower credit, fewer days off or a busier shape. Ranking your favorites from that leftover pool near the top of your list beats ranking twenty lines you'll never see; your reaches still go first, because seniority bidding never punishes aiming high.",
      benefits: [],
      fit,
      fitReason:
        fit === "now"
          ? `At ${where}, most of the pack's favorites go before your turn — the leftovers are your real choice.`
          : st.band === "regular"
            ? "You're senior enough that most lines are still open at your turn — this matters more as your number drops."
            : "Regular lines are mostly gone by your number; this is the move for a month you're nearer the cutoff.",
      steps: [
        "Put two or three reach lines first — the ones you'd love even if they're probably gone.",
        hasScores ? "Next, the lines below: likely still open at your number, best for you first." : "Next, the lines below: likely still open at your number. Take the interview and they'll be ordered by what you'd actually want.",
        "Then keep going: list every regular line you'd fly over reserve or secondary, so a surprise above you still lands on something you chose.",
      ],
      facts: [
        { label: "Regular lines likely open at your number", value: hasForecast ? `${openCount} of ${lines.length}` : "needs the pack's seniority list" },
        { label: "The pack's middle line", value: `${hm(pack.credit)} credit · ${pack.daysOff} days off · ${pack.trips} trips` },
        ...(hasForecast ? [{ label: "How the odds are worked out", value: "your pack's list, PAY pilots skipped" }] : []),
      ],
      risk: "The odds are a simulation of what a typical pilot above you would take, not their real bids — a pilot with unusual tastes can take your leftover. Nothing about this runs into FedEx's rules; it's only how you order your own list.",
      lines: recs,
    });
  }

  // ---- Aim for a secondary line ----
  if (st.secondary > 0) {
    const slot = position - st.regular;
    const fit: StrategyFit = st.band === "secondary" ? "now" : st.band === "regular" && st.marginToRegular <= 8 ? "maybe" : st.band === "reserve" ? "maybe" : "later";
    strategies.push({
      id: "secondary-play",
      name: "Aim for a secondary line",
      tagline: `${plural(st.secondary, "secondary line")} come out after the regular award — ${st.band === "secondary" ? `you're #${slot} in line for them` : "the line holders above you don't need them"}.`,
      mechanism:
        "Secondary lines are built after the regular award from the flying no regular line covered, and released on the pack calendar's \"Secondary Lines Release\" day. Pilots who already hold a regular line don't need one, so the pool goes to the pilots below the regular cutoff, in seniority order — the lines senior pilots never had to want. For a pilot just past the cutoff, that's a real line instead of reserve.",
      benefits: [],
      fit,
      fitReason:
        st.band === "secondary"
          ? `Your place puts you #${slot} of ${st.secondary} for secondary lines — most of them will still be open at your turn.`
          : st.band === "regular" && st.marginToRegular <= 8
            ? `You're only ${plural(st.marginToRegular, "place")} inside the regular lines — a few pilots above you bidding differently and this becomes your month.`
            : st.band === "regular"
              ? "You'll hold a regular line this month — secondary lines are for the pilots past the cutoff."
              : `You're ${plural(position - st.regular - st.secondary, "place")} past the secondary lines — they'd reach you only if pilots above you choose reserve.`,
      steps: [
        "Bid your full regular list anyway — every pilot above you who goes reserve moves you up a place.",
        `Mark the "Secondary Lines Release" day on the pack calendar and be ready to bid the moment they're out.`,
        "Rank secondary lines the same way: what you'd fly over reserve, best first. Compare each against the reserve guarantee — a secondary line under it pays less than reserve would.",
        "If no secondary line suits you, staying on reserve is a choice, not a failure (see \"When reserve pays more than a line\").",
      ],
      facts: [
        { label: "Secondary lines this month", value: String(st.secondary) },
        { label: "Your place for them", value: st.band === "secondary" ? `#${slot} of ${st.secondary}` : st.band === "regular" ? "not needed if you hold a regular line" : `#${slot} — past the ${st.secondary}` },
        ...(info?.rlgHours ? [{ label: "Reserve guarantee to beat", value: hm(info.rlgHours) }] : []),
      ],
      risk: "How secondary lines are built, who may bid them and in what order are FedEx and contract rules this app doesn't have — confirm with your PSIT before counting on one. Their trips aren't in the pack, so they can't be previewed here.",
      lines: [],
      isProcessTip: true,
    });
  }

  // ---- When reserve pays more than a line ----
  if (info?.rlgHours) {
    const rlg = info.rlgHours;
    const under = lines.filter((l) => l.totalCreditHours < rlg).sort((a, b) => a.totalCreditHours - b.totalCreditHours);
    const likelyMine = lines.filter((l) => (openAt(l) ?? 0) >= 0.5);
    const likelyUnder = likelyMine.filter((l) => l.totalCreditHours < rlg);
    const fit: StrategyFit = st.band === "reserve" ? "now" : under.length && (st.band === "secondary" || (likelyMine.length > 0 && likelyUnder.length >= likelyMine.length / 2)) ? "now" : under.length ? "maybe" : "later";
    const counts = { "24hr": 0, a: 0, b: 0 };
    for (const r of bidPack.reserveLines ?? []) if (r.reserveType) counts[r.reserveType]++;
    const types = [counts["24hr"] && `${counts["24hr"]} R (24-hour)`, counts.a && `${counts.a} RA`, counts.b && `${counts.b} RB`].filter(Boolean).join(", ");
    strategies.push({
      id: "reserve-pays-more",
      name: "When reserve pays more than a line",
      tagline: under.length ? `${plural(under.length, "regular line")} in this pack pay less than the ${hm(rlg)} reserve guarantee.` : `The reserve guarantee is ${hm(rlg)} — every regular line pays more this month.`,
      mechanism: `Reserve pays its guarantee (${hm(rlg)} this month) whether or not you're called. The regular lines nobody senior wants are often the low-credit ones — and this month ${under.length ? `${plural(under.length, "line")} pay${under.length === 1 ? "s" : ""} less than that guarantee` : "none of them pays less"}. A pilot whose realistic line is one of those can bid reserve above it and be paid more for days that may never be flown.`,
      benefits: [],
      fit,
      fitReason:
        st.band === "reserve"
          ? "On the numbers you hold reserve this month — so pick the reserve you'd rather have."
          : fit === "now"
            ? "Many of the lines likely left at your number pay less than the reserve guarantee."
            : under.length
              ? "Worth knowing if your realistic lines are the low-credit ones."
              : "Every regular line beats the guarantee this month.",
      steps: [
        under.length ? `Find where the ${under.length} lines under ${hm(rlg)} sit on your list. Anything you'd rank below them, rank reserve above instead.` : "No regular line pays less than reserve this month, so reserve only wins on lifestyle.",
        info.reserveReportStatus
          ? `The pack's reserve report status is ${info.reserveReportStatus}${options.isCommuter ? " — if that's hours from a call to report, a commuter would need to be at base for every reserve day" : " — how quickly you must report after a call; check you can live with it"}.`
          : "Check the pack's reserve report status — how quickly you must report after a call — before you bid reserve.",
        types ? `Of the ${bidPack.reserveLines?.length} reserve lines (${types}), RA and RB are named apart from 24-hour R — usually a narrower call window for the same guarantee. Prefer them if you get the choice.` : "If you get a choice of reserve type, prefer the narrowest call window — the guarantee is the same.",
      ],
      facts: [
        { label: "Reserve line guarantee", value: hm(rlg), tone: "good" },
        ...(info.lowLineCreditHours ? [{ label: "Lowest-paying regular line", value: hm(info.lowLineCreditHours), tone: info.lowLineCreditHours < rlg ? ("warn" as const) : undefined }] : []),
        { label: "Regular lines under the guarantee", value: `${under.length} of ${lines.length}` },
        ...(info.rDayValueHours ? [{ label: "Credit per reserve day", value: hm(info.rDayValueHours) }] : []),
        ...(info.reserveReportStatus ? [{ label: "Reserve report status", value: info.reserveReportStatus }] : []),
        ...(st.reserve ? [{ label: "Reserve lines this month", value: String(st.reserve) }] : []),
      ],
      risk: "Being called out can fill a reserve month; the guarantee is a floor, not a promise of days at home. Whether you can bid reserve ahead of a regular line, and how reserve is assigned, are FedEx rules this app doesn't have.",
      lines: under.slice(0, 5).map((l) => rec(l, `${hm(l.totalCreditHours)} credit — ${hm(rlg - l.totalCreditHours)} under the reserve guarantee`, `${l.daysOff} days off · ${plural(l.trips.length, "trip")}.`, openAt(l), "A line that pays less than reserve would this month.")),
    });
  }

  // ---- Vacation under a line's biggest trips ----
  {
    const bounds = periodBounds(bidPack);
    const mine = st.vacations;
    const overlaps =
      mine.length && bounds
        ? lines
            .map((l) => {
              let credit = 0;
              // Each trip counts for the share of it that falls inside the vacation, not its whole credit.
              for (const t of l.trips) {
                const span = tripSpan(bidPack, t);
                if (!span || span[1] <= span[0]) continue;
                const inside = mine.reduce((sum, v) => sum + Math.max(0, Math.min(span[1], Date.parse(v.to)) - Math.max(span[0], Date.parse(v.from))), 0);
                credit += t.creditHours * Math.min(1, inside / (span[1] - span[0]));
              }
              return { l, credit };
            })
            .filter((x) => x.credit > 0)
            .sort((a, b) => b.credit - a.credit)
        : [];
    const fmtV = (v: VacationPeriod) => `${new Date(v.from).toUTCString().slice(5, 11)}–${new Date(v.to).toUTCString().slice(5, 11)}`;
    strategies.push({
      id: "vacation-overlap",
      name: "Put your vacation under a line's biggest trips",
      tagline: mine.length ? `Your ${plural(st.vacationDays, "vacation day")} this month (${mine.map(fmtV).join(", ")}) can sit on top of a line's heaviest flying.` : "Line up vacation with a line's heaviest week, not its days off.",
      mechanism:
        "Vacation that falls on days a line was going to be off is wasted on days you'd have had anyway. Vacation that falls on a line's trips takes those trips off the line in the vacation adjustment (the pack calendar's \"SWW Vac Adj\" window) — so a line whose biggest trips sit inside your vacation gives you the most time at home for the same vacation days.",
      benefits: [],
      fit: mine.length ? "now" : "later",
      fitReason: mine.length ? "The pack's vacation schedule shows you on vacation this month." : "The pack's vacation schedule has no vacation for you this month — this is for a month when it does.",
      steps: mine.length
        ? [
            `Your vacation: ${mine.map((v) => `${fmtV(v)} (${v.days} days)`).join(", ")}.`,
            "Favor the lines below — the most credit inside your vacation — over lines that are already off those days.",
            "After the award, put in the vacation adjustment in the SWW window so the overlapping trips come off.",
          ]
        : [
            "When you bid vacation, look at the weeks you'd most likely hold a heavy line, not the ones you'd be off anyway.",
            "Slot trades must be in no later than 30 days before the bid month (the pack's own info page), and a monthly vacation buyback exists if you'd rather have the pay.",
          ],
      facts: mine.length
        ? [
            { label: "Your vacation days in this bid month", value: String(st.vacationDays), tone: "good" },
            { label: "Lines with trips inside your vacation", value: `${overlaps.length} of ${lines.length}` },
          ]
        : [{ label: "Vacation slot trades", value: "30 days before the month" }],
      risk: "Whether trips under vacation are paid, dropped or rebuilt, and how the adjustment window works, are set by FedEx and the contract — this may not work the way it reads. Confirm with the vacation desk or your PSIT before bidding around it.",
      lines: overlaps.slice(0, 5).map(({ l, credit }) =>
        rec(l, `About ${hm(credit)} of trip credit falls inside your vacation`, `${l.daysOff} days off on the line before vacation · ${hm(l.totalCreditHours)} credit.`, openAt(l), openAt(l) !== null ? `About ${pct(openAt(l)!)} likely still open at your turn.` : "")
      ),
    });
  }

  // ---- Carry-over ----
  {
    const co = lines.filter((l) => (l.carryOverCreditHours ?? 0) > 0).sort((a, b) => (b.carryOverCreditHours ?? 0) - (a.carryOverCreditHours ?? 0));
    if (co.length) {
      strategies.push({
        id: "carry-over",
        name: "Start next month with credit in the bank",
        tagline: `${plural(co.length, "line")} end with a trip that runs past month-end — up to ${hm(co[0].carryOverCreditHours!)} of credit carried into next month.`,
        mechanism:
          "A trip that starts late in the month and finishes in the next counts its later part toward next month (the line's C/O). You start next month with that credit already flown, so a lighter line next month still makes your hours. For a pilot who wants next month's time off, a carry-over at the end of this one is the way to front-load it.",
        benefits: [],
        fit: "maybe",
        fitReason: "Useful when you already know next month matters more than this one.",
        steps: [
          "Look at the lines below: their last trip runs into next month.",
          "Next month, bid knowing you start with that credit — a lighter line still gets you there.",
        ],
        facts: [{ label: "Lines with carry-over credit", value: `${co.length} of ${lines.length}` }],
        risk: "How carry-over credit counts, and what happens when next month's award collides with the carried-over trip, are contract rules this app doesn't have.",
        lines: co.slice(0, 5).map((l) => rec(l, `${hm(l.carryOverCreditHours!)} carried into next month`, `${hm(l.totalCreditHours)} credit this month · ${l.daysOff} days off.`, openAt(l), openAt(l) !== null ? `About ${pct(openAt(l)!)} likely still open at your turn.` : "")),
      });
    }
  }

  // ---- Sweep flights ----
  if (bidPack.sweepFlights?.length) {
    const sweep = new Set(bidPack.sweepFlights.map((f) => `${flightKey(f.flightNumber)}|${f.from}`));
    const withSweep = lines.map((l) => ({ l, n: sweepLegs(l, sweep) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
    if (withSweep.length) strategies.push({
      id: "sweep-flights",
      name: "Know which trips can be rerouted",
      tagline: `${plural(withSweep.length, "line")} fly sweep aircraft the pack says systems can reroute.`,
      mechanism:
        "The pack lists sweep aircraft: flights that can be rerouted after the bid. A trip built on them is less predictable — a reroute can move where you end up or lengthen the day. For a commuter or anyone planning around exact times, that's a cost; for a pilot after credit, a reroute that adds flying can add pay.",
      benefits: [],
      fit: options.isCommuter ? "now" : withSweep.length ? "maybe" : "later",
      fitReason: options.isCommuter ? "As a commuter, a reroute can cost you the flight home." : "Matters if exact times matter to you.",
      steps: [
        options.isCommuter ? "Rank the lines below lower if you need to make a specific flight home." : "If you want predictable days, rank the lines below lower; if you want credit, they're worth a look.",
        "Check the trip's legs against the pack's Sweep Aircraft page before bidding.",
      ],
      facts: [
        { label: "Sweep flights listed", value: String(bidPack.sweepFlights.length) },
        { label: "Lines flying them", value: `${withSweep.length} of ${lines.length}` },
      ],
      risk: "How often sweeps are actually rerouted, and how reroutes are paid, aren't in the pack.",
      lines: withSweep.slice(0, 5).map(({ l, n }) => rec(l, `${plural(n, "leg")} on sweep aircraft`, `${hm(l.totalCreditHours)} credit · ${l.daysOff} days off.`, openAt(l), openAt(l) !== null ? `About ${pct(openAt(l)!)} likely still open at your turn.` : "")),
    });
  }

  // ---- After the award ----
  {
    const ot = info?.openTimeRelease;
    const holds = st.band === "regular";
    strategies.push({
      id: "after-award",
      name: "Work every window after the award",
      tagline: "The bid doesn't end at the award — each window after it still goes in seniority order.",
      mechanism:
        "The pack's bid calendar runs several windows after the regular award: conflict input, view/add, the SWW windows (including vacation adjustment), the secondary lines release and the open-time release. Each still favors seniority, and each happens after you've seen what everyone above you got — better information than the original bid had.",
      benefits: [],
      fit: "now",
      fitReason: holds ? "You'll hold a line — the windows after are where you shape it." : "Without a regular line, the later windows are where your month gets built.",
      steps: [
        "Conflict input: if training or vacation collides with your award, say so here.",
        "View/add: look at what's left once everyone's award is out, and add what you'd take.",
        holds ? "Open time: pick up trips on your days off for credit" + (ot ? ` — open time goes out to your seat at ${ot} local on release day` : "") + "." : "Secondary release: bid secondary lines the moment they're out (see \"Aim for a secondary line\").",
        "Trade after the award: a trip that doesn't fit can be swapped on the trade board.",
      ],
      facts: [
        { label: "Windows on this pack's calendar", value: "Conflict · View/Add · SWW · Secondary · Open time" },
        ...(ot ? [{ label: "Open time released to your seat", value: `${ot} local` }] : []),
      ],
      risk: "Each window's rules (who can add, what's legal to pick up, trade limits) are FedEx's — this lists the windows the pack's calendar names, not how each one works.",
      lines: [],
      isProcessTip: true,
    });
  }

  return strategies.sort((a, b) => FIT_ORDER[a.fit] - FIT_ORDER[b.fit]);
}

/** Kept for the board's API: moves are already ordered by how much they apply this month, which matters more than taste. */
export function rankStrategiesByPreference(strategies: Strategy[]): Strategy[] {
  return strategies;
}

/** Ties a move's lines back to the pilot's own score for them, against their current top pick. */
export function attachScoreContext(strategies: Strategy[], lineScores: LineScore[] | null | undefined): Strategy[] {
  if (!lineScores || lineScores.length === 0) return strategies;
  const topScore = Math.max(...lineScores.map((r) => r.score));
  const scoreByLineNumber = new Map(lineScores.map((r) => [r.line.lineNumber, r.score]));
  return strategies.map((s) => ({
    ...s,
    lines: s.lines.map((rec) => {
      const score = scoreByLineNumber.get(rec.lineNumber);
      if (score === undefined) return rec;
      return { ...rec, scoreContext: { score, deltaFromTopPick: Math.round((score - topScore) * 10) / 10 } };
    }),
  }));
}

