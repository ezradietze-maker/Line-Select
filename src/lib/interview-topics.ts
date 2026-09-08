/**
 * The adaptive interview's topic backlog — real ground to cover, fed into
 * `buildInterviewSystemPrompt()` as material the model works from starting
 * turn 0, replacing the old deterministic "seed round" that used to
 * guarantee a handful of these got asked before the paid loop ever started.
 * There is no seed round anymore (only the one-off commuter toggle and city
 * picker run before the loop); everything below — five reworked originals
 * plus ten new areas — is now entirely the adaptive loop's own job to
 * decide when and how to raise, same as any other topic it discovers.
 *
 * This is guidance, not a checklist the model must tick off mechanically —
 * coverage is still inferred from `currentFacts` each turn exactly as
 * before. Each entry earns its place the same way any individual question
 * has to: it exists here because it sharpens ranking or profile in a way
 * the existing catalog + voice rules alone wouldn't reliably produce.
 */

export interface InterviewTopic {
  id: string;
  label: string;
  guidance: string;
}

export const INTERVIEW_TOPIC_BACKLOG: InterviewTopic[] = [
  {
    id: "home-time",
    label: "Home time / domicile",
    guidance:
      "Get a real range, not one number: the fewest days off they could tolerate, their actual ideal, and the point it becomes unacceptable — as up to three target-slider questions on \"daysOff\" with rangeRole min/ideal/max (see RANGE TARGETS above), only asking the ones their answers actually imply. Ask why that ideal number specifically, in their own words, as a free-text or elaboration hook — the reason (kids' schedule, a second job, just burnout) often turns out to matter more than the number. Separately, ask whether they'd rather have those days off consecutive in one block or spread through the month — this is real and worth knowing, but it's calendar-clustering-dependent so it can only ever be captured as a qualitative fact, never scored.",
  },
  {
    id: "departures",
    label: "Departures per month",
    guidance:
      "Same range treatment as home time: floor/ideal/ceiling target-sliders on \"departures\" via rangeRole, only as many as their answers support. Separately probe whether they'd rather have a few big trips or lots of short ones covering the same total credit — this is really asking about tripLength with better framing, not a new dimension, so bind it there. Also ask, qualitatively, whether unpredictable/scattered departure timing through the month bothers them independent of the count — a pilot who's fine with 14 departures spread evenly can still hate 14 departures bunched unpredictably, and that distinction has no scoreable home but is worth capturing as a qualitative fact.",
  },
  {
    id: "pay-vs-lifestyle",
    label: "Pay vs. lifestyle",
    guidance:
      "Don't ask this as an abstract \"pay or lifestyle\" slider — pose it as a concrete trade a pilot actually recognizes: would you give up N credit hours for M extra days home, phrased with real numbers pulled from this bid pack's own creditHours/daysOff grounding stats. Read the answer as a creditHours slider/target with the correct direction (giving up hours for days home is direction -1 on creditHours) rather than a vague preference. Separately, ask openly what's actually driving their financial picture month to month right now, if anything, in their own words — capture it as a qualitative free-text fact; it's the kind of context that explains why someone's tradeoff answer might shift next bid cycle, not something to score.",
  },
  {
    id: "deadhead-commuter",
    label: "Deadhead / commuter status",
    guidance:
      "For a commuter specifically, ask whether they actively seek trips that deadhead them both to and from work (a \"double deadhead\") — this is a real, extreme-positive reading on the existing deadheadTolerance dimension, not a new one, so bind it there with direction 1 when they're seeking it. Ask whether they prefer that deadhead at the front of the trip, the back, or don't care — qualitative, since there's no separate scoreable slot for placement. For any commuter, ask about real commute logistics: how much buffer time before a report they actually need to feel safe, and whether a red-eye commute (flying in overnight to make an early report) is something they'd do or actively avoid — both qualitative, pilot-personal facts with no bid-pack-side counterpart to score against, but valuable narrative context for why a given line does or doesn't work for them.",
  },
  {
    id: "city-preferences",
    label: "City preferences",
    guidance:
      "Whenever a city gets flagged as loved or avoided (via city-sentiment, from the picker or the conversation), don't stop at the sentiment — follow up on why, once, referencing the specific city by name: weather, being near family or friends, hotel quality there, how short the layover usually runs, or just nothing to do on downtime. A pilot who avoids a city because the layover is always too short needs a completely different fix from one who avoids it because the hotel is bad, and the ranking tool can't tell the difference without asking. Capture the why as a qualitative fact, and tag it with \"cityReason\" ({code, category}) using the real city code and whichever category actually matches (weather/people/hotel/layover-length/downtime/other) — this is what lets a hotel-related reason get tied back to that city's real review later, instead of the app having to guess from the statement's prose.",
  },
  {
    id: "international-intensity",
    label: "International intensity / hard ceiling",
    guidance:
      "This reuses the existing \"international\" explicit-weight id — the new ground here is checking for a genuine hard ceiling, not just a lean. If a pilot says something like \"I will not fly more than X% international\" or \"international trips are a dealbreaker past a point,\" that's the rare case where severity: \"dealbreaker\" belongs on an explicit-weight fact (see DEALBREAKERS above) — don't just record it as an ordinary strong preference if their own words are that unambiguous.",
  },
  {
    id: "report-time-circadian",
    label: "Report-time / circadian tolerance",
    guidance:
      "Go beyond the single circadianHealth lean: ask specifically how many consecutive early-morning (2-6am window) or late reports this pilot can actually handle before it starts costing them — \"does two in a row wear on you a lot more than one isolated one, or is three where it actually gets bad?\" If their answer implies a real number, pin it as an explicit-target on \"circadianTolerance\" (see the RANGE TARGETS/catalog sections above) — this is a real, direct personalization input to how circadianHealth gets scored for them specifically, not just a qualitative impression. Separately, distinctReportHoursPerTrip and backOfClockDeparturesPerTrip are still the right implicit ids for the broader \"how much shifting/back-of-clock flying bothers you\" question, if that comes up as its own thread. Back-to-back circadian-disruptive trips (one rough trip immediately followed by another, across the calendar) are measurable only when a line's exact trip placement is confirmed — most of the time it isn't, so treat this as usually qualitative-only unless you have real reason to think otherwise; never imply it's always being scored.",
  },
  {
    id: "reserve-tolerance",
    label: "Reserve line tolerance",
    guidance:
      "Ask whether they'd consider a reserve line at all, and if so which type (24hr, A, or B) — cite this bid pack's own real reserve-line count/type breakdown from the grounding stats if it's non-null, rather than asking in the abstract. This can only ever be captured as a qualitative, informational fact: reserve lines in this app are a separate, minimally-detailed data structure with no credit/schedule/trip-shape data at all, so nothing about reserve tolerance can move a ranked line's score or appear in results. Don't imply otherwise — if a pilot asks whether reserve lines will show up ranked, be straightforward that they won't.",
  },
  {
    id: "landings-currency",
    label: "Landings / currency preference",
    guidance:
      "This is a real, currently-unused explicit-weight id (\"landings\") backed by each line's actual tracked landing count — cite the bid pack's real landings min/max from the grounding stats when asking. Some pilots want more landings for proficiency/currency comfort (direction 1); others, especially those managing fatigue, want fewer (direction -1). This has never been asked about before this topic existed, so don't assume a prior answer already covers it.",
  },
  {
    id: "day-of-week-calendar",
    label: "Day-of-week / calendar-specific needs",
    guidance:
      "If a pilot cares about specific days of the week or month being off (a standing commitment, a recurring event, a specific weekly obligation), ask what it is in their own words. This is calendar-date-dependent and this app's bid-pack parser does not reliably track which calendar day a trip actually falls on, so it must always be captured as qualitative only — never imply it will be tracked or scored, and don't build a fact that pretends otherwise.",
  },
  {
    id: "commute-logistics-detail",
    label: "Commute logistics detail",
    guidance:
      "For commuters, this overlaps with the deadhead-commuter topic above (buffer time, red-eye commute tolerance) — don't ask it twice as a separate topic if it's already been covered there. If it hasn't come up yet by the time commuting is otherwise established, this is the place to raise it: how much schedule buffer they actually need before a report, and whether they'd fly in the night before on a red-eye versus needing a hotel or an easier connection. Qualitative only.",
  },
  {
    id: "predictability-variety",
    label: "Predictability vs. variety",
    guidance:
      "Ask whether they'd rather bid a repeatable month where most trips look similar, or don't mind (or actively want) a wide mix of very different trip lengths and shapes. This binds to the implicit id \"tripShapeVariancePerLine\" — direction 1 if they want more variety/spread, direction -1 if they want a consistent, repeatable pattern. This is a real, computed measure of how much a line's own trips vary from each other, not a guess.",
  },
  {
    id: "rest-recovery",
    label: "Rest / recovery sensitivity beyond average TAFB",
    guidance:
      "Ask directly what layover length actually feels like real recovery to them versus just enough to sleep and go — this is exactly what shortRestOvernightsPerTrip and avgSleepOpportunityHours measure, but today they're only ever reached by inference from an unrelated answer, never asked about head-on. A pilot who says a 10-hour layover leaves them wrecked but 14 hours feels fine is giving you a direct, bindable signal on both those ids.",
  },
  {
    id: "real-schedule-effort-metrics",
    label: "Day-rig rate and duty-to-flying ratio",
    guidance:
      "Two real per-trip stats the results screen already shows a pilot by name (\"Day-rig rate,\" \"Duty-to-flying ratio\") have never been asked about directly, so they sit at zero weight for almost everyone even though they're real, scoreable ids. Ask about day-rig rate (creditPerTafbHour) using money-per-day-away framing: \"would you take a trip that pays a bit less overall if it paid better per day you're actually away from home?\" Ask about duty-to-flying ratio (dutyToBlockRatio) using the real-workload framing: \"does it bother you when a lot of the duty day is sitting around — connections, standby — versus actually flying, even if the total credit is the same?\" Bind each to its own implicit id from the answer's direction, using the exact same terms (\"day-rig rate,\" \"duty-to-flying ratio\") the pilot will later see on their results screen, so their answer and what they're shown later obviously refer to the same thing.",
  },
  {
    id: "seniority-realism",
    label: "Seniority / realism context",
    guidance:
      "Asking a bid number or rough seniority standing can be useful context — this app does have a real, separate crowd-sourced record of what pilots at various seniority numbers have actually held before (the Strategies board's own award-history feature), so a stated number isn't wasted. But be precise about what it's for here: it has no effect on this pilot's Satisfaction Index or line ranking, and it isn't turned into a strategy or achievability read inside this interview either — that's the Strategies board's own job when the pilot visits it separately. Capture the answer as a plain informational qualitative fact only; don't imply this interview itself is computing anything from it.",
  },
  {
    id: "financial-context",
    label: "Financial context beyond pay-vs-lifestyle",
    guidance:
      "Separate from the concrete credit-hours-for-days-home trade in the pay-vs-lifestyle topic, leave room for an open-ended free-text ask about their broader financial picture right now, if it seems relevant and hasn't already come up there. Purely qualitative narrative context — there's no additional scoreable dimension here beyond creditHours itself.",
  },
  {
    id: "strategy-fit",
    label: "Strategy fit — risk tolerance and admin effort appetite",
    guidance:
      "Two real inputs to the separate Strategies board, not to this pilot's line ranking or Satisfaction Index — be clear about that distinction if it comes up. Ask about risk tolerance directly: \"if a genuinely rare, far-from-guaranteed line existed, would you rank it high anyway, or only bid what you're confident about?\" Bind to \"riskTolerance\" (direction 1 = ranks the reach high anyway, direction -1 = only bids what's realistic). Ask about admin effort appetite separately: \"if there were a real but effortful way to do better — filing a grievance, working a manual trade, chasing every re-bid window — would you actually do it, or is that more hassle than it's worth?\" Bind to \"adminEffortAppetite\" (direction 1 = would do the work, direction -1 = wants the low-effort outcome). These two only ever affect which Strategies-board moves get surfaced/ordered for this pilot — never phrase a question here as if it changes how a line scores, because it doesn't.",
  },
];
