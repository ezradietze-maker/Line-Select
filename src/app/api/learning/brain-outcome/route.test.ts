import { beforeEach, describe, expect, it, vi } from "vitest";

const saved: { pilotHash: string | null }[] = [];
let user: { id: string; emailVerified?: boolean } | null = null;

vi.mock("@/lib/server/auth", () => ({ getCurrentServerUser: async () => user }));
vi.mock("@/lib/server/rate-limit", () => ({ checkRequestLimit: async () => ({ ok: true }), rateLimitedResponse: () => new Response(null, { status: 429 }) }));
vi.mock("@/lib/server/learning-store", () => ({ saveBrainOutcome: async (_o: unknown, pilotHash: string | null) => void saved.push({ pilotHash }) }));
vi.mock("@/lib/server/learning-runner", () => ({ maybeLearn: async () => null }));
vi.mock("@/lib/server/after-response", () => ({ afterResponse: () => {} }));
vi.mock("@/lib/server/forecast-store", () => ({ hashUser: (id: string) => `hash-${id}` }));

const { POST } = await import("./route");

const outcome = { v: 2, month: "DEC26", cohort: { base: "MEM", aircraft: "MD11", seat: "CAP", commute: "commuter", seniority: "middle" }, checkIn: false, questions: 20, choices: 4, criteria: [], cities: {}, review: [] };
const post = () => POST(new Request("https://example.com/api/learning/brain-outcome", { method: "POST", body: JSON.stringify(outcome) }));

beforeEach(() => {
  saved.length = 0;
  user = null;
});

describe("brain outcomes", () => {
  it("are not stored for a guest", async () => {
    const res = await post();
    expect(await res.json()).toEqual({ stored: false });
    expect(saved).toHaveLength(0);
  });

  it("are stored for a signed-in pilot, under their hashed id", async () => {
    user = { id: "pilot-1", emailVerified: true };
    const res = await post();
    expect(await res.json()).toEqual({ stored: true });
    expect(saved).toEqual([{ pilotHash: "hash-pilot-1" }]);
  });

  it("are not stored for an account whose email isn't confirmed: it may be one of many one person made", async () => {
    user = { id: "pilot-1", emailVerified: false };
    expect(await (await post()).json()).toEqual({ stored: false });
    expect(saved).toHaveLength(0);
  });
});
