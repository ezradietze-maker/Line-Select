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
  it("are looked up by default — each group decides for itself whether its notes are on", async () => {
    expect(await fleetNotesFor(cohort)).toBeNull();
    expect(loadActiveModel).toHaveBeenCalledWith("brain");
  });

  it("stay out everywhere when the owner sets FLEET_NOTES=off, without touching the database", async () => {
    process.env.FLEET_NOTES = "off";
    expect(await fleetNotesFor(cohort)).toBeNull();
    expect(loadActiveModel).not.toHaveBeenCalled();
  });
});
