import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import * as mod from "@/lib/server/db";
import * as forecastStore from "@/lib/server/forecast-store";
import { db } from "@/lib/server/postgres";
import * as suggestions from "@/lib/server/trade-suggestions";
import { awardHistoryRecords, feedbackSubmissions, tradeOffers, users } from "@/lib/server/schema";
import { DEFAULT_WEIGHTS } from "@/types/preferences";
import type { PreferenceProfile } from "@/types/preferences";
import type { FeedbackSubmission } from "@/types/feedback";
import type { TradeOffer } from "@/types/trade";

/**
 * Integration tests against a real Postgres — the old version of this file
 * mocked `kv.ts` with an in-memory Map, which could never exercise the
 * thing that actually matters now (real unique constraints, real atomic
 * conditional updates). They run only against a database named in
 * TEST_DATABASE_URL, migrated with `npm run db:migrate`. DATABASE_URL is the
 * live database, whose real accounts these tests must never sit beside, so
 * without TEST_DATABASE_URL they skip; every row a test creates is deleted
 * afterward.
 *
 * Unlike `next dev`/`next build`, vitest doesn't auto-load .env.local — load
 * it explicitly (harmless if it's absent or already loaded).
 */
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — fine if the environment already has these vars set
}

const hasDb = !!process.env.TEST_DATABASE_URL;
if (hasDb) {
  // `postgres.ts` connects on first use, so this reaches it despite the imports above.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
} else {
  console.warn("Skipping db.test.ts — no TEST_DATABASE_URL set.");
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

  describe("what a pilot holds, for suggesting trades", () => {
    const meta = { base: "MEM", aircraft: "MD11", seat: "FO", month: "OCT26" };
    const holding = (packId: string, lineNumber: string | null = "2001") => ({ packId, bidPackMeta: meta, lineNumber, trips: [{ id: "t1", startDayIndex: 3, lock: null }] });

    it("keeps one holding per pilot and pack, a new one replacing the old", async () => {
      const user = await makeUser("holding");
      expect(await mod.getTradeHolding(user.id, "p1")).toBeNull();
      await mod.saveTradeHolding(user.id, holding("p1"));
      await mod.saveTradeHolding(user.id, holding("p1", null));
      await mod.saveTradeHolding(user.id, holding("p2"));
      expect((await mod.getTradeHolding(user.id, "p1"))?.lineNumber).toBeNull();
      expect((await mod.getTradeHolding(user.id, "p2"))?.lineNumber).toBe("2001");
      expect((await mod.getTradeHolding(user.id, "p1"))?.bidPackMeta).toEqual(meta);
      await mod.deleteTradeHolding(user.id, "p1");
      expect(await mod.getTradeHolding(user.id, "p1")).toBeNull();
      expect(await mod.getTradeHolding(user.id, "p2")).not.toBeNull();
    });

    it("includes a pilot in suggestions, and doesn't email them, until they say otherwise", async () => {
      const user = await makeUser("settings");
      expect(await mod.getTradeSettings(user.id)).toEqual({ suggestMe: true, emailMatches: false });
      await mod.saveTradeSettings(user.id, { suggestMe: false, emailMatches: true });
      expect(await mod.getTradeSettings(user.id)).toEqual({ suggestMe: false, emailMatches: true });
    });

    it("goes when the account goes", async () => {
      const user = await makeUser("cascade");
      await mod.saveTradeHolding(user.id, holding("p1"));
      await mod.saveTradeSettings(user.id, { suggestMe: false, emailMatches: false });
      await db.delete(users).where(inArray(users.id, [user.id]));
      expect(await mod.getTradeHolding(user.id, "p1")).toBeNull();
      expect(await mod.getTradeSettings(user.id)).toEqual({ suggestMe: true, emailMatches: false });
    });
  });

  describe("suggested trades", () => {
    const meta = { base: "MEM", aircraft: "MD11", seat: "FO", month: `Z${randomUUID().slice(0, 8)}` };
    const packId = `pack-${meta.month}`;
    const tripOf = (n: number) => ({ id: `t${n}`, startDayIndex: n, date: null, lineNumber: "held", pairingNumber: `${n}`, days: 2, layoverCities: [], international: false, reportTime: "am", creditHours: 10, tafbHours: 48, landings: 2, deadheadLegs: 0 }) as never;
    const value = { gain: 3, before: 50, after: 53, creditChange: 0, daysOffChange: 0, reasons: [] };

    async function threePilots(signature: string, expiresAt = new Date(Date.now() + 86_400_000)) {
      const pilots = [await makeUser("a"), await makeUser("b"), await makeUser("c")];
      for (const [i, p] of pilots.entries()) await mod.saveTradeHolding(p.id, { packId, bidPackMeta: meta, lineNumber: null, trips: [{ id: `t${i}`, startDayIndex: i, lock: null }] });
      const saved = await suggestions.saveSuggestion({
        signature,
        packId,
        bidPackMeta: meta,
        steps: [{ a: 0, b: 1 }, { a: 1, b: 2 }],
        expiresAt,
        members: pilots.map((p, position) => ({ userId: p.id, displayName: `P${position}`, position, give: tripOf(position), value })),
      });
      expect(saved).toBe(true);
      const [record] = await suggestions.listSuggestionsFor(pilots[0].id, packId);
      return { pilots, id: record.id };
    }

    it("won't store the same trade twice", async () => {
      const signature = randomUUID();
      await threePilots(signature);
      const again = await suggestions.saveSuggestion({ signature, packId, bidPackMeta: meta, steps: [], expiresAt: new Date(), members: [] });
      expect(again).toBe(false);
    });

    it("opens on the last yes, and lets only those on it answer", async () => {
      const { pilots, id } = await threePilots(randomUUID());
      const stranger = await makeUser("stranger");
      expect(await suggestions.answerSuggestion(id, stranger.id, "accepted")).toEqual({ ok: false, reason: "not-found" });
      await suggestions.answerSuggestion(id, pilots[0].id, "accepted");
      const second = await suggestions.answerSuggestion(id, pilots[1].id, "accepted");
      expect(second.ok && second.record.status).toBe("proposed");
      const last = await suggestions.answerSuggestion(id, pilots[2].id, "accepted");
      expect(last.ok && last.record.status).toBe("accepted");
    });

    it("counts two yeses at once, so the trade can't stall on a race", async () => {
      const { pilots, id } = await threePilots(randomUUID());
      await suggestions.answerSuggestion(id, pilots[0].id, "accepted");
      await Promise.all([suggestions.answerSuggestion(id, pilots[1].id, "accepted"), suggestions.answerSuggestion(id, pilots[2].id, "accepted")]);
      const [record] = await suggestions.listSuggestionsFor(pilots[0].id, packId);
      expect(record.status).toBe("accepted");
    });

    it("is cancelled for everyone by one no, and that swap isn't suggested to them again", async () => {
      const { pilots, id } = await threePilots(randomUUID());
      await suggestions.answerSuggestion(id, pilots[0].id, "accepted");
      const no = await suggestions.answerSuggestion(id, pilots[1].id, "declined");
      expect(no.ok && no.record.status).toBe("cancelled");
      expect(await suggestions.answerSuggestion(id, pilots[2].id, "accepted")).toEqual({ ok: false, reason: "closed" });
      const history = await suggestions.matchingHistory(meta, new Date());
      expect(history.declined.has(suggestions.swapKey(pilots[1].id, { id: "t1", startDayIndex: 1 }, { id: "t2", startDayIndex: 2 }))).toBe(true);
    });

    it("remembers why a pilot said no, for what they're offered next", async () => {
      const a = await threePilots(randomUUID());
      await suggestions.answerSuggestion(a.id, a.pilots[1].id, "declined", new Date(), "trip");
      const b = await threePilots(randomUUID());
      await suggestions.answerSuggestion(b.id, b.pilots[0].id, "declined", new Date(), "notWorthIt");
      const history = await suggestions.matchingHistory(meta, new Date());
      expect(history.refusedTrips.has(suggestions.refusedTripKey(a.pilots[1].id, { id: "t2", startDayIndex: 2 }))).toBe(true);
      expect(history.minGains.get(b.pilots[0].id)).toBe(4);
    });

    it("counts a day's trades for the owner's email, and finds who wants an email", async () => {
      const before = await suggestions.tradeDayCounts(new Date(Date.now() - 60_000), new Date(Date.now() + 60_000));
      const { pilots, id } = await threePilots(randomUUID());
      await suggestions.answerSuggestion(id, pilots[0].id, "declined", new Date(), "notNow");
      const after = await suggestions.tradeDayCounts(new Date(Date.now() - 60_000), new Date(Date.now() + 60_000));
      expect((after.suggested[3] ?? 0) - (before.suggested[3] ?? 0)).toBe(1);
      expect(after.no - before.no).toBe(1);
      expect((after.noBecause.notNow ?? 0) - (before.noBecause.notNow ?? 0)).toBe(1);
      await mod.saveTradeSettings(pilots[1].id, { suggestMe: true, emailMatches: true });
      await mod.saveTradeSettings(pilots[2].id, { suggestMe: false, emailMatches: true });
      const targets = await suggestions.listTradeEmailTargets(pilots.map((p) => p.id));
      expect([...targets.keys()]).toEqual([pilots[1].id]);
    });

    it("lists a group once enough pilots in it have confirmed", async () => {
      await threePilots(randomUUID());
      const groups = await suggestions.listActiveGroups(2);
      expect(groups).toContainEqual(meta);
      expect(await suggestions.listActiveGroups(100_000)).toEqual([]);
    });

    it("moves what the pilots hold, one step at a time, in order, and only the two in the step can mark it", async () => {
      const { pilots, id } = await threePilots(randomUUID());
      for (const p of pilots) await suggestions.answerSuggestion(id, p.id, "accepted");
      expect(await suggestions.markStepDone(id, pilots[0].id, 1)).toEqual({ ok: false, reason: "not-next" });
      expect(await suggestions.markStepDone(id, pilots[2].id, 0)).toEqual({ ok: false, reason: "not-yours" });
      const first = await suggestions.markStepDone(id, pilots[1].id, 0);
      expect(first.ok && first.record.stepsDone).toBe(1);
      expect((await mod.getTradeHolding(pilots[0].id, packId))?.trips.map((t) => t.id)).toEqual(["t1"]);
      expect((await mod.getTradeHolding(pilots[1].id, packId))?.trips.map((t) => t.id)).toEqual(["t0"]);
      const second = await suggestions.markStepDone(id, pilots[2].id, 1);
      expect(second.ok && second.record.status).toBe("done");
      expect((await mod.getTradeHolding(pilots[0].id, packId))?.trips.map((t) => t.id)).toEqual(["t1"]);
      expect((await mod.getTradeHolding(pilots[1].id, packId))?.trips.map((t) => t.id)).toEqual(["t2"]);
      expect((await mod.getTradeHolding(pilots[2].id, packId))?.trips.map((t) => t.id)).toEqual(["t0"]);
    });

    it("lapses a trade not yet begun when someone's trips change, leaving it free to be found again", async () => {
      const signature = randomUUID();
      const { pilots, id } = await threePilots(signature);
      await suggestions.lapseSuggestionsFor(pilots[1].id, packId);
      const [record] = await suggestions.listSuggestionsFor(pilots[0].id, packId);
      expect(record.status).toBe("cancelled");
      expect(record.cancelReason).toBe("changed");
      expect((await suggestions.matchingHistory(meta, new Date())).signatures.has(signature)).toBe(false);
      expect(id).toBe(record.id);
    });

    it("keeps a trade already under way when someone's trips change", async () => {
      const { pilots, id } = await threePilots(randomUUID());
      for (const p of pilots) await suggestions.answerSuggestion(id, p.id, "accepted");
      await suggestions.markStepDone(id, pilots[0].id, 0);
      await suggestions.lapseSuggestionsFor(pilots[1].id, packId);
      const [record] = await suggestions.listSuggestionsFor(pilots[2].id, packId);
      expect(record.status).toBe("accepted");
    });

    it("counts pilots on an open trade as taken, until it expires", async () => {
      const { pilots } = await threePilots(randomUUID());
      expect((await suggestions.matchingHistory(meta, new Date())).busyPilots.has(pilots[0].id)).toBe(true);
      const late = new Date(Date.now() + 2 * 86_400_000);
      expect((await suggestions.matchingHistory(meta, late)).busyPilots.has(pilots[0].id)).toBe(false);
    });
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

  describe("the trade board", () => {
    const meta = { base: `T${randomUUID().slice(0, 6)}`, aircraft: "B777", seat: "CAP", month: "OCT26" };
    const trip = (pairingNumber: string, startDayIndex: number) => ({
      lineNumber: "1", pairingNumber, days: 3, layoverCities: ["ANC"], international: false, reportTime: "early" as const,
      creditHours: 15, tafbHours: 60, landings: 4, deadheadLegs: 0, tripId: `p${pairingNumber}`, startDayIndex, date: null,
    });
    const offer = async (by: { id: string }, offered: ReturnType<typeof trip>, over: Partial<TradeOffer> = {}) => {
      const o: TradeOffer = {
        id: randomUUID(), bidPackMeta: meta, offeringUserId: by.id, offeringDisplayName: "Pilot", offeredTrip: offered, wantedPairingNumber: null, note: null,
        status: "open", createdAt: new Date().toISOString(), responderUserId: null, responderDisplayName: null, responderTrip: null, respondedAt: null, resolvedAt: null, ...over,
      };
      await mod.createTradeOffer(o);
      return o;
    };
    const propose = (o: TradeOffer, by: { id: string }, t: ReturnType<typeof trip>) =>
      mod.updateTradeOffer(o.id, { status: "pending", responderUserId: by.id, responderDisplayName: "Responder", responderTrip: t, respondedAt: new Date().toISOString() }, ["open"]);

    it("shows a pilot their seat's open offers and their own, never another seat's or others' trades in progress", async () => {
      const [me, other, third] = [await makeUser("board-me"), await makeUser("board-other"), await makeUser("board-third")];
      const mine = await offer(me, trip("1", 0), { status: "withdrawn" });
      const theirs = await offer(other, trip("2", 1));
      const inProgress = await offer(other, trip("3", 2));
      await propose(inProgress, third, trip("4", 3));
      await offer(other, trip("5", 4), { bidPackMeta: { ...meta, seat: "FO" } });
      await offer(other, trip("6", 5), { bidPackMeta: { ...meta, month: "NOV26" } });
      const ids = (await mod.listTradeOffersForSeat(meta, me.id, { othersOpen: true, limit: 50 })).map((o) => o.id);
      expect(ids.sort()).toEqual([mine.id, theirs.id].sort());
      // Before the seat's board opens, only their own.
      expect((await mod.listTradeOffersForSeat(meta, me.id, { othersOpen: false, limit: 50 })).map((o) => o.id)).toEqual([mine.id]);
    });

    it("on an accept, frees every other offer giving either trip, so one trip can't be agreed twice", async () => {
      const [a, b, c] = [await makeUser("accept-a"), await makeUser("accept-b"), await makeUser("accept-c")];
      const x = await offer(a, trip("13", 2));
      const sameTripAgain = await offer(a, trip("13", 2));
      const sameDifferentDay = await offer(a, trip("13", 9));
      const cOffer = await offer(c, trip("40", 4));
      await propose(x, b, trip("27", 6));
      await propose(sameTripAgain, c, trip("41", 7));
      // B also offered their trip to C.
      await propose(cOffer, b, trip("27", 6));
      const pending = (await mod.findTradeOffer(x.id))!;
      expect(await mod.acceptTradeOffer(x.id, "2000-01-01T00:00:00.000Z")).toBeNull();
      expect(await mod.acceptTradeOffer(x.id, pending.respondedAt)).toMatchObject({ status: "accepted" });
      expect((await mod.findTradeOffer(sameTripAgain.id))?.status).toBe("withdrawn");
      expect((await mod.findTradeOffer(sameDifferentDay.id))?.status).toBe("open");
      const reopened = await mod.findTradeOffer(cOffer.id);
      expect(reopened).toMatchObject({ status: "open", responderUserId: null, responderTrip: null });
      expect(await mod.acceptTradeOffer(x.id, null)).toBeNull();
    });

    it("after an accept, won't let either traded trip be offered, proposed or agreed again", async () => {
      const [a, b, c] = [await makeUser("again-a"), await makeUser("again-b"), await makeUser("again-c")];
      const x = await offer(a, trip("13", 2));
      await propose(x, b, trip("27", 6));
      expect(await mod.acceptTradeOffer(x.id, null)).toMatchObject({ status: "accepted" });

      // Posted again afterwards: refused, while another day of the pairing is fine.
      const again = { ...x, id: randomUUID(), status: "open" as const, responderUserId: null, responderDisplayName: null, responderTrip: null, respondedAt: null };
      expect(await mod.createTradeOffer(again)).toBe(false);
      expect(await mod.findTradeOffer(again.id)).toBeNull();
      expect(await mod.createTradeOffer({ ...again, offeredTrip: trip("13", 9) })).toBe(true);

      // Proposed on someone else's offer: refused, for either pilot's traded trip; another trip is fine.
      const cOffer = await offer(c, trip("40", 4));
      expect(await mod.respondToTradeOffer(cOffer.id, { id: b.id, displayName: "B" }, trip("27", 6))).toBe("traded");
      expect(await mod.respondToTradeOffer(cOffer.id, { id: a.id, displayName: "A" }, trip("13", 2))).toBe("traded");
      expect((await mod.findTradeOffer(cOffer.id))?.status).toBe("open");
      expect(await mod.respondToTradeOffer(cOffer.id, { id: a.id, displayName: "A" }, trip("14", 3))).toMatchObject({ status: "pending", responderUserId: a.id });
      // And one taken already is just not open.
      expect(await mod.respondToTradeOffer(cOffer.id, { id: b.id, displayName: "B" }, trip("28", 3))).toBeNull();

      // An offer of a traded trip left pending some other way still can't be agreed.
      const stale = await offer(a, trip("50", 1));
      await db.update(tradeOffers).set({ offeredTrip: trip("13", 2) }).where(eq(tradeOffers.id, stale.id));
      await propose(stale, c, trip("41", 7));
      expect(await mod.acceptTradeOffer(stale.id, null)).toBe("traded");
      expect((await mod.findTradeOffer(stale.id))?.status).toBe("pending");
    });

    it("shows other pilots' offers only on a seat's month the pilot holds or has the pack for", async () => {
      const [held, packed, stranger] = [await makeUser("seat-held"), await makeUser("seat-packed"), await makeUser("seat-stranger")];
      await mod.saveTradeHolding(held.id, { packId: `uploaded-${meta.base}-b777-cap-oct26`.toLowerCase(), bidPackMeta: meta, lineNumber: "1", trips: [] });
      await mod.saveBidPackRecord(packed.id, `uploaded-${meta.base}-${meta.aircraft}-${meta.seat}-${meta.month}`.toLowerCase(), Buffer.from("x"));
      await mod.saveBidPackRecord(stranger.id, `uploaded-${meta.base}-${meta.aircraft}-fo-${meta.month}`.toLowerCase(), Buffer.from("x"));
      expect(await mod.pilotHasSeatMonth(held.id, meta)).toBe(true);
      expect(await mod.pilotHasSeatMonth(packed.id, meta)).toBe(true);
      expect(await mod.pilotHasSeatMonth(stranger.id, meta)).toBe(false);
      expect(await mod.pilotHasSeatMonth(held.id, { ...meta, month: "NOV26" })).toBe(false);
      expect(await mod.pilotHasSeatMonth("not-a-uuid", meta)).toBe(false);
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

  describe("malformed ids: a Postgres uuid column throws on non-uuid input", () => {
    it("looks like 'not found' rather than crashing, for every uuid-keyed lookup", async () => {
      const garbage = "not-a-real-id";
      await expect(mod.findUserById(garbage)).resolves.toBeNull();
      await expect(mod.findCredentialByUserId(garbage)).resolves.toBeNull();
      await expect(mod.findTradeOffer(garbage)).resolves.toBeNull();
      await expect(mod.updateTradeOffer(garbage, { status: "accepted" }, ["pending"])).resolves.toBeNull();
      await expect(mod.getPreferenceProfile(garbage)).resolves.toBeNull();
      await expect(mod.savePreferenceProfile(garbage, fakeProfile())).resolves.toBeUndefined();
      await expect(mod.deletePreferenceProfile(garbage)).resolves.toBeUndefined();
      await expect(mod.deleteSessionsForUser(garbage)).resolves.toBeUndefined();
    });
  });

  describe("shared awards", () => {
    const stamp = randomUUID().slice(0, 8);
    const seat = { base: `T${stamp}`, aircraft: "MD11", seat: "CAP" as const };
    const packKey = (month: string) => `${month}|${seat.base}|md11|cap`.toLowerCase();
    const share = (hash: string, month: string, line: string, holderShown: boolean) =>
      mod.createAwardHistoryRecord(
        { id: randomUUID(), ...seat, month, seniorityRank: 5, seniorityTotalPilots: 100, outcome: "line", lineNumber: line, daysOff: 15, totalCreditHours: 70, totalTafbHours: 200, submittedAt: new Date().toISOString() },
        { pilotHash: hash, packKey: packKey(month), holderShown }
      );

    it("stores the answer, replaces a corrected report, and withdraws by hash", async () => {
      const [a, b] = [`a-${stamp}`, `b-${stamp}`];
      await share(a, "OCT26", "1", true);
      await share(a, "OCT26", "2", false);
      await share(a, "NOV26", "3", true);
      await share(b, "OCT26", "4", true);

      const oct = await mod.listAwardRowsForPack(packKey("OCT26"));
      expect(oct.map((r) => r.lineNumber).sort()).toEqual(["2", "4"]);
      expect(oct.find((r) => r.lineNumber === "2")?.holderShown).toBe(false);
      expect(Object.keys(oct[0])).not.toContain("id");
      expect(await mod.listAwardRowsForSeat(seat)).toHaveLength(3);

      expect(await mod.deleteAwardShares(a, packKey("OCT26"))).toBe(1);
      expect(await mod.listAwardRowsForSeat(seat)).toHaveLength(2);
      expect(await mod.deleteAwardShares(a)).toBe(1);
      expect(await mod.deleteAwardShares(a)).toBe(0);
      expect((await mod.listAwardRowsForSeat(seat)).map((r) => r.lineNumber)).toEqual(["4"]);
      expect(await mod.deleteAwardShares(b)).toBe(1);
    });

    it("keeps what a corrected report leaves out from the one it replaces", async () => {
      const c = `c-${stamp}`;
      const report = (line: string, rank: number) => ({ id: randomUUID(), ...seat, month: "DEC26", seniorityRank: rank, seniorityTotalPilots: 100, outcome: "line" as const, lineNumber: line, daysOff: 15, totalCreditHours: 70, totalTafbHours: 200, submittedAt: new Date().toISOString() });
      // The Logbook's share says everything; Strategies' form then reports the award without those answers.
      await mod.createAwardHistoryRecord(report("1", 5), { pilotHash: c, packKey: packKey("DEC26"), holderShown: true, monthFeel: "better", brainVersion: 27, notesUsed: true });
      await mod.createAwardHistoryRecord(report("1", 5), { pilotHash: c, packKey: packKey("DEC26") });
      let [row] = await db.select().from(awardHistoryRecords).where(eq(awardHistoryRecords.pilotHash, c));
      expect(row).toMatchObject({ holderShown: true, monthFeel: "better", brainVersion: 27, notesUsed: true });
      expect(row.checkedInAt).not.toBeNull();
      // An answer given replaces it, and a different seniority number isn't shown on the pilot's earlier yes.
      await mod.createAwardHistoryRecord(report("1", 6), { pilotHash: c, packKey: packKey("DEC26"), monthFeel: null });
      [row] = await db.select().from(awardHistoryRecords).where(eq(awardHistoryRecords.pilotHash, c));
      expect(row).toMatchObject({ holderShown: false, monthFeel: null, brainVersion: 27 });
      expect(await mod.deleteAwardShares(c)).toBe(1);
    });

    it("keeps one report when two arrive at once, and the database refuses a second row", async () => {
      const d = `d-${stamp}`;
      await Promise.all([share(d, "JAN27", "1", false), share(d, "JAN27", "2", false), share(d, "JAN27", "3", false)]);
      expect(await mod.listAwardRowsForPack(packKey("JAN27"))).toHaveLength(1);
      const [row] = await db.select().from(awardHistoryRecords).where(eq(awardHistoryRecords.pilotHash, d));
      await expect(db.insert(awardHistoryRecords).values({ ...row, id: randomUUID() })).rejects.toThrow();
      // Reports not linked to a pilot and pack aren't one per anything.
      const unlinked = { id: randomUUID(), ...seat, month: "JAN27", seniorityRank: 5, seniorityTotalPilots: 100, outcome: "line" as const, lineNumber: "9", daysOff: 15, totalCreditHours: 70, totalTafbHours: 200, submittedAt: new Date().toISOString() };
      await mod.createAwardHistoryRecord(unlinked);
      await mod.createAwardHistoryRecord({ ...unlinked, id: randomUUID() });
      expect((await mod.listAwardRowsForSeat(seat)).filter((r) => r.lineNumber === "9")).toHaveLength(2);
      await db.delete(awardHistoryRecords).where(and(eq(awardHistoryRecords.base, seat.base), isNull(awardHistoryRecords.pilotHash)));
      expect(await mod.deleteAwardShares(d)).toBe(1);
    });

    it("counts recent pilots with a real pack of this seat, and no other", async () => {
      const prefix = `uploaded-t${stamp}-md11-cap-`;
      const u1 = await makeUser("bar1");
      const u2 = await makeUser("bar2");
      await mod.saveBidPackRecord(u1.id, `${prefix}oct26`, Buffer.from("x"));
      await mod.saveBidPackRecord(u2.id, `uploaded-t${stamp}-md11-fo-oct26`, Buffer.from("x"));
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      expect(await mod.countRecentPilotsWithPack(prefix, weekAgo)).toBe(1);
      expect(await mod.countRecentPilotsWithPack(prefix, new Date(Date.now() + 60_000))).toBe(0);
    });
  });
});
