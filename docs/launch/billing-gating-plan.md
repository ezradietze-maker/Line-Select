# Billing gating — what a membership unlocks

**Status: decided (17 Nov 2026), dormant.** Nothing is enforced while `FREE_FOR_ALL = true` in
[`src/lib/membership.ts`](../../src/lib/membership.ts). This replaces the earlier per-feature proposal
(`PRO_FEATURES` / `proFeatureRefusal` in `gating.ts`, now unused).

## The model

Whole-app membership, not per-feature paywalls (`src/lib/membership.ts`):

| Tier | Who | Access |
| --- | --- | --- |
| Grandfathered | Account made before `MEMBERSHIP_CUTOVER` | Everything |
| Free | One of the first `FREE_MEMBER_CAP` (15) new pilots to claim a spot (confirmed email) | Everything |
| Pro | Active or trialing subscription, $20/mo, first month free | Everything |
| Locked | Everyone else | Sign in, upload, the interview, their **top 10 ranked lines**, Ask the Contract teaser, membership pages |

## What's behind the wall

A locked pilot with a pack in sees their top 10 lines on Results, and `MembershipLocked` in place of each tool, and the server answers `402`
(`accessRefusal` in `src/lib/server/gating.ts`) on the routes behind them:

| Feature | Page wall | Server gate |
| --- | --- | --- |
| Ranked lines past the top 10 (`FREE_PREVIEW_LINES`), bid-order export, Send to VIPS | `/results` shows the top 10 and a membership note | — (ranking runs in the browser) |
| Bid forecast | via Results / Strategies | `POST /api/forecast` |
| Award history, who held what | via Results / Strategies / Logbook | `GET /api/award-history`, `GET /api/award-history/held-by` |
| Strategies | `/strategies` | — |
| Open Time | `/open-time` | — |
| Pay check | `/pay` | — |
| Logbook | `/logbook` | — |
| Tools | `/tools` | — |
| Hotel Ratings | `/hotel-ratings` | — |
| Trade Board and matching | — | `/api/trades/*` (saying no stays open) |
| Live calendar feed | — | `POST /api/calendar-feed` (never the `GET /api/calendar/[token]` a calendar app polls) |

Always open: sign up/in, upload and parse, the interview, preferences, `/membership`, `/pricing`, Stripe checkout
and portal, contract section lookup, and **Ask the Contract as a teaser** (its own rate limits: 5/day guest,
40/day signed in). Reporting your own award and deleting your data (award history, forecast sharing) also stay open.

The page walls are a screen, not security: ranking runs in the browser, so a technical user could get past the
Results preview. Accepted for launch.

## Turning it on

1. Set `MEMBERSHIP_CUTOVER` to the go-live moment, so every existing pilot is grandfathered.
2. Apply migration 0015 on production (`npm run db:migrate:prod`) and swap Stripe to live keys.
3. Flip `FREE_FOR_ALL` to `false`.
4. Update the Pricing page copy ("Nothing is held back for Pro yet").
