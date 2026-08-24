# Line Select

An early-stage prototype that ranks FedEx cargo pilot bid lines against a
pilot's stated preferences, so they don't have to manually compare dozens of
lines from a raw bid pack by hand.

**This is an independent, unofficial tool.** It is not affiliated with,
endorsed by, or connected to Federal Express Corporation in any way.

## What it does

1. **Bid pack upload & parsing** — a pilot uploads their bid pack PDF and the
   app extracts real line and trip data directly from it. It parses two page
   types only: pairing schedule pages (individual trips) and line grid pages
   (per-line totals + calendar). Every other page type — vacation schedules,
   seniority lists, training rosters, or anything else listing named
   individuals — is detected by its header and **never parsed, stored, or
   displayed**, since it contains other pilots' personal employment data that
   this app has no reason to touch.
2. **Preview & confirm** — before anything is scored, the pilot sees a
   summary of what was found (how many lines, from how many pairing pages,
   which seat) and any parsing warnings, and confirms it looks right. If the
   PDF can't be read (wrong file, scanned image, unrecognized layout), a
   specific error is shown instead of silently producing bad data.
3. **Preference interview** — a 21-question adaptive interview, built around
   what actually varies in a real bid pack:
   - **Commuter check** (first question): commuting vs. local isn't scored on
     its own, but raises the effective importance of report time and trip
     count even if a pilot leaves those sliders near neutral — an early/late
     report or an extra trip costs a commuter a hotel night or a missed
     flight home.
   - **Six quick sliders**: days off, trip length, trip count (separate from
     trip length — a commuter's real lever), domestic vs. international,
     report time, lean line vs. max credit.
   - **Optional deeper round**: a deadhead-tolerance slider; a Northeast vs.
     Southeast Asia layover-region slider (only asked when a pilot's own bid
     pack actually has both — e.g. HKG/ICN/KIX vs. SIN/BKK/CGK); three
     "pin an exact target" sliders in real units (days off, credit hours,
     trip count) instead of a rough slider midpoint; a **city preference
     picker** built from the actual layover cities in the pilot's own bid
     pack, letting them flag specific cities as favorites or ones to avoid;
     and eight "would you rather" trade-off questions that nudge the slider
     weights.
   - A **confirmation screen** after the interview shows a plain-English
     summary of what was heard, ranked by importance, with every slider
     still live to adjust before anything is scored.
4. **Scoring engine** — normalizes each line's real attributes (days off,
   trip length, trip count, international share, Asia region mix, report-time
   lean, deadhead legs, credit hours) to a 0-1 scale, plus a city-preference
   score built from the pilot's flagged favorite/avoid cities, compares them
   against the pilot's targets (explicit targets and commuter-driven
   importance floors take priority over the rough midpoint a slider alone
   implies), and produces a weighted 0-100 match score per line.
5. **Results view** — lines ranked by score, each with a one-line
   auto-generated explanation of why it scored the way it did, and an
   expandable detail view with per-dimension match bars and a readable
   trip-by-trip breakdown.
6. **Accounts** — real, server-verified sign-up/log-in (email + password),
   backing the Trade Board below. Passwords are hashed with Node's built-in
   `scrypt` (a salt per account, timing-safe comparison on login) via API
   routes under `app/api/auth/`; sessions are an opaque token in an
   HTTP-only cookie, checked against a server-side session store. Accounts
   and sessions live in a JSON file on the dev server's disk
   (`lib/server/db.ts`) — a real, shared, prototype-grade store, not a
   production database, but genuinely visible across devices hitting the
   same server (unlike the interview/preferences data below, which stays
   local per-device). Guests (no account) still get their preferences and
   bid pack saved locally under a separate guest key, but can't post or
   respond to trade offers.
7. **Trade Board** — a coordination tool for finding another pilot to trade
   with, not a binding trade system. A pilot posts an offer (one of their
   own lines, optionally a specific line wanted back, an optional note);
   another pilot proposes a counter-line; the offering pilot accepts or
   declines. Status (open/pending/accepted/declined/withdrawn) is visible to
   both sides. The non-binding disclaimer is permanently visible on the page
   itself — not a modal — and an accepted trade shows "Agreed — now file
   this through the official trade process to make it real," never language
   implying the trade is in effect. Offers are scoped to the poster's bid
   pack (base/aircraft/seat/month) so pilots don't see irrelevant trades
   from a different base or month.
8. **Left navigation** — a persistent sidebar (Upload Bid Pack, Preferences,
   My Rankings, Trade Board, Inbox, Hotel Ratings, How this works), plus
   theme toggle and account menu. Collapses into a slide-in drawer behind a
   hamburger button below the `md` breakpoint.
9. **Preferences screen** — the landing page for the Preferences nav item.
   Shows a plain-English summary of a pilot's saved answers (or a prompt to
   upload a bid pack / take the interview if they haven't yet), with a
   button to retake it.
10. **"Here's what we heard" confirmation** — shown right after the interview
   finishes, before anything is scored: a one-sentence plain-English summary
   ranking what the pilot said they care about most (e.g. "You care most
   about wanting close to 16 days off, then flying short trips, then getting
   international trips"), with every slider still live so they can nudge an
   answer that's off without redoing the whole interview. Nothing is saved
   until "Show my rankings" is pressed.
11. **Demo offers on the Trade Board** — since there's no real pilot traffic
   yet, a synthetic "Demo"-badged offer rotates into the open-offers list
   every 15-20 seconds, built from real lines in the pilot's own bid pack so
   the numbers look legitimate. It's client-side only (`lib/fake-trade-offers.ts`)
   and never touches the server or another pilot's screen. Accepting one
   skips the normal propose-a-counter-line flow (a single "Accept" resolves
   it immediately) and shows the same "Agreed" state a real accepted trade
   would, so the flow is easy to see working before there's real activity to
   show instead.
12. **Inbox** — a nav item separate from the Trade Board surfacing three
   things: proposals waiting on the pilot's own posted offers ("needs your
   response"), offers from other pilots who specifically asked for a line
   the pilot currently has open ("direct interest in your lines"), and any
   of the pilot's own trades — as offeror or responder — that reached
   "Agreed." Demo offers appear here too when relevant, still clearly
   badged.
13. **Unread badge + toast notifications** — the Inbox nav item shows a
   small red count of unread items (anything in "needs your response" or
   "direct interest" the pilot hasn't opened the Inbox to see yet).
   Browsing the Trade Board shows the same offers but deliberately doesn't
   clear the badge — opening the Inbox is the one action that counts as
   "checked." A brand-new arrival — real or demo — also pops a dismissible
   toast in the bottom-right corner ("New trade request&hellip;"), skipped
   only while already on the Inbox itself. Real trade offers are polled from
   the server every 10 seconds so this reacts to another pilot's activity,
   not just the local demo rotation.
14. **Hotel Ratings** — the *specific* hotel a pilot would actually stay at,
   not a generic "hotels near this airport" search. Every pairing schedule
   page prints a `Hotel:` line for each overnight layover (e.g. "Hotel:
   WHITE SWAN (CAN)"), which the parser now captures alongside the layover
   city (`Trip.layoverDetails`, `src/lib/pdf-parser/pairing-parser.ts`) and
   looks up by name on Google Places — rating, review count, price level,
   address, a link to Google Maps. Shows up two places: inline in a line's
   trip-by-trip detail (each layover next to its hotel and rating) and on
   the standalone Hotel Ratings page, grouped by the real distinct hotels
   found across the whole bid pack — most-used first, each showing which
   lines stay there. Requires a `GOOGLE_PLACES_API_KEY` (Places API (New),
   see "Running locally" below) — without one, both surfaces say so plainly
   instead of erroring. Results are cached to disk for 30 days per
   (airport, hotel name) pair (`lib/server/hotel-cache.ts`), and de-duplicated
   client-side too, so the same hotel — shared by dozens of lines — is only
   ever looked up once.

## Running locally

Requires Node.js 18.18+ (Node 20+ recommended).

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

### Hotel Ratings setup (optional)

Everything else works without this. To enable Hotel Ratings, create a
`.env.local` file in the project root (already gitignored — never commit
it):

```
GOOGLE_PLACES_API_KEY=your-key-here
```

The key's Google Cloud project needs **"Places API (New)"** enabled (the
legacy "Places API" isn't what this uses) and a billing account attached —
Places API requires one even within the free monthly credit. Restart
`npm run dev` after adding or changing the key, since Next.js only reads
`.env.local` at server startup.

Other useful scripts:

```bash
npm run build   # production build
npm run start   # run the production build
npm run lint    # eslint
```

### Opening it from another device on your network

Next.js's dev server blocks JS/CSS from loading when opened via a LAN IP
instead of `localhost`, as a safety default. If you need to test from a
phone or another computer on the same network, add that IP to
`allowedDevOrigins` in `next.config.ts` and restart the dev server:

```ts
const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.x.x"],
};
```

## Project structure

```
src/
  app/
    api/parse-bidpack/       POST route: receives an uploaded PDF, returns parsed bid pack(s) + warnings
    api/auth/                signup / login / logout / session routes (cookie-based sessions)
    api/trades/              GET list + POST create; [id]/respond, accept, decline, withdraw
    api/hotels/              GET route: cached Google Places (New) lookup for one airport code
  components/
    auth/                    Login / create-account screen
    hotels/                  Hotel Ratings screen — per-layover-city Google Places results
    interview/               Slider, target-slider, trade-off, commuter, and city-preference steps
    nav/                     LeftNav (persistent sidebar + mobile drawer), AccountMenu, ThemeToggle
    preferences/             Preferences summary/landing screen + post-interview confirmation screen
    results/                 Ranked results list, expandable line detail, score ring, "how this works"
    trade-board/             Trade Board (post/browse/respond/accept/decline/withdraw) + Inbox screen
    ui/                      Shared primitives (Slider, RangeSlider, Button, Modal, TextField, icons, ComingSoon, Toast)
    upload/                  Upload dropzone + parse preview/confirmation screen
    welcome/                 Landing screen
  lib/
    pdf-parser/              PDF parsing pipeline (see below)
    hotels/                  airport-names.ts — IATA code -> search-friendly airport name for Places queries
    server/                  Server-only: db.ts (JSON-file store), auth.ts (scrypt hashing, sessions), hotel-cache.ts (30-day Places cache)
    bidpack-storage.ts       Per-account localStorage read/write for the confirmed bid pack
    scoring.ts               Scoring engine (normalization + weighted match + explicit targets)
    interview-config.ts      Question copy, trade-off definitions, target-slider config
    preference-logic.ts      Combines slider weights with trade-off nudges, city-sentiment cycling
    preference-summary.ts    Ranks weights into the "here's what we heard" sentence
    auth.ts                  Client wrapper around the server auth API (fetch, not localStorage)
    trade-client.ts          Client wrapper around the server trade API
    fake-trade-offers.ts     Client-only synthetic Trade Board offers (demo data, never sent to the server)
    inbox.ts                 Shared "needs response / direct interest / accepted" filtering used by the Trade Board, Inbox, and unread badge
    hotel-client.ts          Client wrapper around the server hotel API
    storage.ts               Per-account localStorage read/write for the saved preference profile
    theme.ts                 Light/dark/system theme persistence + no-flash bootstrap script
  types/
    bidpack.ts               BidPack / Line / Trip types
    preferences.ts           PreferenceWeights / PreferenceProfile types
    auth.ts                  UserAccount / StoredCredential types
    trade.ts                 TradeOffer / LineSnapshot types
    hotel.ts                 HotelResult / HotelLookupResult types
```

### PDF parsing pipeline (`src/lib/pdf-parser/`)

- `text-extraction.ts` — wraps `pdfjs-dist`, mapping every text item through
  the page's viewport transform so rotated pages (bid packs print line-grid
  pages landscape/rotated 90°) reconstruct in correct reading order instead
  of scrambled nonsense. Also registers the pdfjs worker on
  `globalThis.pdfjsWorker` — Turbopack's server bundling breaks pdfjs's
  default relative worker path, so this short-circuits that lookup instead.
- `page-classifier.ts` — classifies each page from its header text into
  `pairing-schedule`, `line-grid`, `ignored-personal-data`, or
  `ignored-other`. Only the first two are ever parsed further.
- `pairing-parser.ts` — parses pairing schedule pages (two side-by-side
  columns, occasionally overflowing across the column break for unusually
  long pairings) into trip records: report time, layovers, deadhead legs,
  credit/block/TAFB hours, read from each pairing's own totals line rather
  than summed from ambiguous leg-row columns. Landings are computed by
  counting each pairing's own bare-digit-numbered flight legs (a company
  flight the pilot actually flies) rather than trusting the printed `LDGS:`
  field — that field prints `0` on a subset of real pairings regardless of
  how many legs were actually flown, which the leg-counting approach
  reproduces correctly on every pairing checked, including ones where the
  printed value was itself trustworthy. Each layover's specific assigned
  hotel is captured too, from the `Hotel: <name> (<code>)` line printed
  between a leg's "Trans To"/"Trans From" ground-transport lines — walked in
  printed order rather than pattern-matched as a leg, since it never looks
  like one, and attached to whichever layover immediately precedes it.
- `line-grid-parser.ts` — parses line grid pages (a calendar-style page
  where each line's block reliably carries a small pairing-reference number
  somewhere in its calendar cells). Rather than trusting a fixed text
  position for that reference — the layout shifts with how many days a
  pairing spans — it collects every plausible candidate number and
  self-verifies each one against the line's own printed
  credit/block/landings totals, only accepting a match when they agree.
  Candidate exclusion (skipping numbers already accounted for elsewhere in
  the block, like a checkout time) is done by character position rather
  than by value, since the same checkout-time digits can recur elsewhere in
  a block as an unrelated, genuine candidate. A short trip flown more than
  once in the same month (the same pairing's reference number appearing
  several times in one line's calendar) is counted with that multiplicity —
  its full credit/block/landings once per occurrence — rather than once
  total; a pairing found by its own sequence number (near-unique) is
  trusted directly, while one found only by a shared flight number (common
  across many unrelated pairings) still goes through the small-combination
  search below it. A pairing whose report date falls right at the edge of
  the bid period and carries into the next one isn't yet handled — those
  lines still fall back to the estimated-trip path.
- `build-bidpack.ts` — converts matched pairings into `Trip` objects. Lines
  whose calendar entries couldn't be confidently matched fall back to a
  trip built from the line's own real totals (credit, TAFB, landings — all
  exact) with neutral placeholders for the few fields only a matched pairing
  provides (layovers, report time, deadhead count, international mix); these
  lines are listed in `linesWithIncompleteTrips` so the UI can disclose it.
- `index.ts` — orchestrates the above into `parseBidPackPdf()`: classify
  every page, parse all pairing pages into one pool (order-independent),
  then parse all line-grid pages against that pool, per seat (CAP/F&#8203;O
  regular lines are usually both present in one PDF export).

## What this is not

- Not a predictor of what you'd actually be awarded given your seniority —
  it only compares stated preferences against line attributes.
- Not a scraper or live connection to any real FedEx system — it only reads
  the PDF a pilot explicitly uploads.
- Not a real authentication system — accounts, sessions, and password
  hashes all live in browser `localStorage` only. Clearing site data or
  switching browsers/devices loses the account and any uploaded bid pack.
- Not a perfect parser — real bid pack PDFs vary in layout, and pairing/line
  matching is a best-effort, self-verifying process. Lines that couldn't be
  confidently matched are disclosed on the preview screen and in the
  results, not silently guessed at.
