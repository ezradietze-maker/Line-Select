import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  isLearnerOff: vi.fn(async () => false),
  loadActiveModel: vi.fn(async () => ({ version: "b-1" })),
  rollBackModel: vi.fn(async () => ({ from: "b-2", to: "b-1" })),
  setLearnerOff: vi.fn(async () => {}),
}));
vi.mock("@/lib/server/learning-store", () => store);

const { GET, POST } = await import("./route");
const KEY = "test-admin-key";
const req = (body?: unknown, key: string | null = KEY) =>
  new Request("https://example.com/api/admin/learning", { method: body ? "POST" : "GET", headers: key ? { "x-admin-key": key } : {}, body: body ? JSON.stringify(body) : undefined });

beforeEach(() => {
  process.env.ADMIN_API_KEY = KEY;
  for (const f of Object.values(store)) f.mockClear();
});

describe("/api/admin/learning", () => {
  it("hides itself without the admin key", async () => {
    expect((await GET(req(undefined, null))).status).toBe(404);
    expect((await POST(req({ kind: "brain", action: "off" }, "wrong"))).status).toBe(404);
    expect(store.setLearnerOff).not.toHaveBeenCalled();
  });

  it("switches a learner off and on", async () => {
    expect(await (await POST(req({ kind: "brain", action: "off" }))).json()).toEqual({ kind: "brain", off: true });
    expect(store.setLearnerOff).toHaveBeenLastCalledWith("brain", true);
    await POST(req({ kind: "brain", action: "on" }));
    expect(store.setLearnerOff).toHaveBeenLastCalledWith("brain", false);
  });

  it("undoes to the previous version", async () => {
    expect(await (await POST(req({ kind: "forecast-calibration", action: "undo" }))).json()).toEqual({ kind: "forecast-calibration", undone: { from: "b-2", to: "b-1" } });
  });

  it("refuses anything else", async () => {
    expect((await POST(req({ kind: "everything", action: "off" }))).status).toBe(400);
    expect((await POST(req({ kind: "brain", action: "delete" }))).status).toBe(400);
  });
});
