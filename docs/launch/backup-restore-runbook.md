# Neon backup & restore runbook

The database (Neon Postgres) is the one place where data loss can't be undone from code. This is the concrete
procedure for backing it up and — the part that actually matters — **restoring it, rehearsed before launch.**

> **Last restore drill:** _not yet run — do this before charging pilots (see §4) and write the date here._

Two layers, because they fail differently:

- **Layer A — Neon point-in-time restore (PITR).** Built in, fast, covers "someone deleted the wrong rows an
  hour ago" and "a bad migration corrupted a table." Limited to Neon's history-retention window (hours on the
  free tier; 7 days on a paid Launch plan — see `docs/launch/paid-tiers.md` §4). If Neon itself loses your
  project, this goes with it.
- **Layer B — logical dump off Neon (`pg_dump`).** A plain `.sql` / custom-format file you hold **somewhere
  that isn't Neon**. Slower, point-in-time only as of when it ran, but it survives a whole-project loss and lets
  you restore into *any* Postgres. This is your real disaster backup.

Run both. Layer A is your everyday undo; Layer B is your "Neon is gone" insurance.

---

## 0. One-time setup

1. **Install the Postgres client tools** (`pg_dump`, `pg_restore`, `psql`), version **≥ your Neon Postgres major
   version** (`SELECT version();` to check). On macOS: `brew install libpq` then add it to `PATH`, or
   `brew install postgresql@17`.
2. **Get the two connection strings** from the Neon console → your project → **Connection Details**:
   - the **pooled** string (ends in `-pooler`) — this is what the app uses as `DATABASE_URL`.
   - the **direct / unpooled** string — **use this one for `pg_dump`, `pg_restore`, and `psql`.** Dumps and
     restores must not go through the pooler.
3. Keep both strings out of the repo. Export the direct one into your shell for the commands below:
   ```bash
   export NEON_DIRECT_URL='postgresql://USER:PASSWORD@ep-xxxx.REGION.aws.neon.tech/neondb?sslmode=require'
   ```
4. **Install the Neon CLI** (for Layer A scripted restores and branch management):
   ```bash
   npm i -g neonctl   # then: neonctl auth
   ```

---

## 1. Layer B — take a logical backup (`pg_dump`)

Run this on demand before anything risky (a migration, a bulk edit) and on a schedule (see §3).

```bash
# Custom-format dump (compressed, restores selectively). Timestamped filename.
pg_dump "$NEON_DIRECT_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --file="lineselect-$(date +%Y%m%d-%H%M%S).dump"
```

- `--no-owner --no-privileges`: Neon manages roles; these avoid "role does not exist" noise on restore.
- Verify the file is non-trivial in size and lists your tables:
  ```bash
  pg_restore --list lineselect-*.dump | grep -E 'TABLE DATA' | head
  ```
- **Move the file off Neon and off your laptop**: upload it to a separate bucket (e.g. an S3/R2 bucket, or
  even a private repo-external drive). A backup that lives only next to the thing it's backing up is not a
  backup. Keep at least the last 7 daily and 4 weekly dumps.

A plain SQL variant, if you ever want a human-readable file:
```bash
pg_dump "$NEON_DIRECT_URL" --no-owner --no-privileges --file=lineselect.sql
```

---

## 2. Restore procedures

### 2A. Neon PITR — "undo the last few hours" (fastest, preferred for recent mistakes)

Neon restores by creating a **branch** at a past timestamp; you then verify it, and only then promote it. This
is non-destructive until the final step, which is why it's safe to rehearse.

1. In the Neon console → **Branches** → **New branch** → create from **a point in time**, and pick the
   timestamp *just before* the bad change. (Equivalently: `neonctl branches create --name restore-test
   --parent <main> --timestamp 2026-11-13T09:00:00Z`.)
2. The new branch has its **own connection string**. Point a *scratch* `DATABASE_URL` (or `psql`) at it and
   **verify the data is what you expect** — row counts, the specific records that were lost:
   ```bash
   psql "<branch-direct-url>" -c "SELECT count(*) FROM users;"
   ```
3. Promote the good data. Two ways:
   - **Simplest for a full rollback:** in the console, **set this branch as the primary / default**, so the
     app's existing `DATABASE_URL` now resolves to the restored data. (Or repoint `DATABASE_URL` in Vercel to
     the branch's string and redeploy.) Confirm the app reads correctly, then delete the old branch once you're
     sure.
   - **For a partial restore** (only some rows/tables were lost): `pg_dump` just those tables from the restore
     branch and load them into the live branch — see 2B's selective flags.
4. Delete throwaway branches when done (`neonctl branches delete <id>`) so they don't accrue storage cost.

### 2B. Logical restore from a `pg_dump` file — "Neon lost it / restore into fresh Postgres"

Use this when the PITR window won't reach, or to rebuild on a brand-new Neon project (or any Postgres).

1. **Provision an empty target** database (a new Neon project/branch, or local Postgres) and get its **direct**
   connection string into `TARGET_URL`.
2. Restore the dump:
   ```bash
   pg_restore \
     --dbname="$TARGET_URL" \
     --no-owner --no-privileges \
     --clean --if-exists \
     lineselect-YYYYMMDD-HHMMSS.dump
   ```
   - `--clean --if-exists`: drops objects before recreating, so a restore into a non-empty DB is idempotent.
   - Selective restore (one table): add `--table=users`. Schema-only: `--schema-only`. Data-only: `--data-only`.
3. **Bring the schema's migration state into line.** The dump restores the current schema and the
   `drizzle`/migrations bookkeeping table as they were. If you restored an *older* dump, apply any newer
   migrations:
   ```bash
   DATABASE_URL="$TARGET_URL" npm run db:migrate
   ```
   This is a no-op when the dump is already current, and applies the gap when it isn't.
4. **Repoint the app:** set `DATABASE_URL` (Vercel → Production env) to the restored database's **pooled**
   string and redeploy. Smoke-test sign-in and one saved record.

---

## 3. Scheduled backups

Pick one, write down which you chose:

- **Neon's own scheduled/retained history** (paid plan) covers Layer A automatically — confirm the retention
  window is set to the plan maximum in the console.
- **A cron for Layer B.** Run §1's `pg_dump` daily from a machine that's always on (a tiny scheduled job, a
  GitHub Action with the direct URL in a secret, or a cheap VPS cron) and push the file to off-Neon storage.
  Example GitHub Action cron: `0 7 * * *` (07:00 UTC daily). Store `NEON_DIRECT_URL` as an encrypted secret,
  never in the workflow file.

---

## 4. The restore drill (do this before launch, then quarterly)

A backup you have never restored is a guess. Rehearse end-to-end — it's safe, nothing touches the live DB:

1. Take a fresh `pg_dump` (§1).
2. Spin up a throwaway target (new Neon branch, or local `createdb lineselect_drill`).
3. Restore into it (§2B steps 2–3).
4. Point a *local* dev server at the restored DB (`DATABASE_URL=<target> npm run dev`) and confirm:
   - sign-in works,
   - a known user's saved drafts / data are present and correct,
   - `SELECT count(*)` on `users` and the main tables matches the source.
5. Separately, rehearse a **PITR branch restore** (§2A steps 1–2) and confirm you can read old data from the
   branch.
6. Tear down the throwaway target/branch.
7. **Record the date and result at the top of this file**, and note how long the restore took (your real
   recovery-time estimate).

If any step fails, fix it *now* — not during a real incident.

---

## Quick reference

| Situation | Procedure | Time window |
|---|---|---|
| Bad delete/migration in last few hours–days | §2A Neon PITR branch | within retention window |
| Need data from before the retention window | §2B from a `pg_dump` file | as of last dump |
| Neon project lost entirely | §2B into a fresh project | as of last off-Neon dump |
| Routine insurance | §1 dump + off-Neon upload | — |

Connection-string rule, every time: **direct/unpooled** string for `pg_dump`/`pg_restore`/`psql`; **pooled**
string for the app's `DATABASE_URL`.
