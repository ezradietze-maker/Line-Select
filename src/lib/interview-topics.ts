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
      "Get a real range, not one number: the fewest days off they could tolerate, their actual ideal, and the point it becomes unacceptable — as up to three target-slider questions on \"daysOff\" with rangeRole min/ideal/max (see RANGE TARGETS above), only asking the ones their answers actually imply, and keeping the numbers inside groundingStats.daysOff (the pack's real spread — often only a few days wide). Ask why that ideal number specifically, in their own words, as a free-text or elaboration hook — the reason (kids' schedule, a second job, just burnout) often turns out to matter more than the number. Separately, ask whether they'd rather have those days off together in one long block or spread through the month, and whether weekends off matter — both are now real and scoreable from each line's own calendar: bind the first to \"longestDaysOffBlockPerLine\" and the second to \"weekendDaysOffPerLine\" (see THE CALENDAR IS REAL above). When the spread of days off is narrow, how they fall can separate lines far more than how many there are.",
  },
  {
    id: "duty-periods",
    label: "Duty periods per month",
    guidance:
      "Cite groundingStats.dutyPeriods (the real per-line spread) for any number you ask about. A duty period is one report-to-release stretch, counted the way the bid pack prints it on each line (\"NO. DP'S\") — hotel standby days included. It is the number of times this pilot reports for duty in the month, and it is NOT the number of takeoffs: a departure is a takeoff, always equals a landing, and lives on the \"landings\" id instead (see the landings topic) — never conflate the two when phrasing a question. Same range treatment as home time: floor/ideal/ceiling target-sliders on \"dutyPeriods\" via rangeRole, only as many as their answers support. Separately (its own question) probe whether they'd rather have a few big trips or lots of short ones covering the same total credit — this is really asking about trip length: a named sweet spot (\"3-4 day trips,\" \"nothing over 5\") binds to the tripLength TARGET (ideal, plus max/min if they name a limit), and only a genuine \"as long as possible\"/\"as short as possible\" binds to the directional tripLength lean. Also ask, qualitatively, whether unpredictable/scattered report timing through the month bothers them independent of the count — a pilot who's fine with 14 duty periods spread evenly can still hate 14 bunched unpredictably, and that distinction has no scoreable home but is worth capturing as a qualitative fact.",
  },
  {
    id: "pay-vs-lifestyle",
    label: "Pay vs. lifestyle",
    guidance:
      "Don't ask this as an abstract \"pay or lifestyle\" slider — pose it as a concrete trade a pilot actually recognizes, with real numbers from this pack: groundingStats.creditByDaysOff shows what lines at each days-off count actually average in credit, and groundingStats.creditHours the full spread. If a day off barely costs credit here, say so plainly rather than inventing a hard trade — the real question then is about busier versus lighter flying at similar pay (more duty periods, longer duty days) rather than days off. Read the answer as a creditHours slider/target with the correct direction (giving up hours for days home is direction -1 on creditHours) rather than a vague preference. Separately, ask openly what's actually driving their financial picture month to month right now, if anything, in their own words — capture it as a qualitative free-text fact; it's the kind of context that explains why someone's tradeoff answer might shift next bid cycle, not something to score.",
  },
  {
    id: "deadhead-commuter",
    label: "Deadhead / commuter status",
    guidance:
      "For a commuter specifically, ask whether they actively seek trips that deadhead them both to and from work (a \"double deadhead\") — this is a real, extreme-positive reading on the existing deadheadTolerance dimension, not a new one, so bind it there with direction 1 when they're seeking it. Ask whether they prefer that deadhead at the front of the trip, the back, or don't care — qualitative, since there's no separate scoreable slot for placement. For any commuter, ask about real commute logistics — as two separate questions on separate turns, never one combined ask: first how much buffer time before a report they actually need to feel safe, then (if it still matters after their answer) whether a red-eye commute (flying in overnight to make an early report) is something they'd do or actively avoid — both qualitative, pilot-personal facts with no bid-pack-side counterpart to score against, but valuable narrative context for why a given line does or doesn't work for them.",
  },
  {
    id: "hotel-amenities",
    label: "Hotel amenities — food, gym, grocery",
    guidance:
      "Three real, distinct explicit-weight ids (hotelFood, hotelGym, hotelGrocery) never get their own moment otherwise — they're easy to skip past on the way to the more dramatic hotel-quality/noise questions. Ask directly, once, which of these actually matter on the road: walkable food or coffee near the hotel, gym or fitness access, a grocery or pharmacy nearby to restock without a car. Ask this as a \"choice\" (pick the one that matters most, with an \"a few of these\"/\"none of these\" option among the choices) or as \"free-text\", never as if several options could be selected at once — this app's \"choice\" question kind only ever records one selectedIndex, so a question phrased like a multi-select checkbox list is silently misleading about what the pilot can actually do with it. A free-text answer naming two or three of them is exactly how to get more than one bound in a single turn: extract a separate hotelFood/hotelGym/hotelGrocery profile update for each one the pilot's own words call out as mattering, direction 1 with a real importance. For any of the three the pilot explicitly says doesn't matter (not just \"didn't mention\" — a real, answered no), still add an explicit-weight fact for it with direction 1 and importance EXACTLY 0 rather than leaving it unbound — see the coverage-mechanics note above for why an unbound id here traps the interview into re-asking the same question forever, and why 0 (not a small nonzero number) is the value that avoids incorrectly showing that amenity as \"matters to you\" on the pilot's own results screen.",
  },
  {
    id: "city-preferences",
    label: "City preferences",
    guidance:
      "Whenever a city gets flagged as loved or avoided (via city-sentiment, from the picker or the conversation) and the pilot hasn't already said why, follow up on why, once, referencing the specific city by name (one question can cover two or three flagged cities at once — \"what is it about SAN, and about EWR?\" is still one topic): weather, being near family or friends, hotel quality there, how short the layover usually runs, or just nothing to do on downtime. A pilot who avoids a city because the layover is always too short needs a completely different fix from one who avoids it because the hotel is bad, and the ranking tool can't tell the difference without asking. Capture the why — only the reason the pilot actually gives, in their words, never one you assume — as a qualitative fact, and tag it with \"cityReason\" ({code, category}) using the real city code and whichever category actually matches (weather/people/hotel/layover-length/downtime/other) — this is what lets a hotel-related reason get tied back to that city's real review later, instead of the app having to guess from the statement's prose.",
  },
  {
    id: "international-intensity",
    label: "International intensity / hard ceiling",
    guidance:
      "This reuses the existing \"international\" explicit-weight id (groundingStats.internationalLineSharePercent says how many lines in this pack fly any international at all) — the new ground here is checking for a genuine hard ceiling, not just a lean. If a pilot says something like \"I will not fly more than X% international\" or \"international trips are a dealbreaker past a point,\" that's the rare case where severity: \"dealbreaker\" belongs on an explicit-weight fact (see DEALBREAKERS above) — don't just record it as an ordinary strong preference if their own words are that unambiguous.",
  },
  {
    id: "report-time-circadian",
    label: "Report-time / circadian tolerance",
    guidance:
      "Go beyond the single circadianHealth lean: ask specifically how many consecutive early-morning (2-6am window) or late reports this pilot can actually handle before it starts costing them — \"does two in a row wear on you a lot more than one isolated one, or is three where it actually gets bad?\" If their answer implies a real number, pin it as an explicit-target on \"circadianTolerance\" (see the RANGE TARGETS/catalog sections above) — this is a real, direct personalization input to how circadianHealth gets scored for them specifically, not just a qualitative impression. Separately, distinctReportHoursPerTrip and backOfClockDeparturesPerTrip are still the right implicit ids for the broader \"how much shifting/back-of-clock flying bothers you\" question, if that comes up as its own thread. Back-to-back circadian-disruptive trips across the calendar (one rough trip immediately followed by another) have no scoreable id of their own — capture that as qualitative; never imply it's being scored.",
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
      "This is a real, currently-unused explicit-weight id (\"landings\") backed by each line's actual tracked landing count — cite the bid pack's real landings min/max from the grounding stats when asking. Some pilots want more landings for proficiency/currency comfort (direction 1); others, especially those managing fatigue, want fewer (direction -1). This has never been asked about before this topic existed, so don't assume a prior answer already covers it. Note that a line's landings are also its departures (takeoffs) — this is the takeoff count, and it is a different number from duty periods (report-to-release stretches; see the duty-periods topic), so never blur the two when phrasing a question.",
  },
  {
    id: "hotel-standby",
    label: "Hotel standby",
    guidance:
      "Only raise this when the request's grounding.hotelStandby shows linesWithStandby above 0 — if it's 0 or absent this bid pack has no standby and nothing said here could move a ranking, so skip the whole topic (uncoveredExplicitWeightIds already leaves hotelStandby out in that case). Hotel standby means sitting on call at a layover hotel, one duty day at a time, paid a guaranteed credit (about grounding.hotelStandby.creditHoursPerStandbyDay hours a day) with no flying done — so a trip can be all repositioning and standby with zero landings. Pilots know exactly what this is; never explain it. This is a real, distinct topic and deserves real depth, like any other: work these threads over several turns, following what the pilot actually says rather than marching through them, and cite the pack's own real numbers (how many lines have it, the most days on any one line, the longest run in a single trip) when a number would sharpen the question. (1) The lean itself — ask as a direct \"slider\" on hotelStandby framed as a trade they recognize: paid a full guaranteed day to sit in a hotel room versus not, on top of the days they'd otherwise fly. Direction 1 = likes it / seeks it (easy guaranteed pay, forced rest), direction -1 = wants none of it; a genuine \"doesn't matter to me\" still needs an explicit-weight fact on hotelStandby with importance EXACTLY 0 (see the coverage-mechanics note above). (2) Why — ask, referencing their own words, whether it's the pay (credit for no flying), the rest, being tied to a room and a phone, not knowing if they'll be called, or something else; capture as qualitative. A pilot who loves it for the money and one who loves it for the rest need different follow-ups. (3) How much before it wears on them — ask roughly how many standby days in a month is fine, and where it becomes too many; a clear answer implies a strength of feeling worth folding into the hotelStandby importance, and a real number worth keeping as a qualitative fact since there is no scoreable target slot for it. (4) How long a single stretch — one night versus three or four days on end at the same hotel is a genuinely different experience; bind a clear answer to the implicit id longestStandbyStretchPerLine (direction 1 = fine with long runs, -1 = wants any standby short). (5) How many separate times — one long sit versus coming back to standby again and again through the month; bind to standbyStintsPerLine the same way. (6) Being called out — how they feel about standby that ends in an actual call to fly (a rest day that turns into a duty day, on short notice) versus standby that stays quiet; qualitative, since the bid pack can't show whether a call happens. (7) The hotel itself — standby means spending whole days in that hotel, so ask whether that changes how much its quality, noise, food nearby, or gym matter for those days; only re-bind hotelQuiet, hotelQuality, hotelFood or hotelGym if their answer genuinely moves one of those above where it already sits, otherwise capture it qualitatively. (8) Where — whether standby at their own domicile feels different from standby at an outstation; if a city came up earlier as loved or avoided, connect it by name. For a commuter, ask how standby interacts with getting home — being stuck at an outstation hotel versus sitting near home — qualitative. (9) Sleep — whether the uncertainty of a possible call breaks up their rest even on a quiet day; qualitative, and only if circadianHealth or rest came up, otherwise a single light question. (10) A hard line — ask once whether they'd ever rule out a line just because it has standby on it; only if the answer is unambiguous refusal, bind direction -1 on hotelStandby with severity \"dealbreaker\", otherwise it's an ordinary strong preference expressed through importance. (11) Versus reserve — if reserve tolerance has come up, ask how standby compares to it for them; qualitative. HARD CONSTRAINT for this topic: the ONLY slider is thread 1's hotelStandby slider. Threads 3, 4 and 5 (how many days, how long a stretch, how many separate stints) have no slider or target-slider id at all — ask them as \"choice\" or \"free-text\" and bind the answer to the implicit ids or capture it qualitatively. Never use a \"target-slider\" bound to \"departures\" (or any other id) to stand in for a standby count: a pilot's answer there would be recorded as a departures target, silently corrupting a different dimension. Depth follows how much standby actually exists in THIS pack, not just how strongly the pilot feels: when grounding.hotelStandby.linesWithStandby is under about a tenth of verifiedLines (a real pack had 12 of 324), standby can barely move this pilot's ranking, so ask thread 1's lean and at most one follow-up — even for a pilot with a strong opinion — and spend the turns on what touches their whole month instead. Only when standby is common in the pack does a pilot with a strong opinion deserve several of these threads, one per question. A pilot who shrugs at the lean needs the exact-0 fact and nothing more.",
  },
  {
    id: "day-of-week-calendar",
    label: "Day-of-week / calendar-specific needs",
    guidance:
      "Ask, once, whether anything this bid period needs specific days off — a wedding, a checkride, a kid's event, a holiday they've promised to be home for — and whether anything recurs on the same weekday every week. Pin dates to real days using groundingStats.bidPeriod and tag them (\"specificDates\" for one-off days, \"recurringWeekday\" for a weekly commitment) so every line that works one gets flagged; see THE CALENDAR IS REAL above. Be straight about what that does: a line that works one is flagged and ranked lower, not ruled out — unless they say they can't work that day at all, which makes it a dealbreaker. If how firm it is isn't clear from what they said, ask: could they live with trading it away, or is it off the table? When a hard line would leave few lines standing, use the real count from groundingStats.linesFree in that question (see WHAT A CALENDAR HARD LINE COSTS). If the bidding story already named dates or a weekly commitment, this question confirms them and asks only about anything else this period — never re-asks what's already on file. Skip this topic only if the bidding story or an earlier answer already covered it.",
  },
  {
    id: "commute-logistics-detail",
    label: "Commute logistics detail",
    guidance:
      "For commuters, this overlaps with the deadhead-commuter topic above (buffer time, red-eye commute tolerance) — don't ask it twice as a separate topic if it's already been covered there. If it hasn't come up yet by the time commuting is otherwise established, this is the place to raise it, one question at a time: how much schedule buffer they actually need before a report; then, separately, whether they'd fly in the night before on a red-eye versus needing a hotel or an easier connection. Qualitative only.",
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
      "Ask directly what layover length actually feels like real recovery to them versus just enough to sleep and go — this is exactly what shortRestOvernightsPerTrip and avgSleepOpportunityHours measure, but today they're only ever reached by inference from an unrelated answer, never asked about head-on. A pilot who says a 10-hour layover leaves them wrecked but 14 hours feels fine is giving you a direct, bindable signal on both those ids. While on this thread, also ask directly whether room noise specifically gets in the way of actually using that rest time — thin walls, street noise, a bar downstairs — and bind a clear answer to the explicit-weight id hotelQuiet; it's thematically the same conversation (can this layover actually deliver real recovery) but a distinct, otherwise-easy-to-miss dimension.",
  },
  {
    id: "real-schedule-effort-metrics",
    label: "Day-rig rate and duty-to-flying ratio",
    guidance:
      "Two real per-trip stats the results screen already shows a pilot by name (\"Day-rig rate,\" \"Duty-to-flying ratio\") have never been asked about directly, so they sit at zero weight for almost everyone even though they're real, scoreable ids. These are two separate questions, on separate turns — never one combined ask. Ask about day-rig rate (creditPerTafbHour) using money-per-day-away framing: \"would you take a trip that pays a bit less overall if it paid better per day you're actually away from home?\" Ask about duty-to-flying ratio (dutyToBlockRatio) using the real-workload framing: \"does it bother you when a lot of the duty day is sitting around — connections, standby — versus actually flying, even if the total credit is the same?\" Bind each to its own implicit id from the answer's direction, using the exact same terms (\"day-rig rate,\" \"duty-to-flying ratio\") the pilot will later see on their results screen, so their answer and what they're shown later obviously refer to the same thing.",
  },
  {
    id: "seniority-realism",
    label: "Seniority / realism context",
    guidance:
      "Never ask this when \"seniorityKnown\" is true — the pilot already gave their number before the interview started. Otherwise, asking a bid number or rough seniority standing can be useful context — this app does have a real, separate crowd-sourced record of what pilots at various seniority numbers have actually held before (the Strategies board's own award-history feature), so a stated number isn't wasted. But be precise about what it's for here: it has no effect on this pilot's Satisfaction Index or line ranking, and it isn't turned into a strategy or achievability read inside this interview either — that's the Strategies board's own job when the pilot visits it separately. Capture the answer as a plain informational qualitative fact only; don't imply this interview itself is computing anything from it.",
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
