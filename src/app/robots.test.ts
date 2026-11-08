import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots.txt", () => {
  const rules = robots().rules as { allow: string[]; disallow: string[] };

  it("lets Google Calendar fetch a feed: it obeys robots.txt, and the longer rule wins over /api/", () => {
    expect(rules.allow).toContain("/api/calendar/");
    expect(rules.disallow).toContain("/api/");
  });

  it("keeps the private screens out", () => {
    expect(rules.disallow).toEqual(expect.arrayContaining(["/results", "/logbook", "/inbox"]));
    expect(rules.disallow).not.toContain("/api/calendar/");
  });
});
