# Line Select — Handoff / Status Notes

Written 2026-09-12 so a fresh Claude Code session (new machine) has full context immediately. Delete this file once you no longer need it, or keep it updated as things change.

**This file lives on GitHub, so it's readable from any phone or computer's browser** at:
`https://github.com/ezradietze-maker/Line-Select/blob/main/HANDOFF.md`
— even before you have Git or Node installed on a new machine. Bookmark that URL.

## Device migration checklist (Windows → new MacBook, via iPhone as a bridge)

**Secrets note:** never put real API key values in this file or any file in this repo — `.env.local` is git-ignored on purpose. Keys belong in a password manager only (see below).

### Before wiping the old machine
1. Copy the two values out of the local `.env.local` file (`ANTHROPIC_API_KEY`, `GOOGLE_PLACES_API_KEY`) into an encrypted password manager (iCloud Keychain, 1Password, Bitwarden — not a plain note or email). Give each its own entry.
2. Confirm you can log into, with working 2FA: **GitHub** (`ezradietze-maker`), **Vercel**, **Google Cloud Console**, **Anthropic Console** (`console.anthropic.com` — separate from the Claude phone app; same login isn't guaranteed).
3. Save any 2FA backup/recovery codes shown during setup into the same password manager.
4. Confirm the repo has nothing uncommitted or unpushed: `git status` should say clean and up to date with `origin/main`.
5. Verify the password manager backup by opening it on your **phone** and confirming both key values are actually there and readable.

### On the new MacBook, once you have it
1. Install **Claude Code**; sign in with your Anthropic account (this restores your account, not this specific chat's memory — that's what this file is for).
2. Open Terminal, run `xcode-select --install` (gives you Git), then install [Node.js](https://nodejs.org) (LTS).
3. Clone the project:
   ```bash
   git clone https://github.com/ezradietze-maker/Line-Select.git
   cd Line-Select
   npm install
   ```
4. Create `.env.local` in that folder and paste in both key values from your password manager:
   ```
   ANTHROPIC_API_KEY=...
   GOOGLE_PLACES_API_KEY=...
   ```
5. Run `npm run dev`, open `http://localhost:3000`, confirm it works.
6. Log into Vercel in a browser with the same account — the project is already connected to this GitHub repo, nothing to reconnect.
7. Start a new Claude Code session in that folder and say **"read HANDOFF.md"** to get it fully caught up.
8. Optional but recommended once settled: regenerate both API keys (new key in each console → update `.env.local` and Vercel's environment variables → delete the old key) — cheap insurance since these values passed through a chat conversation at one point during setup.

## What this project is
"Line Select" — a Next.js app that lets FedEx pilots upload their bid pack PDF, answer an adaptive AI-driven preference interview, and get every line in the pack scored/ranked against their own preferences (the "Satisfaction Index"). Also includes a Strategies board, Trade Board, Inbox, and Hotel Ratings. Not affiliated with FedEx.

## Current state (as of this file's date)
- Deployed and live at **https://line-select.vercel.app**, auto-deploying from `origin/main` on GitHub (`ezradietze-maker/Line-Select`).
- Local repo and `origin/main` are in sync — nothing uncommitted, nothing unpushed, as of this writing.
- A real beta (scoped to MEM-domicile pilots) is being planned.

## Beta-readiness checklist — status
1. **PDF parser tested against real bid packs** — DONE for the beta's actual scope. Tested against 6 real bid packs across 5 aircraft types and 3 bases (A300/B757/B767/MD11 at MEM, B767 at IND, B777 at ANC). All 4 MEM packs — the beta's actual scope — parse with zero warnings across ~1382 real lines. Three real parser bugs were found and fixed this way (see git log: "Fix bid pack parser gaps...", "Fix the last B767 MEM matching gap..."). Not tested: other bases, other months, malformed/edge-case exports.
2. **Deployment** — DONE. Confirmed live and matching the latest commit by direct testing.
3. **Terms of Service / Privacy Policy** — DONE, live at `/terms` and `/privacy`, with a required checkbox at signup (not just a footer link — this matters for the arbitration/liability clauses to actually be enforceable). **Three placeholders still need real values** before pilots should be relying on them: operator name/entity, governing-law state, and real contact emails (currently `legal@lineselect.app` / `privacy@lineselect.app` as placeholders). Search both page files for bracketed text.
4. **Environment variables in production** — **UNCONFIRMED, check this next.** Only two secrets are needed: `ANTHROPIC_API_KEY` and `GOOGLE_PLACES_API_KEY`. Verify both are set in Vercel → Project Settings → Environment Variables. If Redis/Upstash isn't configured there, the app falls back to local-file KV storage, which does **not** persist reliably on Vercel's serverless filesystem — rate limiting and hotel caching need a real Redis connection in production (`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` or Vercel KV's `KV_REST_API_URL`/`KV_REST_API_TOKEN`).
5. **Cost/budget plan** — NOT DONE. No spend alerts configured on the Anthropic or Google Cloud accounts yet. Worth doing before the beta gets real traffic.
6. **LLC / business entity** — Not formed. Flagged as the single highest-leverage thing for actual lawsuit protection (separates personal liability from the business), but the user has decided not to block the beta on this.

## Architecture notes for a fresh session
- Real Next.js App Router routes (not a single-page client switcher) — see `src/lib/app-state.tsx` (shared state/handlers) and `src/components/app/AppShell.tsx` (persistent nav/chrome).
- Bid pack PDF parsing lives in `src/lib/pdf-parser/` — `index.ts` is the entry point (`parseBidPackPdf`).
- A pilot's bid pack and preference profile are **always** stored in browser localStorage only, never on the server, regardless of account status (this is accurately reflected in the Privacy Policy after a correction this round).
- Server-side data (Postgres-free — uses a small `kv.ts` abstraction backed by Upstash Redis in production, local JSON files in dev): accounts/sessions, Trade Board offers, anonymous award-history reports, and rate-limit counters.
- Rate limiting (`src/lib/server/rate-limit.ts`) covers signup, the interview, hotel lookups, bid-pack parsing, and preference classification. Login has its own, older, account-scoped failed-attempt limiter (don't duplicate it).

## If picking this up fresh, good next steps
1. Confirm item 4 above (production env vars) — the single most likely silent failure point.
2. Fill in the ToS/Privacy placeholders once the user provides real values.
3. Set up basic spend alerts (item 5).
4. Everything else (parser correctness, deployment, ToS/Privacy structure) is genuinely solid — don't re-litigate it without new evidence.
