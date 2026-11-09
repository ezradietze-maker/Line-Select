import { beforeEach, describe, expect, it, vi } from "vitest";

const llm = vi.hoisted(() => ({ structuredCall: vi.fn() }));
vi.mock("@/lib/brain/llm", async (real) => ({ ...(await real<typeof import("@/lib/brain/llm")>()), structuredCall: llm.structuredCall }));
const limits = vi.hoisted(() => {
  const state = { day: { ok: true }, hour: { ok: true }, checkDaily: vi.fn(async () => state.day) };
  return state;
});
vi.mock("@/lib/server/rate-limit", async (real) => ({
  ...(await real<typeof import("@/lib/server/rate-limit")>()),
  checkRateLimit: limits.checkDaily,
  checkRequestLimit: vi.fn(async () => limits.hour),
}));
const spend = vi.hoisted(() => ({ check: { ok: true } as { ok: boolean; scope?: string }, recordSpend: vi.fn(async () => {}), signedIn: true }));
vi.mock("@/lib/server/spend-guard", async (real) => ({
  ...(await real<typeof import("@/lib/server/spend-guard")>()),
  checkSpend: vi.fn(async () => spend.check),
  recordSpend: spend.recordSpend,
  spenderFor: vi.fn(async () => ({ key: "u:1", signedIn: spend.signedIn })),
}));
const remembered = vi.hoisted(() => [] as { status: number; body: unknown }[]);
vi.mock("@/lib/server/replay", () => ({
  onceForRequest: (_r: Request, _w: number, run: () => Promise<Response>) => run(),
  onceForStream: (_r: Request, _w: number, run: (remember: (status: number, body: unknown) => Promise<void>) => Promise<Response>) =>
    run(async (status, body) => {
      remembered.push({ status, body });
    }),
}));
vi.mock("@/lib/server/alerts", () => ({ reportProblem: vi.fn(async () => {}) }));

const { POST } = await import("./route");
const req = (body: unknown) => new Request("https://example.com/api/contract/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const QUOTE = "The SWW is a period of not less than 115 hours beginning at 1700 CT the day following the posting of the View/Add Processing Window results.";
const usage = { model: "claude-haiku-5-5", inputTokens: 1, outputTokens: 1, costUsd: 0.001, ms: 1 };
const reply = (data: unknown) => ({ data, usage });

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test";
  llm.structuredCall.mockReset();
  spend.recordSpend.mockClear();
  spend.check = { ok: true };
  spend.signedIn = true;
  limits.day = { ok: true };
  limits.hour = { ok: true };
  remembered.length = 0;
});

const streamReq = (body: unknown) => new Request("https://example.com/api/contract/ask", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify(body) });
async function messages(res: Response) {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { type: string; text?: string; answer?: { found: boolean; answer: string }; error?: string });
}

describe("POST /api/contract/ask, streamed", () => {
  it("shows each step as it's done, then the checked answer, and remembers the reply for a resend", async () => {
    llm.structuredCall.mockResolvedValue(reply({ found: true, answer: "At least 115 hours.", quotes: [{ section: "25.E.6", quote: QUOTE, version: "2026" }] }));
    const res = await POST(streamReq({ question: "How long is the SWW?", bidMonth: "2026-11" }));
    expect(res.headers.get("content-type")).toContain("ndjson");
    const all = await messages(res);
    const steps = all.filter((m) => m.type === "step").map((m) => m.text!);
    expect(steps[0]).toBe("Searching the contract for long, SWW, secondary working window…");
    expect(steps.some((t) => t.startsWith("Found "))).toBe(true);
    expect(steps.some((t) => t.startsWith("Reading "))).toBe(true);
    expect(steps).toContain("Writing the answer from those sections…");
    expect(steps).toContain("The quote matches word for word.");
    expect(steps[steps.length - 1]).toContain("25.E.6: starts by the December 2026 bid period");
    expect(all[all.length - 1]).toMatchObject({ type: "answer", answer: { found: true } });
    expect(remembered).toEqual([{ status: 200, body: { answer: expect.objectContaining({ found: true }) } }]);
    expect(spend.recordSpend).toHaveBeenCalledWith(expect.anything(), 0.001);
  });

  it("never lets an answer that failed the checks into the stream", async () => {
    const made = "Section 25.E.99 says it's 999 hours.";
    llm.structuredCall.mockResolvedValue(reply({ found: true, answer: made, quotes: [{ section: "25.E.99", quote: QUOTE, version: "2026" }] }));
    const res = await POST(streamReq({ question: "How long is the SWW?" }));
    const text = await res.clone().text();
    expect(text).not.toContain("999");
    expect(text).not.toContain("25.E.99");
    const all = await messages(res);
    expect(all.map((m) => m.text)).toEqual(expect.arrayContaining(["Something didn't match the contract, so that answer won't be shown. Trying once more…", "That still didn't check out, so it won't be shown."]));
    expect(all[all.length - 1]).toMatchObject({ type: "answer", answer: { found: false, answer: "Not found in the contract sections we have." } });
  });

  it("a follow-up carries the earlier question to the model, marked as not evidence, and gets the same checks", async () => {
    llm.structuredCall.mockResolvedValue(reply({ found: true, answer: "It was 115 hours, you said 999.", quotes: [{ section: "25.E.6", quote: QUOTE, version: "2026" }] }));
    const history = [{ question: "How long is the SWW?", answer: "It's 999 hours.", sections: ["25.E.6"] }];
    const all = await messages(await POST(streamReq({ question: "and what can I do during it?", history })));
    const sent = llm.structuredCall.mock.calls[0][0];
    expect(sent.user.fresh).toContain("<earlier_conversation>");
    expect(sent.user.cached).toContain("[25.E.6]");
    expect(sent.system).toContain("Earlier answers are not evidence");
    expect(all.map((m) => m.text)).toContain("Keeping your earlier question in mind.");
    // 999 comes only from the earlier answer, so it doesn't count as backed up.
    expect(all[all.length - 1]).toMatchObject({ answer: { found: false } });
  });

  it("turns down an oversized conversation", async () => {
    const turn = { question: "q", answer: "a", sections: [] };
    expect((await POST(streamReq({ question: "q?", history: [turn, turn, turn, turn] }))).status).toBe(400);
    expect((await POST(streamReq({ question: "q?", history: [{ ...turn, answer: "x".repeat(1501) }] }))).status).toBe(400);
    expect((await POST(streamReq({ question: "q?", history: [{ ...turn, sections: "25.E.6" }] }))).status).toBe(400);
    expect(llm.structuredCall).not.toHaveBeenCalled();
  });

  it("says so when the model call fails, remembers the failure, and counts the cost", async () => {
    llm.structuredCall.mockRejectedValue(Object.assign(new Error("down"), { usage: { costUsd: 0.0005 } }));
    const all = await messages(await POST(streamReq({ question: "How long is the SWW?" })));
    expect(all[all.length - 1]).toMatchObject({ type: "error", error: expect.stringContaining("try again") });
    expect(remembered[0].status).toBe(502);
    expect(spend.recordSpend).toHaveBeenCalledWith(expect.anything(), 0.0005);
  });

  it("doesn't pay the model when no section has the words", async () => {
    const all = await messages(await POST(streamReq({ question: "zzzzqqq xxyyzz" })));
    expect(llm.structuredCall).not.toHaveBeenCalled();
    expect(all.map((m) => m.text)).toContain("No section uses those words.");
    expect(all[all.length - 1]).toMatchObject({ answer: { found: false } });
  });
});

describe("POST /api/contract/ask", () => {
  it("returns a checked answer with its section, page and phase, and records the cost", async () => {
    llm.structuredCall.mockResolvedValue(reply({ found: true, answer: "At least 115 hours.", quotes: [{ section: "25.E.6", quote: QUOTE, version: "2026" }] }));
    const res = await POST(req({ question: "How long is the SWW?", bidMonth: "2026-11" }));
    expect(res.status).toBe(200);
    const { answer } = await res.json();
    expect(answer).toMatchObject({ found: true, quotes: [{ section: "25.E.6", page: 158, applies: { kind: "scheduled", phase: 2, inForce: false } }] });
    expect(answer.quotes[0].otherWording).toContain("144 hours");
    expect(spend.recordSpend).toHaveBeenCalledWith(expect.anything(), 0.001);
  });

  it("a made-up section twice over is not found, and both calls are paid for", async () => {
    llm.structuredCall.mockResolvedValue(reply({ found: true, answer: "Yes.", quotes: [{ section: "25.E.99", quote: QUOTE, version: "2026" }] }));
    const { answer } = await (await POST(req({ question: "How long is the SWW?" }))).json();
    expect(answer.found).toBe(false);
    expect(answer.answer).toBe("Not found in the contract sections we have.");
    expect(answer.closest.length).toBeGreaterThan(0);
    expect(answer.covered).toContain("Section 25: Scheduling");
    expect(llm.structuredCall).toHaveBeenCalledTimes(2);
    expect(spend.recordSpend).toHaveBeenCalledWith(expect.anything(), 0.002);
  });

  it("a slip caught the first time gets one more try", async () => {
    llm.structuredCall
      .mockResolvedValueOnce(reply({ found: true, answer: "144 hours.", quotes: [{ section: "25.E.6", quote: QUOTE.replace("115", "144"), version: "2026" }] }))
      .mockResolvedValueOnce(reply({ found: true, answer: "At least 115 hours.", quotes: [{ section: "25.E.6", quote: QUOTE, version: "2026" }] }));
    const { answer } = await (await POST(req({ question: "How long is the SWW?" }))).json();
    expect(answer.found).toBe(true);
    expect(llm.structuredCall.mock.calls[1][0].user.fresh).toContain("failed a check");
  });

  it("not found from the model costs one call", async () => {
    llm.structuredCall.mockResolvedValue(reply({ found: false, answer: "", quotes: [] }));
    const { answer } = await (await POST(req({ question: "How do I reset my VIPS password?" }))).json();
    expect(answer.found).toBe(false);
    expect(llm.structuredCall).toHaveBeenCalledTimes(1);
  });

  it("stops at the limits before paying for anything", async () => {
    limits.hour = { ok: false };
    expect((await POST(req({ question: "q?" }))).status).toBe(429);
    limits.hour = { ok: true };
    limits.day = { ok: false };
    spend.signedIn = false;
    const guest = await POST(req({ question: "q?" }));
    expect(guest.status).toBe(429);
    expect((await guest.json()).error).toContain("Sign in");
    limits.day = { ok: true };
    spend.check = { ok: false, scope: "pilot" };
    expect((await POST(req({ question: "q?" }))).status).not.toBe(200);
    expect(llm.structuredCall).not.toHaveBeenCalled();
  });

  it("gives a signed-in pilot 40 questions a day and a guest 5", async () => {
    llm.structuredCall.mockResolvedValue(reply({ found: false, answer: "", quotes: [] }));
    limits.checkDaily.mockClear();
    await POST(req({ question: "How long is the SWW?" }));
    expect(limits.checkDaily).toHaveBeenCalledWith("contract-ask-day", "u:1", 40, 86_400);
    spend.signedIn = false;
    await POST(req({ question: "How long is the SWW?" }));
    expect(limits.checkDaily).toHaveBeenLastCalledWith("contract-ask-day", "u:1", 5, 86_400);
  });

  it("turns down an empty or oversized question and oversized facts", async () => {
    expect((await POST(req({ question: "  " }))).status).toBe(400);
    expect((await POST(req({ question: "x".repeat(501) }))).status).toBe(400);
    expect((await POST(req({ question: "q?", facts: "x".repeat(2001) }))).status).toBe(400);
    expect(llm.structuredCall).not.toHaveBeenCalled();
  });

  it("says so when the model call fails, and counts what it cost", async () => {
    llm.structuredCall.mockRejectedValue(Object.assign(new Error("down"), { usage: { costUsd: 0.0005 } }));
    const res = await POST(req({ question: "How long is the SWW?" }));
    expect(res.status).toBe(502);
    expect(spend.recordSpend).toHaveBeenCalledWith(expect.anything(), 0.0005);
  });
});
