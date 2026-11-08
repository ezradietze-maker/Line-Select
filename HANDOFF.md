# Line Select — Handoff / Status Notes

Written 2026-09-12 so a fresh Claude Code session (new machine) has full context immediately; last corrected 2026-11-08. Delete this file once you no longer need it, or keep it updated as things change.

**This file lives on GitHub, so it's readable from any phone or computer's browser** at:
`https://github.com/ezradietze-maker/Line-Select/blob/main/HANDOFF.md`
— even before you have Git or Node installed on a new machine. Bookmark that URL.

## Device migration checklist (Windows → new MacBook, via iPhone as a bridge)

**Secrets note:** never put real API key values in this file or any file in this repo — `.env.local` is git-ignored on purpose. Keys belong in a password manager only (see below).

### Before wiping the old machine
1. Copy the values out of the local `.env.local` file (see "Environment variables" below) into an encrypted password manager (iCloud Keychain, 1Password, Bitwarden — not a plain note or email). Give each its own entry.
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
4. Create `.env.local` in that folder and paste in the values from your password manager (see "Environment variables" below).
5. Run `npm run dev`, open `http://localhost:3000`, confirm it works.
6. Log into Vercel in a browser with the same account — the project is already connected to this GitHub repo, nothing to reconnect.
7. Start a new Claude Code session in that folder and say **"read HANDOFF.md"** to get it fully caught up.
8. Optional but recommended once settled: regenerate both API keys (new key in each console → update `.env.local` and Vercel's environment variables → delete the old key) — cheap insurance since these values passed through a chat conversation at one point during setup. While in there, also rotate the four Upstash-created Vercel vars flagged "Needs Attention" (`KV_REST_API_READ_ONLY_TOKEN`, `KV_REST_API_TOKEN`, `KV_URL`, `REDIS_URL`) and re-save them as Secret type so their values aren't visible in the dashboard.

## What this project is
"Line Select" — a Next.js app that lets FedEx pilots upload their bid pack PDF, answer an adaptive AI-driven preference interview, and get every line in the pack scored/ranked against their own preferences (the "Satisfaction Index"). Also includes a Strategies board, Trade Board, Inbox, and Hotel Ratings. Not affiliated with FedEx.

## Environment variables
Names only; values live in your password manager and in Vercel, never in this repo.
`ADMIN_API_KEY`, `AERODATABOX_API_KEY`, `ALERT_EMAIL`, `ANTHROPIC_API_KEY`, `APP_URL`, `ASSEMBLYAI_API_KEY`, `BRAIN_MODEL`, `CRON_SECRET`, `DATABASE_URL`, `DEVICE_COOKIE_SECRET`, `EMAIL_FROM`, `FLEET_NOTES`, `FLIGHT_BOARD_USD`, `GOOGLE_PLACES_API_KEY`, `HOTEL_SITE_DAILY_LOOKUPS`, `INTERVIEWER_MODEL`, `INTERVIEW_MODEL`, `KV_REST_API_TOKEN`, `KV_REST_API_URL`, `NEXT_PUBLIC_POSTHOG_HOST`, `NEXT_PUBLIC_POSTHOG_KEY`, `PILOT_HASH_SECRET`, `POSTGRES_URL`, `RESEND_API_KEY`, `UPSTASH_REDIS_REST_TOKEN`, `UPSTASH_REDIS_REST_URL`

Set `TEST_DATABASE_URL` only to run `src/lib/server/db.test.ts`, against a database that isn't the live one (migrate it first with `DATABASE_URL=<that url> npm run db:migrate`). Without it those tests skip. **Local dev still uses `.env.local`'s `DATABASE_URL`, which is the live Neon database**, so anything done on localhost touches real data.

## Current state
- Deployed and live at **https://line-select.vercel.app**, auto-deploying from `origin/main` on GitHub (`ezradietze-maker/Line-Select`).
- Every push to `main` deploys, so run `npm run check` before committing and `npm run ci-status` after pushing (see `CLAUDE.md`).
- A small beta of 3-5 FedEx pilots is being prepared.

## Beta-readiness checklist — status
1. **PDF parser tested against real bid packs** — DONE for the packs tried so far; see the parser tests and `private/` for the real packs used.
2. **Deployment** — DONE.
3. **Terms of Service / Privacy Policy** — DONE, live at `/terms` and `/privacy`, with a required checkbox at signup. The operator is named and the contact address is real. The Privacy Policy was checked line by line against the code on 2026-11-08; any change to what's stored or sent must update it.
4. **Accounts the owner must finish before real pilots** — not done yet: Resend sending domain and `EMAIL_FROM`; Vercel Pro (Hobby is non-commercial); Open-Meteo commercial plan; Neon paid plan with backups and one practised restore; AssemblyAI paid plan and training opt-out; Anthropic Console spend limit; Vercel's pause at the spending limit. Four Upstash variables (`KV_REST_API_READ_ONLY_TOKEN`, `KV_REST_API_TOKEN`, `KV_URL`, `REDIS_URL`) are also plain variables rather than Secret type: rotate them at Upstash and re-save as Secret.
5. **Spending** — DONE in code: `src/lib/server/spend-guard.ts` puts a daily dollar ceiling on the AI, dictation, hotel and flight lookups, for the site and for each pilot, and `rate-limit.ts` limits requests.
6. **LLC / business entity** — Not formed. Flagged as the single highest-leverage thing for actual lawsuit protection, but the owner has decided not to block the beta on this.

## Architecture notes for a fresh session
- Real Next.js App Router routes (not a single-page client switcher) — see `src/lib/app-state.tsx` (shared state/handlers) and `src/components/app/AppShell.tsx` (persistent nav/chrome).
- Bid pack PDF parsing lives in `src/lib/pdf-parser/` — `index.ts` is the entry point (`parseBidPackPdf`).
- A guest's bid pack and preference profile are stored in browser localStorage only. A signed-in pilot's are also stored on the server (`bid_packs`, `preference_profiles`) so they follow the account. The PDF itself is never stored.
- **2026-09-28: server-side data moved off a single Redis JSON blob onto real Postgres** (Vercel Storage → Neon; see `src/lib/server/schema.ts`, `postgres.ts`, `db.ts`). Accounts, sessions, password reset tokens, Trade Board offers, bid packs, preference profiles, feedback, candidate variables, award-history reports, shared forecast rankings, and the fleet learning's tables all live in real tables now — unique constraints and atomic conditional updates (`updateTradeOffer`'s `expectedStatuses`, the forecast-ranking upsert) are what actually stop two concurrent signups or trade responses from corrupting each other; the old blob could only ever guess via a read-modify-write. **Requires `DATABASE_URL` (or `POSTGRES_URL`) to be set** — there's no local-file fallback for this one, unlike `kv.ts` below. Run `npm run db:generate` after changing `schema.ts`, then `npm run db:migrate` to apply.
- `kv.ts` (Upstash Redis in production, local JSON files in dev) is still used, deliberately, for genuinely ephemeral/TTL data only: rate-limit and spending counters, the hotel and flight-board caches, interview drafts, and recent profile versions.
- Rate limiting (`src/lib/server/rate-limit.ts`) covers every route that costs money or creates accounts, and most others. Login has its own failed-attempt limiter (don't duplicate it).

## If picking this up fresh, good next steps
1. Finish the accounts in item 4 above.
2. Read `private/plans/` for the current plan.
