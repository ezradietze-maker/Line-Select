import { describe, expect, it } from "vitest";
import { structuredParams } from "./llm";

const opts = { system: "s", user: { fresh: "f" }, schema: { type: "object" } };

describe("refusal fallback", () => {
  it("lets Anthropic re-run a declined Sonnet 5.5 request on its chosen fallback", () => {
    expect(structuredParams({ ...opts, model: "claude-sonnet-5-5" })).toMatchObject({ betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  });

  it("keeps Fable's fixed fallback, and adds none to other models", () => {
    expect(structuredParams({ ...opts, model: "claude-fable-5-1" })).toMatchObject({ betas: ["server-side-fallback-2026-06-01"], fallbacks: [{ model: "claude-opus-4-8" }] });
    const other = structuredParams({ ...opts, model: "claude-haiku-5-5" });
    expect(other).not.toHaveProperty("fallbacks");
    expect(other).not.toHaveProperty("betas");
  });
});
