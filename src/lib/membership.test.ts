import { describe, expect, it } from "vitest";
import { FREE_FOR_ALL, FREE_MEMBER_CAP, MEMBERSHIP_CUTOVER, freeSlotsLeft, hasAccess, isMember, membershipTier } from "@/lib/membership";
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
  it("while FREE_FOR_ALL is on, everyone has access — even a locked pilot", () => {
    // Guards the dormant state: shipping this model changes nothing until the switch is flipped.
    expect(FREE_FOR_ALL).toBe(true);
    expect(hasAccess(user({ createdAt: AFTER, plan: "free", freeMemberAt: null }))).toBe(true);
    expect(hasAccess(null)).toBe(true);
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
