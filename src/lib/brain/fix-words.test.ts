import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixModelWords } from "@/lib/brain/fix-words";
import { structuredCall } from "@/lib/brain/llm";
import type { PilotModel } from "@/types/pilot-model";

vi.mock("@/lib/brain/llm", () => ({
  structuredCall: vi.fn(),
  failedCallCost: (e: { usage?: { costUsd?: number } }) => e?.usage?.costUsd ?? 0,
}));

const call = vi.mocked(structuredCall);

const model = (over: Partial<PilotModel> = {}) =>
  ({
    synopsis: "You bid for time at home.",
    criteria: [{ id: "nights", metric: "nightsWorked", label: "Few nights worked" }],
    threads: [{ id: "t1", topic: "How many nights in a row?" }],
    ...over,
  }) as unknown as PilotModel;

const reply = (lines: { id: string; text: string }[]) => ({ data: { lines }, usage: { model: "m", inputTokens: 0, outputTokens: 0, costUsd: 0.001, ms: 1 } });

beforeEach(() => {
  call.mockReset();
});

describe("fixModelWords", () => {
  it("costs nothing when every word is the pack's or a pilot's", async () => {
    const m = model();
    expect(await fixModelWords(m, "")).toEqual({ model: m, costUsd: 0 });
    expect(call).not.toHaveBeenCalled();
  });

  it("rewords only the lines at fault, and says what to use instead", async () => {
    call.mockResolvedValue(reply([{ id: "synopsis", text: "You hate night flying." }, { id: "thread:t1", text: "How many nights of night flying in a row?" }]) as never);
    const { model: fixed, costUsd } = await fixModelWords(model({ synopsis: "You hate red-eyes.", threads: [{ id: "t1", topic: "How many red-eyes in a row?" }] } as never), "");
    expect(fixed.synopsis).toBe("You hate night flying.");
    expect(fixed.threads[0].topic).toBe("How many nights of night flying in a row?");
    expect(fixed.criteria[0].label).toBe("Few nights worked");
    expect(costUsd).toBe(0.001);
    const fresh = (call.mock.calls[0][0] as { user: { fresh: string } }).user.fresh;
    expect(fresh).toMatch(/instead of "red-eyes", say night flying/);
    expect(fresh).not.toMatch(/Few nights worked/);
  });

  it("leaves a word the pilot brought up themselves", async () => {
    const m = model({ synopsis: "You hate red-eyes." });
    expect((await fixModelWords(m, "I hate red-eyes into Memphis.")).model.synopsis).toBe("You hate red-eyes.");
    expect(call).not.toHaveBeenCalled();
  });

  it("doesn't take a rewording that still has a banned word", async () => {
    call.mockResolvedValue(reply([{ id: "synopsis", text: "You hate all-nighters." }]) as never);
    expect((await fixModelWords(model({ synopsis: "You hate red-eyes." }), "")).model.synopsis).toBe("You hate red-eyes.");
  });

  it("falls back to the measure's own name for a priority if the call fails, keeping what it cost", async () => {
    call.mockRejectedValue(Object.assign(new Error("down"), { usage: { costUsd: 0.002 } }));
    const { model: fixed, costUsd } = await fixModelWords(model({ criteria: [{ id: "nights", metric: "nightsWorked", label: "Few red-eyes" }] } as never), "");
    expect(fixed.criteria[0].label).toBe("Nights worked");
    expect(costUsd).toBe(0.002);
  });
});
