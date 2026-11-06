# Reorder learning: what a pilot's drag teaches the brain

Plan written Nov 6 2026. It draws on five research passes over the 2005–2026 literature and products (about 180 sources
read; key ones are listed at the end) and free experiments on the ex-pilot's real sort. Nothing here is built yet.

## 1. The goal

A pilot drags line A above line B because the ranking had them the wrong way round. The brain should:

1. **Keep A where the pilot put it.** Their order is the order.
2. **Work out why**: which factor made A better to them, or B worse. Sometimes it is something the model doesn't track.
3. **Learn from it**, so that next time lines the pilot never touched (and next month's pack) come out in their order
   without dragging.
4. **Say what it learned in one line**, ask one quick question when it really can't tell, and let the pilot undo it.

## 2. How it works today, and what's wrong

A drag turns into "A beats every line it passed". `fitWeightsToChoices` then refits the priority weights: gradient
descent on log-weights, pulled back toward the interview, capped at 3× either way. The test bench is the ex-pilot's real
full order of 20 lines, on 8 saved readings of his interview (`.cache/eval/tmp/drag-*.ts`; free, no AI calls).

| Finding | Evidence |
|---|---|
| Drags teach the model almost nothing | Agreement with his order after 8 simulated drags: 86.0% → 85.9% |
| The dragged line snaps back | He drags 1010 above 1003; the list re-sorts and 1003 is on top again. Same drag 5 times, same result |
| Repeating a drag counts once | `fitWeightsToChoices` keeps one verdict per pair of lines |
| "Counting more: …" can name every factor | Weights are rescaled to the strongest. Every weight "rose" without anything relative changing |
| Lines capped by a dealbreaker are mis-modelled | The fit's own score formula leaves out the hard-limit cap |
| Drag lessons vanish each month | The check-in starts from `reviewedModel` (before any drags) and clears `choices` |
| A drag is never sent to fleet learning | Only interview outcomes are |
| Choices store line numbers only | Line 1010 next month is a different line. Today the check-in clearing choices hides this. Anything that keeps choices across packs must store what the lines *were*, not their numbers |

Two results changed the design:

- **Reorders are close calls.** Across his four piles (top / fine / only-if-I-had-to / bottom) the model is almost
  never wrong (0.2–3.5% of pairs). Within a pile it's a coin flip (47.5%). That is exactly where a pilot drags. The
  behavioural research agrees: repeated choices flip mostly when no option is clearly better (Agranov & Ortoleva 2017).
- **Reweighting alone has a low ceiling.** Even if he sorted all 10 lines he could see perfectly, the best reweighting
  lifts agreement on lines he never saw from 86.5% to only 88.3%. Freer fits overfit (98% on what he sorted, worse on
  the rest). The big gains have to come from three things: keeping his order, finding the real reason (often a factor
  or threshold the model lacks), and carrying lessons across months and pilots.

## 3. What the research says (condensed)

- **The math fits our score exactly.** Score = 100·(1 − √S), where S = Σwᵢdᵢ / Σwᵢ and dᵢ = (1 − uᵢ)². The square
  root only reshapes the score without changing the order, so **A beats B exactly when Σ wᵢ·(dᵢᴮ − dᵢᴬ) > 0**. That is
  linear in the weights: the same form as RankSVM (Joachims 2002), linear Bradley–Terry, UTA ordinal regression (Greco
  et al. 2008), and Podium, the closest prior art (Wall et al. 2017, which learns weights from drags in a table). All
  three independent research passes found this.
- **Use a Bayesian model, not a point fit.**
  - Fit a Bradley–Terry/Thurstone likelihood, with a Gaussian prior centred on the interview weights (Chu & Ghahramani
    2005; Guo & Sanner 2010; Bıyık et al. 2019–2022).
  - A Laplace approximation (Newton's method on a 20×20 matrix) gives each weight a value *and an uncertainty*.
  - The prior replaces the hand-set 3× cap and pull-back. A 3× cap is about a prior standard deviation of 0.56 on the
    log-weight.
  - Sawtooth's meta-analysis shows that prior strength must be tuned on held-out data, not guessed.
- **One gesture is one piece of evidence.** A long drag shouldn't count as 15 votes (Cao et al. 2006, normalised per
  query). Joachims' eye-tracking found that "beats the lines skipped above it" agrees with human judges 81% of the time,
  while pairs that only confirm the shown order are inflated by trust bias. Add a lapse rate of about 10% (Christiano
  et al. 2017), so one stray drag can't swing everything.
- **"Which factor" has an exact, closed-form answer.**
  - Each factor's share of the score gap is φᵢ = 100·wᵢ(dᵢᴮ − dᵢᴬ) / (Σw·(√S_A + √S_B)). The shares add up exactly to
    the gap.
  - This matches exact Shapley values to within 0.4 points; the top factor agreed in 299 of 300 test pairs (ShaRP 2024;
    Integrated Gradients 2017).
  - The cheapest single-weight change that would flip the pair is the inverse-optimisation answer (Ahuja & Orlin 2001).
  - Over posterior samples, the share of samples in which factor i is the main cause is "how sure we are it was i".
- **Explain the way people do** (Miller 2019; Lipton).
  - Contrast with the line it passed.
  - Give one or two causes, in real numbers.
  - Never mention factors where the two lines are equal.
  - Show influence, not weight: a heavy factor that is equal on both lines explained nothing (ShaRP).
- **Often it's "one bad thing", not a weight.**
  - 92% of people screen options on at least one attribute (Gilbride & Allenby 2004).
  - Lexicographic and threshold rules predict as well as weighted models (Yee et al. 2007; Ranyard et al. 2020).
  - Every surprising drag should test two explanations against each other:
    - (H1) a weight shift;
    - (H2) a threshold on one factor where B is past a cut-off and A isn't.
- **Ask rarely, as a choice, and treat the answer as evidence.**
  - Basu et al. 2018: asking "which feature mattered?" learned faster, made later comparisons less noisy, and users
    preferred the result 74% of the time.
  - The research on reasons, though, says people misreport why they chose (Nisbett & Wilson 1977; choice blindness, Hall
    et al. 2010), and may accept a plausible guess. So:
    - offer 2–3 chips, plus "something else" and "about equal";
    - ask only when the model can't decide;
    - ask at most about once per 5–8 drags;
    - an answer is worth a few drags, never more than repeated behaviour.
  - Pick the question by expected information gain (BALD, Houlsby et al. 2011).
- **Claude words things; the math decides** (OPEN 2024; BED-LLM 2026).
  - Claude maps a free-text reason to a factor in the metric catalog, or proposes a new criterion.
  - Claude phrases the question and the "here's what I learned" line.
  - The numeric model does all the updating.
- **Drags can't discover a new factor on their own.** In our synthetic test (pilots with known preferences plus one
  hidden factor), nothing learned the hidden factor from 6 drags: about 69% for every learner. FERL (Bobu et al. 2021):
  when nothing explains the input, ask for the missing factor; don't keep fitting.
- **How products do it.**
  - Eagle QuickBid: a drag is a removable "manual sorting" layer above the computed ranking.
  - Gmail Priority Inbox and LinkedIn GLMix: global model plus a personal offset, updated incrementally.
  - YouTube (Mozilla 2022): 62% of users said feedback controls did nothing. A drag that visibly teaches nothing destroys
    trust.
  - Google PAIR and Microsoft HAI guidelines: say what will change, preview the knock-on effects, let users undo and reset.
  - No crew-bidding tool we found infers *why* a pilot reordered. That is an opening for Line Select.

## 4. The design

### 4.1 Two layers

- **Placement layer (what the pilot sees).** Each drag records "A above B". The shown list is the model's order with
  those constraints applied on top, so the line stays where it was put. Each placement has its own undo, and there is
  "clear my manual order". A placement belongs to this pack only.
- **Learning layer (what the brain believes).** A posterior over the pilot's weights. It ranks every line the pilot
  hasn't placed, and next month's pack.

### 4.2 The equation

For a pair (A placed above B), let xᵢ = dᵢᴮ − dᵢᴬ (A's shortfall advantage on factor i), and let θ = log-weights.

```
P(A over B | θ) = ε/2 + (1 − ε) · Φ( (Score_A(θ) − Score_B(θ)) / τ )      ε ≈ 0.1 lapse, τ ≈ 3–6 points
One drag of A past lines B₁…B_k:  log-likelihood = Σⱼ ωⱼ · log P(A over Bⱼ),  with Σ ωⱼ ≈ 1–2 (landing neighbour largest)
Prior:  θ ~ N( θ_interview + δ_segment , Σ )                  Σ learned from the fleet; starts at sd ≈ 0.5 per factor
Posterior:  Newton → θ̂,  H = Σ⁻¹ + Σ_pairs ω·λ·g·gᵀ  →  θ ~ N(θ̂, H⁻¹)   (then about 1–2k samples, importance-reweighted)
```

- Lines broken by a dealbreaker keep the cap inside the likelihood.
- A drag of a capped line above uncapped ones is evidence that **the dealbreaker is wrong**, not that a weight is.
- Pins the pilot set by hand still win, applied after the fit, as now.
- Optional later: a per-criterion threshold parameter, so a drag can move a utility curve's `fineAt`/`worstAt` and not
  only its weight. This is hypothesis H2.

### 4.3 "Why did this line move?" (`explainSwap`)

For the moved pair, using the current posterior:

1. **Shares**: φᵢ for every factor that differs. These are exact and add up to the gap.
2. **Single-factor fixes**: the multiplier kᵢ = 1 + D/(wᵢxᵢ) that would tie the pair on factor i alone. A factor that
   could only explain the move with an implausible multiplier (beyond the prior's 95% range) is dropped.
3. **Responsibility**: over posterior samples, P(factor i is the main cause).
4. **Threshold check (H2)**: does a single factor separate B from all the lines A passed?
5. **Untracked factors**: catalog metrics not in the pilot's model where A beats B strongly. Rank them by how often
   other pilots care about them (look-ahead principle, Viappiani et al. 2006).
6. **Verdict**: *clear* (one cause, responsibility ≥ 0.6), *ambiguous* (two or three similar), *threshold*, or
   *unexplained* (no plausible fix; say so, and don't learn from it yet).

On his real 1010-over-1003 drag, today's model already ranks the causes. The first two can each flip the pair alone; the
third would need too large a change:

| Rank | Factor | 1010 | 1003 | Share of the gap | Multiplier to flip the pair alone |
|---|---|---|---|---|---|
| 1 | Trips joined from home | 2 | 1 | 49% | ×3.0 |
| 2 | Commutes | 0 | 1 | 15% | ×7.8 |
| 3 | Weekdays off | 6 | 5 | 8% | ×13 |

Pulling the other way: 1003 has more layover value (145 vs 111) and fewer home departures (1.7 vs 2). That is an
*ambiguous* drag: the right moment to ask.

### 4.4 The one question

Ask only when the verdict is ambiguous, threshold or unexplained, *and* the best question's information gain clears a
cost, at most about once per 5–8 drags.

The question is a small card worded by Claude from real numbers, for example:

> You put **1010** above **1003**. I had 1003 higher for its layovers. Was it…
> [0 commutes vs 1] [2 trips from home vs 1] [More weekdays off] [Something else…] [About equal]

What each answer does:

- **A chip** becomes evidence: a softmax over the offered factors' shares (Basu 2018), worth roughly 2–3 drags.
- **"About equal"** becomes a tie: no learning from that pair.
- **Something else** opens free text. Claude (the existing brain route, cheap model) maps it to a catalog metric, a
  threshold, or "new criterion". A new criterion goes to the brain as a proposed addition, which the pilot confirms the
  way interview criteria are confirmed. That is the only path by which a factor the model has never tracked can come in.

### 4.5 What the pilot sees after a drag

- **The toast** says the line stayed put, the one-line reason (contrastive, 1–2 causes, real numbers), and offers
  [Undo] [Not why] [Just this line].
  - Wording is never "counting more: …" for factors that only rescaled. Report only changes in a factor's relative pull.
  - Don't present the model's guess as fact: say "Looks like…?", not "You care more about…".
- **After 2–3 drags pointing the same way**: "Count *commutes* more? 6 lines would move," with a preview. The list
  never reshuffles silently.
- **A "What I've learned" panel** lists each learned change, the drags or answers behind it, an undo for each, "reset to
  my interview", and a switch to turn learning from drags off.

### 4.6 Memory across months and pilots

- **Save the posterior, not line numbers.** That means the offset from the interview (mean and precision per criterion).
  Store each drag with a snapshot of both lines' factor values, so it can be replayed after the metric code changes.
- **Next month** starts from the confirmed model plus the learned offset, with confidence decayed (precision × about 0.8
  per month).
- **A "just this month" answer** (vacation, an event) lives in a monthly layer that resets.
- **Fleet priors.** The nightly learning cron fits δ and Σ by segment (commuter or local, seat, fleet) with EM over each
  pilot's posterior. A new pilot's first drag then already knows what drags usually reveal, for example "pilots who say
  commutes matter usually under-weight them".
  - The existing invariants carry over:
    - never learn from the demo pack or from assumed values;
    - guests count less;
    - never show a pilot anyone else's data;
    - promote a fleet prior only if it doesn't do worse on the newest 20%.

## 5. Experiment results so far (free, ex-pilot pack)

| Test | Today's fit | Bayesian fit (§4.2) | Notes |
|---|---|---|---|
| Real order, 8 drags, list snaps back | 86.0 → 85.9 | 86.1 → 86.8 | Neither can fix close calls from one drag |
| Real order, unseen lines, placements stick | 86.4 → 88.1 | 86.5 → 87.4 | Weights barely move unseen lines (§2) |
| Synthetic pilots, known truth, 6 drags, unseen lines | 74.4% | 77.0% (71.3% with no learning) | The Bayesian fit generalises better |
| + "Which mattered?" answers | n/a | 77.4% | Small gain with honest noise; bigger expected on ambiguous drags |
| Hidden factor, drags only | 69.0% | 68.7% (68.4% none) | Words are needed to find new factors |
| Noisy pilot (τ = 5): per-gesture vs per-pair weighting | n/a | 72.2% vs 70.2% | Normalise per gesture |

These are small, early benches; the numbers will be retuned on real drag logs (step 7).

## 6. Build plan

Each step is described in full and approved before it starts. Every step runs `npm run check` before commit and
`npm run ci-status` after push.

1. **Make drags stick and stop the wrong messages.** Placement layer (§4.1) in `ResultsView`, with undo and "clear
   manual order". Count a repeated drag. Report only relative changes in the toast. Keep the cap in the fit's score.
   - *Done when:* in the browser, a dragged line stays put, undo works, and the message never lists rescaled factors.
   - Unit tests for the placement merge.
   - **Built Nov 6** (`lib/line-placements.ts`). A drop swaps the two lines, as the app always meant it to. A placement
     keeps the pilot's order of the lines from the dropped one to its target, so a brain that has since learned the swap
     never flips it back. The pilot gets "Undo" on the message, "Undo last swap", and "Back to Line Select's order"
     (which keeps what was learned). Undo takes back the swap's choices too (tagged `dragId`). A later swap of the same
     two lines replaces an opposite earlier one. Pairs a dealbreaker decides are left out of the fit and named in the
     message. Changes are reported by share of weight (`shareChanges`).
   - Still to do: per-swap undo comes with the "What I've learned" panel (step 5). The judgments a swap makes are still
     "moved line beats each line it passed"; step 2 revisits them, since a swap also puts the target below the lines
     between.
2. **The new learner** (`src/lib/brain/reorder-learner.ts`): Newton/Laplace Bayesian Bradley–Terry (§4.2), with gesture
   weighting and lapse, behind the same interface as the fit. Bring the drag lab into `scripts/eval/` (private data
   stays in `private/`).
   - *Done when:* it beats today's fit on the synthetic bench and is no worse on his real order and every saved persona.
3. **"Why it moved"** (`explainSwap`, §4.3) plus the new toast wording.
   - *Done when:* unit tests confirm the shares add up to the gap, and his 1010/1003 drag reads back the table above.
4. **The one question** (§4.4).
   - The chip card; the information-gain gate; frequency limits; answers as evidence; free text through Claude mapped to
     the catalog or a proposed new criterion.
   - Costs about a cent per free-text answer.
   - *Done when:* simulated pilots learn the hidden factor when they name it, and do not when they say "about equal".
5. **Memory** (§4.6). Drag log with snapshots, the learned offset carried across months with decay, the "this month"
   layer, and the "What I've learned" panel.
   - Needs a Neon migration, applied before the deploy, only with the owner's OK.
6. **Fleet priors** in the nightly learning run, with the existing promotion gate.
7. **Measure and tune** on real drags:
   - prediction of the next drag;
   - drags needed per month (should fall);
   - undo rate and "not why" rate;
   - retune τ, ε, prior width and gesture weights;
   - threshold learning (H2) if logs show "one bad thing" drags.

## 7. Decisions for the owner

- Should a drag stick even when the brain disagrees? (Recommended: yes; it's the pilot's bid.)
- How often may the app ask "why"? (Recommended: at most once per 5–8 drags, never twice for the same pair.)
- Should free-text reasons use Claude? (Recommended: yes, a cheap model, about a cent each.)
- Should drag learning be on by default, with a switch to turn it off? (Recommended: yes.)

## 8. Key references

- Joachims et al., *Accurately interpreting clickthrough data*, 2005/2007.
- Cao et al., *Adapting Ranking SVM*, 2006.
- Chu & Ghahramani, *Preference learning with GPs*, 2005.
- Guo & Sanner, *Real-time multiattribute Bayesian preference elicitation*, 2010.
- Viappiani & Boutilier, *Optimal Bayesian recommendation sets*, 2010.
- Houlsby et al., BALD, 2011, and collaborative GP preference learning, 2012.
- Greco, Mousseau & Słowiński, UTA-GMS, 2008.
- Wall et al., *Podium*, VAST 2017.
- Basu, Singhal & Dragan, *Feature queries*, HRI 2018.
- Bıyık et al., *Asking easy questions*, 2019.
- Christiano et al., 2017.
- Rafailov et al., DPO, 2023.
- Bose et al., LoRe, 2025.
- Lundberg & Lee, SHAP, 2017.
- Pliatsika et al., ShaRP, 2024.
- Miller, *Explanation in AI*, 2019.
- Ahuja & Orlin, *Inverse optimization*, 2001.
- Viappiani, Faltings & Pu, 2006.
- Bobu et al., misspecification 2020, and FERL 2021.
- Handa et al., OPEN, 2024.
- Choudhury et al., BED-LLM, 2026.
- Gao et al., PRELUDE/CIPHER, 2024.
- Gilbride & Allenby, 2004.
- Yee, Dahan, Hauser & Orlin, 2007.
- Ranyard et al., 2020.
- Agranov & Ortoleva, 2017.
- Hall et al., choice blindness, 2010.
- Kőszegi & Rabin, 2006.
- Sawtooth CBC/HB technical paper.
- 1000minds PAPRIKA.
- Eagle QuickBid help.
- Airbnb search ranking papers, 2018–2024.
- Google PAIR Guidebook, *Feedback + Control*.
- Microsoft, *Guidelines for Human-AI Interaction*, 2019.
- Mozilla YouTube controls study, 2022.
