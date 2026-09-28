import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as mod from "@/lib/server/db";
import * as forecastStore from "@/lib/server/forecast-store";
import { db } from "@/lib/server/postgres";
import { feedbackSubmissions, users } from "@/lib/server/schema";
import { DEFAULT_WEIGHTS } from "@/types/preferences";
import type { PreferenceProfile } from "@/types/preferences";
import type { FeedbackSubmission } from "@/types/feedback";
import type { TradeOffer } from "@/types/trade";

/**
 * Integration tests against a real Postgres — the old version of this file
 * mocked `kv.ts` with an in-memory Map, which could never exercise the
 * thing that actually matters now (real unique constraints, real atomic
 * conditional updates). Skips cleanly with no DATABASE_URL set, so `npm
 * test` still runs clean for anyone without database access; every row a
 * test creates is deleted afterward.
 *
 * Unlike `next dev`/`next build`, vitest doesn't auto-load .env.local — load
 * it explicitly (harmless if it's absent or already loaded).
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — fine if the environment already has these vars set
}

const hasDb = !!(process.env.DATABASE_URL ?? process.env.POSTGRES_URL);
if (!hasDb) {
  console.warn("Skipping db.test.ts — no DATABASE_URL set.");
}

describe.skipIf(!hasDb)("Postgres-backed store", () => {
  const createdUserIds: string[] = [];
  const createdFeedbackIds: string[] = [];

  async function makeUser(emailPrefix: string) {
    const id = randomUUID();
    const email = `${emailPrefix}-${id}@test.line-select.invalid`;
    const created = await mod.createUserWithCredential(
      { id, email, displayName: "Test Pilot", createdAt: new Date().toISOString(), plan: "free" },
      { userId: id, email, passwordHash: "hash", salt: "salt" }
    );
    expect(created.ok).toBe(true);
    createdUserIds.push(id);
    return { id, email };
  }

  function fakeProfile(overrides: Partial<PreferenceProfile> = {}): PreferenceProfile {
    return {
      weights: { ...DEFAULT_WEIGHTS },
      deepRoundCompleted: false,
      tradeoffAnswers: [],
      explicitTargets: {},
      isCommuter: null,
      hasCrashPad: null,
      cityPreferences: {},
      completedAt: "2026-01-01T00:00:00.000Z",
      implicitWeights: {},
      implicitConfidence: {},
      discoveredFacts: [],
      interviewTranscript: [],
      ...overrides,
    };
  }

  function fakeFeedback(overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
    return {
      id: randomUUID(),
      pilotId: null,
      pilotDisplayName: null,
      pilotEmail: null,
      category: "idea",
      message: "It would be nice if...",
      page: "/results",
      createdAt: new Date().toISOString(),
      ...overrides,
    };
  }

  afterAll(async () => {
    // Cascades to credentials/sessions/preference profiles/trade offers this test created.
    if (createdUserIds.length) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    if (createdFeedbackIds.length) {
      await db.delete(feedbackSubmissions).where(inArray(feedbackSubmissions.id, createdFeedbackIds));
    }
  });

  describe("preference profile store", () => {
    it("returns null for a pilot who has never saved a profile", async () => {
      expect(await mod.getPreferenceProfile(randomUUID())).toBeNull();
    });

    it("round-trips a saved profile back out for the same userId", async () => {
      const { id } = await makeUser("profile-roundtrip");
      const profile = fakeProfile({ isCommuter: true });
      await mod.savePreferenceProfile(id, profile);
      expect(await mod.getPreferenceProfile(id)).toEqual(profile);
    });

    it("overwrites a pilot's own prior profile on a second save, not appending", async () => {
      const { id } = await makeUser("profile-overwrite");
      await mod.savePreferenceProfile(id, fakeProfile({ deepRoundCompleted: false }));
      await mod.savePreferenceProfile(id, fakeProfile({ deepRoundCompleted: true }));
      expect((await mod.getPreferenceProfile(id))?.deepRoundCompleted).toBe(true);
    });

    it("deletes only the requested pilot's profile", async () => {
      const a = await makeUser("profile-delete-a");
      const b = await makeUser("profile-delete-b");
      await mod.savePreferenceProfile(a.id, fakeProfile());
      await mod.savePreferenceProfile(b.id, fakeProfile());
      await mod.deletePreferenceProfile(a.id);
      expect(await mod.getPreferenceProfile(a.id)).toBeNull();
      expect(await mod.getPreferenceProfile(b.id)).not.toBeNull();
    });

    it("deleting a profile that was never saved is a harmless no-op", async () => {
      await expect(mod.deletePreferenceProfile(randomUUID())).resolves.toBeUndefined();
    });
  });

  describe("feedback store", () => {
    it("lists a submission back out after creating it", async () => {
      const submission = fakeFeedback();
      createdFeedbackIds.push(submission.id);
      await mod.createFeedbackSubmission(submission);
      const all = await mod.listFeedbackSubmissions();
      expect(all.find((s) => s.id === submission.id)).toEqual(submission);
    });

    it("keeps a guest submission's pilot fields null rather than inventing an identity", async () => {
      const submission = fakeFeedback({ pilotId: null, pilotEmail: null });
      createdFeedbackIds.push(submission.id);
      await mod.createFeedbackSubmission(submission);
      const saved = (await mod.listFeedbackSubmissions()).find((s) => s.id === submission.id);
      expect(saved?.pilotId).toBeNull();
      expect(saved?.pilotEmail).toBeNull();
    });
  });

  describe("signup race: duplicate email", () => {
    it("rejects a second account created with the same email as a typed result, not a thrown crash", async () => {
      const { id: firstId, email } = await makeUser("dup-email");
      const secondId = randomUUID();
      createdUserIds.push(secondId); // no-op cleanup if the insert never lands
      const result = await mod.createUserWithCredential(
        { id: secondId, email, displayName: "Someone Else", createdAt: new Date().toISOString(), plan: "free" },
        { userId: secondId, email, passwordHash: "hash2", salt: "salt2" }
      );
      expect(result).toEqual({ ok: false, reason: "duplicate-email" });
      // The first account is untouched.
      expect((await mod.findUserById(firstId))?.email).toBe(email);
    });
  });

  describe("trade offer race: two responses to the same open offer", () => {
    it("lets exactly one concurrent response claim the offer", async () => {
      const offerer = await makeUser("trade-offerer");
      const responderA = await makeUser("trade-responder-a");
      const responderB = await makeUser("trade-responder-b");

      const offer: TradeOffer = {
        id: randomUUID(),
        bidPackMeta: { base: "MEM", aircraft: "B777", seat: "CAP", month: "OCT26" },
        offeringUserId: offerer.id,
        offeringDisplayName: "Offerer",
        offeredTrip: {
          lineNumber: "1",
          pairingNumber: "13",
          days: 4,
          layoverCities: ["ANC"],
          international: false,
          reportTime: "early",
          creditHours: 20,
          tafbHours: 90,
          landings: 6,
          deadheadLegs: 0,
        },
        wantedPairingNumber: null,
        note: null,
        status: "open",
        createdAt: new Date().toISOString(),
        responderUserId: null,
        responderDisplayName: null,
        responderTrip: null,
        respondedAt: null,
        resolvedAt: null,
      };
      await mod.createTradeOffer(offer);

      const respondAs = (responder: { id: string }) =>
        mod.updateTradeOffer(
          offer.id,
          {
            status: "pending",
            responderUserId: responder.id,
            responderDisplayName: "Responder",
            responderTrip: offer.offeredTrip,
            respondedAt: new Date().toISOString(),
          },
          ["open"]
        );

      const [resultA, resultB] = await Promise.all([respondAs(responderA), respondAs(responderB)]);
      const winners = [resultA, resultB].filter((r) => r !== null);
      const losers = [resultA, resultB].filter((r) => r === null);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);

      const final = await mod.findTradeOffer(offer.id);
      expect(final?.status).toBe("pending");
      expect([responderA.id, responderB.id]).toContain(final?.responderUserId);

      // A third, later attempt against the now-"pending" offer is also rejected atomically.
      const tooLate = await respondAs(responderA);
      expect(tooLate).toBeNull();
    });
  });

  describe("forecast ranking store: a bid position can't be taken from its holder", () => {
    it("rejects a second pilot claiming the same bid position, and lets the original pilot update their own", async () => {
      const packKey = `test-pack-${randomUUID()}`;
      const lineNumbers = ["100", "101", "102"];
      const pilotA = randomUUID();
      const pilotB = randomUUID();

      const first = await forecastStore.saveSubmission({
        packKey,
        lineNumbers,
        userId: pilotA,
        bidNumber: 5,
        seniority: 500,
        ranking: [0, 1, 2],
      });
      expect(first).toEqual({ stored: true });

      const stolen = await forecastStore.saveSubmission({
        packKey,
        lineNumbers,
        userId: pilotB,
        bidNumber: 5,
        seniority: 501,
        ranking: [2, 1, 0],
      });
      expect(stolen).toEqual({ stored: false, reason: "position-taken" });

      const updatedByOwner = await forecastStore.saveSubmission({
        packKey,
        lineNumbers,
        userId: pilotA,
        bidNumber: 5,
        seniority: 500,
        ranking: [1, 0, 2],
      });
      expect(updatedByOwner).toEqual({ stored: true });

      const { known, total } = await forecastStore.loadKnownRankings(packKey, lineNumbers, pilotB);
      expect(total).toBe(1);
      expect(known).toEqual([{ bidNumber: 5, ranking: [1, 0, 2] }]);

      await forecastStore.removeSubmission(packKey, lineNumbers, pilotA);
      expect((await forecastStore.loadKnownRankings(packKey, lineNumbers, null)).total).toBe(0);
    });
  });
});
