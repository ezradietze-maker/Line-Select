import { afterEach, describe, expect, it, vi } from "vitest";

const loadActiveModel = vi.fn(async () => null);
vi.mock("@/lib/server/learning-store", () => ({ loadActiveModel }));

const { fleetNotesFor } = await import("./fleet-notes");

const cohort = { base: "MEM", aircraft: "MD11", seat: "CAP", commute: "commuter" as const };

afterEach(() => {
  delete process.env.FLEET_NOTES;
  loadActiveModel.mockClear();
});

describe("fleet notes", () => {
  it("are off unless switched on, without touching the database", async () => {
    expect(await fleetNotesFor(cohort)).toBeNull();
    expect(loadActiveModel).not.toHaveBeenCalled();
  });

  it("are looked up once switched on", async () => {
    process.env.FLEET_NOTES = "on";
    expect(await fleetNotesFor(cohort)).toBeNull();
    expect(loadActiveModel).toHaveBeenCalledWith("brain");
  });
});
