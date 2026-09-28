import { describe, expect, it } from "vitest";
import { isJsonObject, isText } from "@/lib/server/json-body";
import { sanitizeBidPackMeta, sanitizeTripSnapshot } from "@/lib/server/trade-validation";
import { tripToSnapshot } from "@/lib/trade-client";
import { SAMPLE_BID_PACK } from "@/lib/sample-bidpack";

const good = () => tripToSnapshot(SAMPLE_BID_PACK.lines[0].trips[0], "9001");

describe("request body helpers", () => {
  it("only treats a plain object as an object body", () => {
    expect([{}, { a: 1 }].every(isJsonObject)).toBe(true);
    expect([null, [], "x", 5, undefined, true].some(isJsonObject)).toBe(false);
  });

  it("checks text is a real, bounded string", () => {
    expect(isText("hello", 10)).toBe(true);
    expect([5, "", "x".repeat(11), null, {}].some((v) => isText(v, 10))).toBe(false);
  });
});

describe("trade snapshot validation", () => {
  it("accepts exactly what the app itself sends", () => {
    expect(sanitizeTripSnapshot(good())).toEqual(good());
  });

  it("rebuilds the snapshot field by field, dropping anything extra a client added", () => {
    const clean = sanitizeTripSnapshot({ ...good(), schedule: new Array(50000).fill("x"), evil: "<script>" })!;
    expect(Object.keys(clean).sort()).toEqual(Object.keys(good()).sort());
  });

  it("rejects missing, mistyped, or out-of-range fields", () => {
    for (const bad of [
      null, "x", [], {},
      { ...good(), days: "3" },
      { ...good(), days: 400 },
      { ...good(), creditHours: -1 },
      { ...good(), reportTime: "midnight" },
      { ...good(), layoverCities: "LAX" },
      { ...good(), layoverCities: new Array(60).fill("LAX") },
      { ...good(), lineNumber: "x".repeat(50) },
      { ...good(), international: "yes" },
    ]) {
      expect(sanitizeTripSnapshot(bad)).toBeNull();
    }
  });

  it("allows an estimated trip with no pairing number", () => {
    expect(sanitizeTripSnapshot({ ...good(), pairingNumber: null })!.pairingNumber).toBeNull();
  });

  it("validates the bid pack summary the same way", () => {
    expect(sanitizeBidPackMeta({ base: "MEM", aircraft: "B777", seat: "CAP", month: "OCT26", extra: 1 })).toEqual({ base: "MEM", aircraft: "B777", seat: "CAP", month: "OCT26" });
    expect(sanitizeBidPackMeta({ base: "MEM" })).toBeNull();
    expect(sanitizeBidPackMeta("x")).toBeNull();
  });
});
