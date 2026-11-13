# Billing gating plan — which features are free vs paid

**Status: proposal. Nothing is enforced yet.** Every account still gets 100% of
the product because `FREE_FOR_ALL = true` in [`src/lib/server/stripe.ts`](../../src/lib/server/stripe.ts).
This document is for the owner to decide the free/paid split. Flipping the flag
is the owner's call — see "Turning it on" at the end.

## How the gate works

Three pieces, already wired:

1. **`hasProAccess(user)`** in `src/lib/server/stripe.ts` — the single question
   "is this pilot a paying member?". Today it returns `true` for everyone
   (`FREE_FOR_ALL`). When the flag is `false` it returns `true` only for a pilot
   whose `users.plan` is `"pro"`, which the Stripe webhook keeps in step with
   their subscription (`trialing`/`active` → pro, anything else → free).

2. **`src/lib/server/gating.ts`** — the list of paid features (`PRO_FEATURES`)
   and two helpers:
   - `proFeatureRefusal(user, feature)` → a `402 Payment Required` response for a
     non-member, or `null` to let them through. Used at a route's entry point,
     the same shape as the existing `crossSiteRefusal` / `confirmEmailRefusal`.
   - `canUseProFeature(user, feature)` → a boolean, for UI that hides or labels a
     Pro panel.

3. **The gates themselves** — a `proFeatureRefusal(...)` call right after the
   sign-in check in each paid feature's server route.

While `FREE_FOR_ALL` is on, every gate returns `null`, so all of this is a no-op
at runtime. Gates can therefore be wired ahead of the decision to charge, and
flipping the flag turns them all on at once with no further code change.

## Recommended split

The goal is a free tier that delivers the core promise — "rank my bid lines" —
well enough that a pilot sees the value, with the daily-driver power features and
the LLM-cost features behind membership.

### Free (the whole point of the app stays free to try)

| Feature | Why free |
| --- | --- |
| Sign up, sign in, account, email confirm | No funnel without it |
| Upload a bid pack, parse it | Required to see any value |
| Ranked results / line list / line cards | The core promise; this is what earns the subscription |
| Preferences + the interview | How the ranking learns; gating it would gut the free experience |
| `/membership`, `/pricing`, Stripe checkout & portal | Must be reachable by a free pilot |
| `/contract` section lookup (`contract/section`) | Cheap, no LLM |

### Paid (`PRO_FEATURES`)

| Key | Feature | Server entry point(s) | Why paid |
| --- | --- | --- | --- |
| `trade-board` | Trade board + trade matching | `POST /api/trades`, `POST /api/trades/matches` **(wired)** | Flagship differentiator vs Acrobid; cross-pilot, high value |
| `open-time` | Open-time scoring | `/open-time` (currently a page; add a server route or gate the server action when one exists) | Premium, compute-heavy |
| `contract-chat` | Ask the Contract (the LLM chat) | `POST /api/contract/ask` | Real per-call LLM cost (~¼¢ each); abuse/denial-of-wallet surface |
| `calendar-feed` | Live calendar subscription | `POST /api/calendar-feed` (the *manage* route only — never the `GET /api/calendar/[token]` the calendar app polls) | Convenience; ongoing sync cost |
| `send-to-vips` | Send your bid to VIPS | the send route/action | The premium "do it for me" action |

Only the `trade-board` gates are wired in this change, as a worked example. The
rest are listed so the owner can confirm the split before more routes change —
each is then a two-line edit (see below).

### Explicitly undecided / owner's call

- **Contract chat free as a teaser?** It currently allows guests (`DAILY_GUEST`).
  Gating it means requiring sign-in there too. Could stay a limited free teaser.
- **Calendar feed** — arguably a cheap retention feature worth leaving free.
- **Award history / "who held what"** — not in the list above; add if desired.

## Adding a gate to a feature

1. Add the feature to `PRO_FEATURES` in `src/lib/server/gating.ts`.
2. In the feature's server route, right after the sign-in check:

   ```ts
   import { proFeatureRefusal } from "@/lib/server/gating";
   // …
   const gated = proFeatureRefusal(user, "open-time");
   if (gated) return gated;
   ```

3. Have the client treat `402` as "show the membership prompt" (the body carries
   `{ error, feature, upgrade: "/membership" }`).

## Turning it on (owner's decision)

1. Confirm the split above.
2. Finish wiring the remaining gates (small edits).
3. In `src/lib/server/stripe.ts`, change `const FREE_FOR_ALL = true` to `false`.
4. From that moment, a pilot needs a `pro` plan (live trial or active paid
   subscription) for every gated feature. The 30-day trial means a pilot who
   just signed up through checkout is `pro` immediately; a pilot who never
   subscribed is `free` and hits the gates.

Do **not** flip the flag until the owner has decided the split and the gates are
in place.
