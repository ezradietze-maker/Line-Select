# External spend caps — owner setup before charging pilots

The app already caps its own spending. This doc covers the **external** dashboard
caps at Anthropic and Vercel that sit *behind* the app's guard as
belt-and-suspenders: if the app's own guard is ever bypassed — a bug, or Redis
going missing so the guard silently stops counting (now caught at startup by
`src/lib/server/env-assert.ts`, but set these anyway) — these stop the bill
before it runs away.

Both are owner-only actions in a billing dashboard. They can't be set from code,
so they live here as a checklist.

---

## What the app already caps (for reference)

From `src/lib/server/spend-guard.ts`, per UTC day, across everything that costs
money per call (AI, dictation, hotel and flight lookups):

| Scope | Daily cap | Env override |
| --- | --- | --- |
| Whole site | **$100/day** | `SPEND_SITE_DAILY_USD` |
| One confirmed pilot | **$8/day** | `SPEND_PILOT_DAILY_USD` |
| One guest (per device) | **$2/day** | `SPEND_GUEST_DAILY_USD` |
| All guests on one address | $10/day | `SPEND_GUEST_ADDRESS_DAILY_USD` |
| All pilots on one address | $30/day | `SPEND_PILOT_ADDRESS_DAILY_USD` |

So the app's own ceiling on all paid features is **$100/day ≈ $3,100/month** in
the absolute worst case (every day pinned to the cap). Real spend for ~50 paid
users will be a small fraction of that. The external caps below are set *above*
realistic usage but *below* a runaway, so they only ever fire if the app's own
guard has failed.

When the site cap is hit, paid features pause until midnight UTC and an email
goes to `ALERT_EMAIL` (if email is configured). Raising `SPEND_SITE_DAILY_USD`
in Vercel resumes them sooner.

---

## 1. Anthropic Console — monthly spend limit

This caps the AI spend (the interview, Ask your pack, contract chat, Haiku
verdicts, etc.) — the largest slice of the $100/day site cap.

**Where:**

1. Sign in at **console.anthropic.com** as the organization owner.
2. Left sidebar → **Settings** → **Billing** (organization billing).
3. Find the **Usage / spend limit** control (labelled "Monthly spend limit" or
   "Usage limits" — Anthropic has moved this between **Billing** and a dedicated
   **Limits** page; check both if you don't see it under Billing).
4. Set a **monthly spend limit** and a **notification threshold** (email alert).
5. If the project uses a dedicated **Workspace** (Settings → **Workspaces** →
   the workspace → **Limits**), set a per-workspace spend limit there too, so a
   leaked key on one workspace can't spend the whole org's allowance.

**Recommended for ~50 paid users:**

- **Monthly spend limit: $1,500**, with an **email alert at $750 (50%)**.
- Rationale: the app guard already caps all paid features at $100/day site-wide.
  $1,500/mo sits comfortably above a genuinely busy month for 50 pilots, yet far
  below the ~$3,100/mo the app would allow if every day pinned the cap — so this
  limit only trips if the app guard is bypassed or broken. If real, legitimate
  usage ever climbs toward the app ceiling, raise this toward **$3,000** rather
  than letting it pause the AI mid-month.
- Keep the alert threshold low (50%) so a surprise is a warning email, not a
  hard stop out of nowhere.

> Note: Anthropic's console labels shift over time. If the exact wording differs,
> look for anything named "spend", "usage limit" or "budget" under Billing or
> Limits. The goal is a hard **monthly dollar ceiling** plus an **email alert**.

---

## 2. Vercel — spend management (pause)

This caps hosting/compute/bandwidth spend and, separately, acts as a kill-switch
if usage genuinely runs away.

**Where (requires a Pro team — see `docs/launch/` launch checklist):**

1. Sign in at **vercel.com** and open the **team** that owns the project.
2. **Settings** (team-level) → **Billing** → **Spend Management**.
3. Set a **monthly spend amount**.
4. Choose the **action when the amount is reached**: start with **"Send a
   notification"**; once you trust the number, switch to **"Pause all
   projects"** (or wire the webhook to a Slack/email you watch) so a runaway is
   stopped, not just reported.

**Recommended for ~50 paid users:**

- **Spend amount: $150/month**, action **notify** first, then **pause** once the
  baseline is known.
- Rationale: a small Next.js app serving ~50 users uses very little Vercel
  compute/bandwidth; base Pro seats plus light usage should land well under
  $150/mo. The cap is there to catch a loop or an attack, not normal traffic.
- Pausing Vercel also stops the AI spend indirectly (the app stops serving), so
  this doubles as a last-resort kill switch behind the Anthropic cap.

> Spend Management is a Pro-plan feature. If the team is still on Hobby, upgrading
> to Pro is a prerequisite (and is already on the launch checklist for other
> reasons — Resend domain, backups, etc.).

---

## Order of operations

1. Confirm Vercel has `DATABASE_URL` and the Upstash Redis env set (the app now
   refuses to start in production without them — `src/lib/server/env-assert.ts`).
2. Set the Anthropic monthly spend limit + alert (section 1).
3. Set Vercel Spend Management (section 2).
4. Set `ALERT_EMAIL` in Vercel so the app's own cap sends you mail when it fires.
5. Note the two dashboard values here if you change them from the recommendations
   above, so the next person knows what's in place.
