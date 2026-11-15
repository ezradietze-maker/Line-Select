import { beforeEach, describe, expect, it, vi } from "vitest";
import { MEMBERSHIP_CUTOVER } from "@/lib/membership";
import type { UserAccount } from "@/types/auth";

/**
 * Who may take one of the free spots. The model is tested as it will run once `FREE_FOR_ALL` is flipped off (the switch
 * itself stays on in the app): `hasAccess` is then `isMember`. One test keeps the real switch, as production has it.
 */
const state = vi.hoisted(() => ({ enforced: true, user: null as UserAccount | null }));
vi.mock("@/lib/membership", async (real) => {
  const m = await real<typeof import("@/lib/membership")>();
  return { ...m, hasAccess: (u: UserAccount | null) => (state.enforced ? m.isMember(u) : m.hasAccess(u)) };
});
vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => state.user }));
const db = vi.hoisted(() => ({ claimFreeMember: vi.fn() }));
vi.mock("@/lib/server/db", () => db);

const { POST } = await import("./route");

const AFTER = new Date(Date.parse(MEMBERSHIP_CUTOVER) + 86_400_000).toISOString();
const BEFORE = new Date(Date.parse(MEMBERSHIP_CUTOVER) - 86_400_000).toISOString();
const NEW_PILOT: UserAccount = { id: "11111111-1111-4111-8111-111111111111", email: "p@example.com", displayName: "P", createdAt: AFTER, plan: "free", emailVerified: true, freeMemberAt: null };
const claim = () => POST(new Request("https://lineselect.test/api/billing/claim-free", { method: "POST", body: "{}" }));

beforeEach(() => {
  state.enforced = true;
  state.user = NEW_PILOT;
  db.claimFreeMember.mockReset().mockResolvedValue("claimed");
});

describe("POST /api/billing/claim-free", () => {
  it("gives a new, confirmed pilot with no membership a spot", async () => {
    const res = await claim();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ claimed: true, already: false });
    expect(db.claimFreeMember).toHaveBeenCalledWith(NEW_PILOT.id);
  });

  it("won't give one to an account whose email isn't confirmed", async () => {
    // An account made in a minute and never confirmed took a spot, so a few of them could take all 15.
    state.user = { ...NEW_PILOT, emailVerified: false };
    const res = await claim();
    expect(res.status).toBe(403);
    expect((await res.json()).confirmEmail).toBe(true);
    expect(db.claimFreeMember).not.toHaveBeenCalled();
  });

  it("won't give one to a pilot who already has the whole app: an older account, or a live membership", async () => {
    // Each took a spot for good (nothing gives one back), leaving one fewer for a new pilot.
    for (const user of [{ ...NEW_PILOT, createdAt: BEFORE }, { ...NEW_PILOT, plan: "pro" as const }]) {
      state.user = user;
      const res = await claim();
      expect(res.status).toBe(409);
      expect((await res.json()).reason).toBe("member");
    }
    expect(db.claimFreeMember).not.toHaveBeenCalled();
  });

  it("won't take one while the whole app is free for everyone, as it is today", async () => {
    // An account made after the cutover is "locked" on the model's merits, though it has full access while it's all free.
    state.enforced = false;
    const res = await claim();
    expect(res.status).toBe(409);
    expect(db.claimFreeMember).not.toHaveBeenCalled();
  });

  it("answers a pilot who already holds a spot as claimed, without asking again", async () => {
    state.user = { ...NEW_PILOT, freeMemberAt: AFTER };
    expect(await (await claim()).json()).toEqual({ claimed: true, already: true });
    expect(db.claimFreeMember).not.toHaveBeenCalled();
  });

  it("says so when the spots are gone", async () => {
    db.claimFreeMember.mockResolvedValue("full");
    const res = await claim();
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("full");
  });
});
