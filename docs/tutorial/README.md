# Tutorial video: how it's made, and how to re-record a chapter

The tutorial at `/tutorial` is 16 short narrated chapters. Each is one MP4 in `public/tutorial/` (`chNN.mp4`), with
captions (`chNN.vtt`) and a poster frame (`chNN.jpg`). The chapter list the page shows is `src/lib/tutorial.ts`.

- **Words.** The narration is the approved script, [script.md](script.md): each chapter's quoted paragraphs, in order.
- **Picture.** The scripts in `scripts/tutorial/` drive a headless Chromium through the real site, one paragraph per
  shot.
- **Voice.** The voice is Deepgram's Aura-2 "orion".

## Setup (once)

1. **Make the work folder.** It's outside git, `.tutorial-work/` at the project root, or set `TUT_WORK`. Install the
   two tools only this needs:

   ```bash
   mkdir -p .tutorial-work && cd .tutorial-work && npm init -y && npm install playwright-core@1.58.2 ffmpeg-static@5.2.0
   ```

   playwright-core 1.58 drives the Chromium build already cached in `~/Library/Caches/ms-playwright`.
2. **Serve a copy of the site with no live services.** Build a copy without `.env.local`, and give it a throwaway local
   database:
   - **Database:** a PGlite server on `127.0.0.1:55433`, migrated with the project's `drizzle/` folder.
   - **Keys:** only `ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY` and `AERODATABOX_API_KEY` from `.env.local`.
   - **Left unset:** Redis, PostHog, email and Stripe.

   It must be on `http://localhost:3031`, or set `TUT_BASE`. Never record against the live site or the live database.
3. **Point at the real pack:** `export TUT_PDF=/path/to/2026_Oct_B767_MEM.pdf`. Bid packs stay out of git.

## Recording

**Order.** Run `ch02` first. It starts a fresh database (`dbctl.mjs fresh`), creates the demo account, uploads the
pack and saves `state/after-upload.json`. Then run `ch03`, the interview. It saves `state/after-interview.json` and the
database as `after-interview` (`dbctl.mjs save after-interview`). Every later chapter restores both before it starts,
so nothing one chapter does carries into the next: a swap that teaches the account, an award logged, a ticked
checklist. The demo pilot is bid #48 of 506 (seniority 1908), senior enough that the top lines are holdable, with a
week of vacation in the bid month.

**Clock.** The browser runs on Memphis time, with its clock set to two days before October's bid closes
(`demo.mjs`), so the countdown runs. A chapter can pass another moment to `setClock`. The server keeps real time.

```bash
node scripts/tutorial/ch05.mjs        # records rec/ch05: timed frames and a mark where each paragraph starts
node scripts/tutorial/assemble.mjs ch05   # out/ch05.mp4 and out/ch05.vtt, the voice laid on at the marks
```

- **Split chapters.** Chapters 4 and 16 are filmed in two parts: a guest for quick start and the sample pack's example
  offer, the demo account for the rest. Join the parts with `node scripts/tutorial/merge.mjs ch04 ch04a ch04b` before
  assembling.
- **Holds.** Where a paragraph's voice runs longer than its shot, the picture holds still until the voice catches up.
  `assemble` prints how many seconds it held; more than a couple means the shot needs more action or a longer
  `hold()`.
- **The narration.** `node scripts/tutorial/tts.mjs orion [chapter]` makes it from script.md, about 40¢–90¢ for the
  whole script. Once the voice exists, recordings pace each shot to its paragraph's real length.
- **One voice throughout.** The owner chose Orion, and asked that he sound the same the whole way through. So
  every paragraph is levelled to the same loudness and trimmed to the same short pause at each end. A take spoken
  more than 6% off his usual pace is voiced again, keeping the closest take; if that's still off, its tempo is evened out
  without changing his pitch (`tts.mjs orion --repace` does just that step on voice already made). Re-voice the whole script in one pass when
  you can. A single chapter is held to the pace saved by the last full run (`voice/pace-orion.json`).
- **Chapter 7's commute filter** checks real flights, and the flight route allows 20 lookups an hour. A take run within
  an hour of another can come back "paused" with nothing known. The script prints a WARNING when that happens: record
  it again later. The boards are cached on the server, so the next take is quick and nearly free.
- **Chapter 13, and chapter 14's Pay check,** move the browser's clock to Oct 27, when the award is out and the month is
  nearly flown. The commute planner only looks up trips still to come, so chapter 14 changes the clock just before Pay check.
- **The faked clock and animations.** After a long stretch on one page, the faked clock can leave a framer-motion fade
  stuck at invisible on the next page (chapter 1's rankings stayed blank). Switching to reduced motion first fixes it.
- **Words the voice misreads** are respelled for the voice only in tts.mjs's `SAY` list, so the captions keep the
  written form. Rewording the script is the other fix.

## Cost of a full re-record

- The interview chapter runs the live interviewer, about $1 a take.
- Ask your pack, Ask the Contract and Tell us something new cost a cent or two each.
- The first visit to Hotel Ratings looks up every hotel in the pack on Google, up to about $2. Later visits are cached
  on that server.
- Everything else is free.

## Publishing

Copy each finished `out/chNN.mp4` and `out/chNN.vtt` into `public/tutorial/`. Make a poster with
`ffmpeg -ss 3 -i chNN.mp4 -frames:v 1 -vf scale=1280:-1 chNN.jpg`. Update the chapter's `seconds` in
`src/lib/tutorial.ts`.
