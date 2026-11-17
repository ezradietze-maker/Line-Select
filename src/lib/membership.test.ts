import { describe, expect, it } from "vitest";
import { FREE_FOR_ALL, FREE_MEMBER_CAP, FREE_PREVIEW_LINES, MEMBERSHIP_CUTOVER, freeSlotsLeft, hasAccess, inPreview, isMember, membershipTier } from "@/lib/membership";
import type { UserAccount } from "@/types/auth";

const CUTOVER = Date.parse(MEMBERSHIP_CUTOVER);
const BEFORE = new Date(CUTOVER - 86_400_000).toISOString(); // a day before the cutover
const AFTER = new Date(CUTOVER + 86_400_000).toISOString(); // a day after

function user(partial: Partial<UserAccount>): UserAccount {
  return { id: "u", email: "a@b.c", displayName: "A", createdAt: AFTER, plan: "free", ...partial };
}

describe("membershipTier", () => {
  it("grandfathers accounts created before the cutover, whatever their plan or slot", () => {
    expect(membershipTier(user({ createdAt: BEFORE }))).toBe("grandfathered");
    expect(membershipTier(user({ createdAt: BEFORE, plan: "pro" }))).toBe("grandfathered");
  });

  it("is pro for a post-cutover account on the pro plan", () => {
    expect(membershipTier(user({ createdAt: AFTER, plan: "pro" }))).toBe("pro");
  });

  it("is free for a post-cutover account that claimed a slot", () => {
    expect(membershipTier(user({ createdAt: AFTER, plan: "free", freeMemberAt: AFTER }))).toBe("free");
  });

  it("is locked for a post-cutover account with no plan and no slot", () => {
    expect(membershipTier(user({ createdAt: AFTER, plan: "free", freeMemberAt: null }))).toBe("locked");
  });

  it("is locked for nobody signed in", () => {
    expect(membershipTier(null)).toBe("locked");
  });
});

describe("isMember (the enforced check, ignoring the master switch)", () => {
  it("is true for grandfathered, pro and free; false for locked", () => {
    expect(isMember(user({ createdAt: BEFORE }))).toBe(true);
    expect(isMember(user({ createdAt: AFTER, plan: "pro" }))).toBe(true);
    expect(isMember(user({ createdAt: AFTER, freeMemberAt: AFTER }))).toBe(true);
    expect(isMember(user({ createdAt: AFTER, plan: "free", freeMemberAt: null }))).toBe(false);
    expect(isMember(null)).toBe(false);
  });
});

describe("hasAccess", () => {
  it("is enforced: a locked pilot or a guest has no access, a member does", () => {
    // Memberships are live: the master switch is off.
    expect(FREE_FOR_ALL).toBe(false);
    expect(hasAccess(user({ createdAt: AFTER, plan: "free", freeMemberAt: null }))).toBe(false);
    expect(hasAccess(null)).toBe(false);
    expect(hasAccess(user({ createdAt: AFTER, plan: "pro", freeMemberAt: null }))).toBe(true);
  });
});

describe("freeSlotsLeft", () => {
  it("counts down from the cap and never goes negative", () => {
    expect(freeSlotsLeft(0)).toBe(FREE_MEMBER_CAP);
    expect(freeSlotsLeft(14)).toBe(FREE_MEMBER_CAP - 14);
    expect(freeSlotsLeft(FREE_MEMBER_CAP)).toBe(0);
    expect(freeSlotsLeft(FREE_MEMBER_CAP + 5)).toBe(0);
  });
});

describe("inPreview", () => {
  it("shows a non-member only their top lines, by their ranking", () => {
    expect(FREE_PREVIEW_LINES).toBe(10);
    expect(inPreview(1, FREE_PREVIEW_LINES)).toBe(true);
    expect(inPreview(10, FREE_PREVIEW_LINES)).toBe(true);
    expect(inPreview(11, FREE_PREVIEW_LINES)).toBe(false);
    expect(inPreview(undefined, FREE_PREVIEW_LINES)).toBe(false);
  });

  it("shows a member every line", () => {
    expect(inPreview(500, null)).toBe(true);
    expect(inPreview(undefined, null)).toBe(true);
  });
});
