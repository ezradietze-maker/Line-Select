# Testing a change, at the least it costs

Every model call in a test is paid for. This is the order to test in: each step only when the ones before it can't
answer the question, and each paid step in its cheapest form. Measured Oct 2026, Sonnet 5.5 at high effort.

## 1. Free: re-score what's saved

A change to scoring, measures, the calendar, or anything after the brain has read an interview is free to test: the
saved readings don't change, only what's computed from them.

- The ex-pilot's sort and trip picks on his saved readings: `scripts/eval/expilot-sort.ts <reading tags…>` (lines only,
  with his picks, his five trip picks), `scripts/eval/expilot-benchmark.ts`.
- The simulated pilots on their saved interviews: `scripts/eval/trip-scorecard.ts` helpers (line and trip agreement
  against their judges), `scripts/eval/interview-quality.ts` (made-up words, invented limits, question mix).
- Unit tests.

## 2. A change to the brain's instructions: re-read, batched

Only the brain's new reading of an interview can say what a brain change does.

- **The ex-pilot's interview**: `scripts/eval/expilot-replay.ts <tag> --reads 8 --batch`. About $0.07 a read batched
  (from $0.16–0.21 one at a time: half price, and the whole interview cached between reads), back in about 10 minutes.
  - Compare against the stored readings of the brain as committed — they're already paid for.
  - **Two stages**: 8 reads first. If his sort moved 0.6 points or more either way, that's the verdict; otherwise read 8
    more. On resampled real reads this reached the same verdict as 16 reads every time a change was clear, and still runs
    16 when it isn't (one read varies by 0.6–1.0 points, so 16 can't see differences under ~0.3 anyway).
- **The simulated pilots**: `scripts/eval/brain-ab.ts <runs…>` reads saved simulated interviews with the committed brain
  and the working one, side by side on the same transcripts. Batched, and the committed brain's reads are kept and
  reused, so a comparison costs only the new brain's reads: about $0.07 × 9 transcripts.

## 3. A change to the interviewer: replay it on recorded turns

`scripts/eval/interviewer-replay.ts <runs…> [--every N]` asks the interviewer again at the turns of saved simulated
interviews — the recorded state of each turn (simulate.ts saves it), or rebuilt from the transcript for older runs —
batched. It measures what a change to the interviewer changes: the wording, made-up words, invented limits, examples,
length, side by side with what was asked before. A few cents a turn instead of about $1.50 an interview.

## 4. Only then: a fresh simulated interview

`scripts/eval/simulate.ts <persona> <tag>`, about $1.05–1.85 each. Needed for what only a whole interview shows: how one
turn leads to the next, pacing, and how well the ranking comes out at the end. One per simulated pilot is a check, not
a measurement — the ex-pilot sim's ranking has ranged 0.62–0.83 across runs of the same code — so judge accuracy from
paired reads (step 2), and use fresh interviews to see the flow. The spend line now splits brain, interviewer and pilot.

These can't be batched: each turn waits on the last, and a batch round takes minutes (7.5 for 8 calls, Oct 2026).

## Running live instead of batched

Without `--batch`, re-reads run the first read alone and the rest after it, so they read its cache instead of each
paying to write it (about $0.045 a read). Parallel cold starts were paying that on every read.
