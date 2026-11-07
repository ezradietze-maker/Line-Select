import { afterEach, describe, expect, it, vi } from "vitest";
import { deviceCookieValue, deviceIdOf } from "@/lib/device-cookie";
import { crossSiteRefusal } from "@/lib/server/same-origin";

const id = "0b5c4f2e-8f1a-4c3d-9e2b-7a6d5c4b3a21";

afterEach(() => vi.unstubAllEnvs());

describe("signed device ids", () => {
  it("read back an id this server signed, and refuse one made up or tampered with", () => {
    vi.stubEnv("DEVICE_COOKIE_SECRET", "test-secret");
    const value = deviceCookieValue(id);
    expect(value).not.toBe(id);
    expect(deviceIdOf(value)).toBe(id);
    expect(deviceIdOf(id)).toBeNull();
    expect(deviceIdOf(`${id}.0000000000000000000000000000000`)).toBeNull();
    expect(deviceIdOf(value.replace(id, "1b5c4f2e-8f1a-4c3d-9e2b-7a6d5c4b3a21"))).toBeNull();
  });

  it("go unsigned on a deployment with no key, as before", () => {
    vi.stubEnv("DEVICE_COOKIE_SECRET", "");
    vi.stubEnv("ADMIN_API_KEY", "");
    expect(deviceCookieValue(id)).toBe(id);
    expect(deviceIdOf(id)).toBe(id);
  });
});

describe("requests from another site", () => {
  const post = (headers: Record<string, string>) => new Request("https://line-select.example/api/auth/login", { method: "POST", headers });

  it("are refused, by the browser's own word on where they came from", () => {
    expect(crossSiteRefusal(post({ "sec-fetch-site": "cross-site" }))?.status).toBe(403);
    expect(crossSiteRefusal(post({ origin: "https://evil.example" }))?.status).toBe(403);
  });

  it("let this site's own pages, and callers that aren't browser pages, through", () => {
    expect(crossSiteRefusal(post({ "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(crossSiteRefusal(post({ origin: "https://line-select.example" }))).toBeNull();
    expect(crossSiteRefusal(post({}))).toBeNull();
  });
});
