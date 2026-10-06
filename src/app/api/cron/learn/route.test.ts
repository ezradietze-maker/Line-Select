import { afterEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({ runLearningCycle: vi.fn(async (trigger: string) => ({ trigger, results: [] })), maybeLearn: vi.fn() }));
vi.mock("@/lib/server/learning-runner", () => runner);
vi.mock("@/lib/server/learning-store", () => ({ listRecentRuns: vi.fn(async () => []), loadActiveModel: vi.fn(async () => null) }));

import { GET as cron } from "./route";
import { GET as status, POST as runNow } from "@/app/api/learning/status/route";

/** The learning can only be set running by Vercel's scheduler or an admin — never by anyone who finds the URL. */
describe("learning triggers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    runner.runLearningCycle.mockClear();
  });

  it("runs on the schedule only with the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await cron(new Request("http://x/api/cron/learn"))).status).toBe(404);
    expect((await cron(new Request("http://x/api/cron/learn", { headers: { authorization: "Bearer wrong" } }))).status).toBe(404);
    expect(runner.runLearningCycle).not.toHaveBeenCalled();
    const res = await cron(new Request("http://x/api/cron/learn", { headers: { authorization: "Bearer s3cret" } }));
    expect(res.status).toBe(200);
    expect(runner.runLearningCycle).toHaveBeenCalledWith("schedule");
  });

  it("never runs when no cron secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await cron(new Request("http://x/api/cron/learn", { headers: { authorization: "Bearer " } }))).status).toBe(404);
  });

  it("shows status and runs on demand only for an admin", async () => {
    vi.stubEnv("ADMIN_API_KEY", "admin-key");
    expect((await status(new Request("http://x/api/learning/status"))).status).toBe(404);
    expect((await runNow(new Request("http://x/api/learning/status", { method: "POST", headers: { "x-admin-key": "nope" } }))).status).toBe(404);
    expect((await status(new Request("http://x/api/learning/status", { headers: { "x-admin-key": "admin-key" } }))).status).toBe(200);
    await runNow(new Request("http://x/api/learning/status", { method: "POST", headers: { "x-admin-key": "admin-key" } }));
    expect(runner.runLearningCycle).toHaveBeenCalledWith("manual");
  });
});
