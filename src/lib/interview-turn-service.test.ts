import { describe, expect, it } from "vitest";
import { buildTurnTool, parseMeasurableBinding, parseProfileUpdates, parseQuestion, parseSpecificDates } from "@/lib/interview-turn-service";

/**
 * Regression coverage for a real live-usage failure: with only soft prompt
 * guidance ("treat early turns as still exploring"), the model wrapped up a
 * real pilot's interview after just 4 turns, nowhere near enough to touch a
 * meaningful slice of the 15-topic backlog. Fixed by dropping "wrap_up" from
 * the tool's own action enum before MIN_TURNS_BEFORE_WRAP, so the model
 * cannot select it no matter how it reads the conversation.
 */
describe("buildTurnTool", () => {
  it("excludes wrap_up from the action enum before the floor", () => {
    const tool = buildTurnTool(false);
    const properties = tool.input_schema.properties as Record<string, { enum?: string[] }>;
    const actionSchema = properties.action;
    expect(actionSchema.enum).toEqual(["ask"]);
  });

  it("includes wrap_up in the action enum once the floor is reached", () => {
    const tool = buildTurnTool(true);
    const properties = tool.input_schema.properties as Record<string, { enum?: string[] }>;
    const actionSchema = properties.action;
    expect(actionSchema.enum).toEqual(["ask", "wrap_up"]);
  });
});

/**
 * Regression coverage for a real, live-confirmed bug: EXPLICIT_TARGET_KEYS
 * (the runtime allowlist `isExplicitTargetKey` checks against) never
 * included "circadianTolerance", even though `types/preferences.ts`'s
 * `ExplicitTargetKey` union, the system prompt's own catalog section, and
 * `TARGET_UNIT_LABELS` all correctly treated it as a real explicit-target
 * id. The model asked the report-time-circadian question, the pilot gave an
 * unambiguous numeric answer ("two in a row is where it wears on me"), and
 * the resulting explicit-target fact was silently dropped by
 * `parseProfileUpdates`'s "claimed measurable but didn't bind to anything
 * real" guard — confirmed live by inspecting the actual stored profile,
 * which had every other captured fact except this one.
 */
describe("circadianTolerance validation (regression)", () => {
  it("accepts an explicit-target measurable binding for circadianTolerance", () => {
    const binding = parseMeasurableBinding({ type: "explicit-target", key: "circadianTolerance", value: 2 });
    expect(binding).toEqual({ type: "explicit-target", key: "circadianTolerance", value: 2, rangeRole: undefined });
  });

  it("never gives circadianTolerance a rangeRole even if one is supplied — it's always a bare pinned number", () => {
    const binding = parseMeasurableBinding({
      type: "explicit-target",
      key: "circadianTolerance",
      value: 2,
      rangeRole: "max",
    });
    expect(binding).toMatchObject({ rangeRole: undefined });
  });

  it("accepts a target-slider question bound to circadianTolerance", () => {
    const question = parseQuestion({
      kind: "target-slider",
      prompt: "How many consecutive early reports can you handle?",
      boundTo: "circadianTolerance",
      unitSingular: "report in a row",
      unitPlural: "reports in a row",
    });
    expect(question).not.toBeNull();
    expect(question).toMatchObject({ kind: "target-slider", boundTo: "circadianTolerance" });
  });
});

/**
 * A real eval-run failure: a pilot's 1,956-character bidding story came back
 * with zero facts. With a large nested tool schema the model sometimes sends
 * an array field as its JSON text instead of as an array, and reading only a
 * real array turned that into nothing at all.
 */
describe("parseProfileUpdates — fields sent as JSON text", () => {
  const update = {
    op: "add",
    fact: { statement: "Wants weekends off.", kind: "measurable", confidence: 0.9, importance: 0.7, measurable: { type: "implicit-weight", variableId: "weekendDaysOffPerLine", direction: 1 } },
  };

  it("reads a whole update list sent as a JSON string", () => {
    const updates = parseProfileUpdates(JSON.stringify([update]), 0, undefined);
    expect(updates).toHaveLength(1);
    expect(updates[0].op === "add" && updates[0].fact.measurable).toEqual({ type: "implicit-weight", variableId: "weekendDaysOffPerLine", direction: 1 });
  });

  it("reads a single fact or binding sent as a JSON string", () => {
    const updates = parseProfileUpdates([{ op: "add", fact: JSON.stringify({ ...update.fact, measurable: JSON.stringify(update.fact.measurable) }) }], 0, undefined);
    expect(updates).toHaveLength(1);
  });

  it("still ignores text that isn't JSON", () => {
    expect(parseProfileUpdates("no updates", 0, undefined)).toEqual([]);
  });
});

describe("parseSpecificDates", () => {
  it("keeps real YYYY-MM-DD dates, deduplicated", () => {
    expect(parseSpecificDates(["2026-10-14", "2026-10-14", "2026-10-15"])).toEqual(["2026-10-14", "2026-10-15"]);
  });
  it("drops impossible or malformed dates rather than checking them against a line", () => {
    expect(parseSpecificDates(["2026-02-30", "Oct 14", "2026-10-14"])).toEqual(["2026-10-14"]);
    expect(parseSpecificDates(["the 14th"])).toBeUndefined();
    expect(parseSpecificDates("2026-10-14")).toBeUndefined();
  });
});

describe("parseProfileUpdates — calendar dealbreakers", () => {
  const base = { statement: "Can't miss my daughter's wedding, period.", kind: "qualitative", confidence: 1, importance: 1, severity: "dealbreaker" };

  it("keeps the dealbreaker flag on a qualitative fact that names dates it needs off", () => {
    const [u] = parseProfileUpdates([{ op: "add", fact: { ...base, specificDates: ["2026-10-17"] } }], 0, undefined);
    expect(u.op === "add" && u.fact.severity).toBe("dealbreaker");
  });

  it("keeps it on a weekly commitment too", () => {
    const [u] = parseProfileUpdates([{ op: "add", fact: { ...base, recurringWeekday: "Sat" } }], 0, undefined);
    expect(u.op === "add" && u.fact.severity).toBe("dealbreaker");
  });

  it("drops it from a plain qualitative fact with nothing a line could violate", () => {
    const [u] = parseProfileUpdates([{ op: "add", fact: base }], 0, undefined);
    expect(u.op === "add" && u.fact.severity).toBeUndefined();
  });
});
