import { describe, expect, it } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

describe("sitemap.xml", () => {
  const urls = sitemap().map((e) => e.url);

  it("lists the public pages on the site's real address", () => {
    expect(urls).toEqual(expect.arrayContaining(["https://www.lineselect.app", "https://www.lineselect.app/pricing", "https://www.lineselect.app/privacy", "https://www.lineselect.app/terms"]));
    for (const url of urls) expect(url.startsWith("https://www.lineselect.app")).toBe(true);
  });

  it("leaves out every screen robots.txt keeps search engines away from", () => {
    const blocked = (robots().rules as { disallow: string[] }).disallow;
    for (const url of urls) {
      const path = new URL(url).pathname;
      expect(blocked.some((b) => path.startsWith(b))).toBe(false);
    }
  });

  it("is named in robots.txt", () => {
    expect(robots().sitemap).toBe("https://www.lineselect.app/sitemap.xml");
  });
});
