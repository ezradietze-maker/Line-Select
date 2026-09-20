import { describe, expect, it } from "vitest";
import { buildTurnTool, parseMeasurableBinding, parseQuestion } from "@/lib/interview-turn-service";

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
