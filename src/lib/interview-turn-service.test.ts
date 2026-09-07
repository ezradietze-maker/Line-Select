import { describe, expect, it } from "vitest";
import { buildTurnTool } from "@/lib/interview-turn-service";

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
