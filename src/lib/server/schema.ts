import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { CorrectionEvent } from "@/lib/learning/interview-learning";
import type { InterviewOutcome } from "@/lib/learning/interview-outcome";
import type { BidPackMetaSnapshot, TripSnapshot } from "@/types/trade";
import type { PreferenceProfile } from "@/types/preferences";

/**
 * Replaces the old single-JSON-blob store (`kv.ts`'s `line-select:db` key)
 * with real tables — unique constraints and atomic conditional updates are
 * what actually prevent two concurrent signups or trade responses from
 * corrupting each other, which a read-modify-write blob can never guarantee.
 * `PreferenceProfile` and the trade snapshots stay JSONB deliberately: both
 * are point-in-time or fast-evolving value objects read/written as a whole,
 * never queried by an inner field, so normalizing them into columns would
 * add nothing.
 */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** "free" | "pro" — a future paid-tier hook, not enforced anywhere yet. */
  plan: text("plan").notNull().default("free"),
});

export const credentials = pgTable("credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  salt: text("salt").notNull(),
  /** Absent until the pilot generates one — their way back in with no email service involved. */
  recoveryHash: text("recovery_hash"),
  recoverySalt: text("recovery_salt"),
});

export const sessions = pgTable(
  "sessions",
  {
    token: text("token").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)]
);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  /** Unique: at most one live token per pilot, enforced by the DB rather than a read-filter-push dance. */
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** "open" | "pending" | "accepted" | "declined" | "withdrawn" — kept as text (see `types/trade.ts`) rather than a Postgres enum so adding a status never needs a migration. */
export const tradeOffers = pgTable(
  "trade_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    base: text("base").notNull(),
    aircraft: text("aircraft").notNull(),
    seat: text("seat").notNull(),
    month: text("month").notNull(),
    offeringUserId: uuid("offering_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    offeringDisplayName: text("offering_display_name").notNull(),
    offeredTrip: jsonb("offered_trip").notNull().$type<TripSnapshot>(),
    wantedPairingNumber: text("wanted_pairing_number"),
    note: text("note"),
    status: text("status").notNull().default("open"),
    responderUserId: uuid("responder_user_id").references(() => users.id, { onDelete: "cascade" }),
    responderDisplayName: text("responder_display_name"),
    responderTrip: jsonb("responder_trip").$type<TripSnapshot>(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [index("trade_offers_status_idx").on(t.status)]
);

export function bidPackMetaOf(row: { base: string; aircraft: string; seat: string; month: string }): BidPackMetaSnapshot {
  return { base: row.base, aircraft: row.aircraft, seat: row.seat, month: row.month };
}

export const candidateVariables = pgTable("candidate_variables", {
  id: uuid("id").primaryKey().defaultRandom(),
  pilotId: text("pilot_id").notNull(),
  rawQuote: text("raw_quote").notNull(),
  proposedName: text("proposed_name").notNull(),
  proposedDescription: text("proposed_description").notNull(),
  favoredLineNumber: text("favored_line_number").notNull(),
  overtakenLineNumber: text("overtaken_line_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const awardHistoryRecords = pgTable(
  "award_history_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    base: text("base").notNull(),
    aircraft: text("aircraft").notNull(),
    seat: text("seat").notNull(),
    month: text("month").notNull(),
    seniorityRank: integer("seniority_rank").notNull(),
    seniorityTotalPilots: integer("seniority_total_pilots").notNull(),
    /** "line" | "reserve" | "other" */
    outcome: text("outcome").notNull(),
    lineNumber: text("line_number"),
    daysOff: integer("days_off"),
    totalCreditHours: integer("total_credit_hours"),
    totalTafbHours: integer("total_tafb_hours"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * One-way hash of the reporting account (same scheme as
     * `forecastRankings.userHash`) — links one pilot's reports across
     * months so they can see their own holding history and so the forecast
     * made for them can be checked against what they got. Never returned
     * by the public listing, never reversible to a name.
     */
    pilotHash: text("pilot_hash"),
    /** The forecast pack key ("oct26|mem|b767|fo") this award belongs to. */
    packKey: text("pack_key"),
    /** Which of the pilot's own choices they were awarded (1 = their first), when known. */
    awardedChoice: integer("awarded_choice"),
  },
  (t) => [
    index("award_history_base_aircraft_seat_idx").on(t.base, t.aircraft, t.seat),
    index("award_history_pilot_idx").on(t.pilotHash),
  ]
);

export const interviewCandidateFacts = pgTable("interview_candidate_facts", {
  id: uuid("id").primaryKey().defaultRandom(),
  pilotId: text("pilot_id"),
  rawStatement: text("raw_statement").notNull(),
  proposedName: text("proposed_name").notNull(),
  proposedDescription: text("proposed_description").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const preferenceProfiles = pgTable("preference_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  profile: jsonb("profile").notNull().$type<PreferenceProfile>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const feedbackSubmissions = pgTable("feedback_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  pilotId: text("pilot_id"),
  pilotDisplayName: text("pilot_display_name"),
  pilotEmail: text("pilot_email"),
  /** "bug" | "idea" | "confusing" | "other" */
  category: text("category").notNull(),
  message: text("message").notNull(),
  page: text("page").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Replaces the per-pack blob in `forecast-store.ts`. `(blobKey, bidNumber)`
 * unique so claiming a bid position is one atomic upsert instead of a
 * read-then-check-then-write race; `(blobKey, userHash)` unique so a pilot
 * who moves bid numbers still has exactly one live row per pack.
 */
export const forecastRankings = pgTable(
  "forecast_rankings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    blobKey: text("blob_key").notNull(),
    /** One-way hash of the account id — never a name, never reversible. */
    userHash: text("user_hash").notNull(),
    bidNumber: integer("bid_number").notNull(),
    seniority: integer("seniority").notNull(),
    /** Base-36 encoded ranking, see `lib/forecast/ranking-codec.ts`. */
    ranking: text("ranking").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("forecast_rankings_blob_bid_idx").on(t.blobKey, t.bidNumber),
    uniqueIndex("forecast_rankings_blob_user_idx").on(t.blobKey, t.userHash),
  ]
);

/**
 * Anonymized phrase snippets pulled from pilots' free-text "walk through
 * your bidding process" interview answers (see `server/style-store.ts`) —
 * calibration material for how the interview talks to *future* pilots, not
 * a record of what any one pilot said. Deliberately carries no pilot link
 * at all (not even a hash, unlike `forecastRankings.userHash`) — there's no
 * need to know who said it, only what it sounds like, and not storing a
 * link is the simplest way to make "anonymized" actually true. Global
 * across every base/aircraft/seat: phrasing style has nothing to do with
 * which pack someone flies, unlike a shared bid ranking.
 */
export const interviewStyleSamples = pgTable("interview_style_samples", {
  id: uuid("id").primaryKey().defaultRandom(),
  phrase: text("phrase").notNull(),
  tags: jsonb("tags").notNull().$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Fleet learning — see `lib/learning/` and `server/learning-store.ts`.
// Everything here is kept for years (bounded by row caps, not by age), so
// the models can learn from many months of bids, not just the current one.
// ---------------------------------------------------------------------------

/**
 * One finished interview, as the fleet learns from it — the pilot's group,
 * where each preference landed and where it came from, how each question
 * went. Never the pilot's words (see `InterviewOutcome`). `pilotHash` is
 * present only for signed-in pilots, so one pilot's interviews across
 * months can be told apart from many pilots'.
 */
export const interviewOutcomes = pgTable(
  "interview_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    pilotHash: text("pilot_hash"),
    base: text("base").notNull(),
    aircraft: text("aircraft").notNull(),
    seat: text("seat").notNull(),
    month: text("month").notNull(),
    commute: text("commute").notNull(),
    seniorityBand: text("seniority_band").notNull(),
    modelVersion: text("model_version"),
    payload: jsonb("payload").notNull().$type<InterviewOutcome>(),
  },
  (t) => [index("interview_outcomes_pack_idx").on(t.base, t.aircraft, t.seat), index("interview_outcomes_created_idx").on(t.createdAt)]
);

/** A pilot later changing a value the interview set — the most direct signal of where the interview gets people wrong. */
export const preferenceCorrections = pgTable(
  "preference_corrections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    pilotHash: text("pilot_hash"),
    base: text("base").notNull(),
    aircraft: text("aircraft").notNull(),
    seat: text("seat").notNull(),
    dim: text("dim").notNull(),
    src: text("src").notNull().$type<CorrectionEvent["src"]>(),
    fromValue: integer("from_value").notNull(),
    toValue: integer("to_value").notNull(),
  },
  (t) => [index("preference_corrections_created_idx").on(t.createdAt)]
);

/**
 * A month's line features (standardized numbers only — never the bid pack
 * itself), kept so rankings shared that month can be re-read by the
 * learning long after the month is over. Keyed like `forecastRankings`.
 */
export const packFeatures = pgTable(
  "pack_features",
  {
    blobKey: text("blob_key").primaryKey(),
    packKey: text("pack_key").notNull(),
    base: text("base").notNull(),
    aircraft: text("aircraft").notNull(),
    seat: text("seat").notNull(),
    month: text("month").notNull(),
    lineNumbers: jsonb("line_numbers").notNull().$type<string[]>(),
    features: jsonb("features").notNull().$type<number[]>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("pack_features_pack_idx").on(t.packKey)]
);

/**
 * The forecast a signed-in pilot was shown — their top choices and the
 * chance each was still open at their turn — kept so it can be checked
 * against the line they report being awarded. One per pilot per pack
 * (the latest), keyed by the same one-way hash as everything else.
 */
export const forecastPredictions = pgTable(
  "forecast_predictions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    pilotHash: text("pilot_hash").notNull(),
    blobKey: text("blob_key").notNull(),
    packKey: text("pack_key").notNull(),
    bidNumber: integer("bid_number").notNull(),
    totalPilots: integer("total_pilots").notNull(),
    ranking: jsonb("ranking").notNull().$type<number[]>(),
    pAvailable: jsonb("p_available").notNull().$type<number[]>(),
    modelVersion: text("model_version"),
  },
  (t) => [uniqueIndex("forecast_predictions_pilot_blob_idx").on(t.pilotHash, t.blobKey), index("forecast_predictions_pack_idx").on(t.packKey)]
);

/**
 * Every model the learning has produced, kept forever as a version history.
 * Exactly one per `kind` is `active` — the champion the app actually uses;
 * a new one only replaces it after scoring at least as well on the newest
 * data it wasn't trained on (see `server/learning-runner.ts`).
 */
export const learnedModels = pgTable(
  "learned_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** "interview" | "forecast-prior" | "forecast-calibration" */
    kind: text("kind").notNull(),
    version: text("version").notNull(),
    active: boolean("active").notNull().default(false),
    sampleSize: integer("sample_size").notNull(),
    metrics: jsonb("metrics").notNull().$type<Record<string, unknown>>(),
    payload: jsonb("payload").notNull().$type<unknown>(),
  },
  (t) => [index("learned_models_kind_active_idx").on(t.kind, t.active), uniqueIndex("learned_models_kind_version_idx").on(t.kind, t.version)]
);

/** One learning run: what triggered it, what it learned from, and which models it promoted or rejected and why. */
export const learningRuns = pgTable("learning_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  trigger: text("trigger").notNull(),
  summary: jsonb("summary").notNull().$type<Record<string, unknown>>(),
});
