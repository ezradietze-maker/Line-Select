import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
  },
  (t) => [index("award_history_base_aircraft_seat_idx").on(t.base, t.aircraft, t.seat)]
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
