import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ getCurrentServerUser: vi.fn() }));
vi.mock("@/lib/server/auth", () => authMocks);

const dbMocks = vi.hoisted(() => ({
  createFeedbackSubmission: vi.fn(),
  listFeedbackSubmissions: vi.fn(),
}));
vi.mock("@/lib/server/db", () => dbMocks);

const rateLimitMocks = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  clientIp: vi.fn(() => "127.0.0.1"),
  rateLimitedResponse: vi.fn(),
}));
vi.mock("@/lib/server/rate-limit", () => rateLimitMocks);

import { NextResponse } from "next/server";
import { GET, POST } from "./route";

const SIGNED_IN_USER = { id: "user-1", email: "pilot@example.com", displayName: "Pilot", createdAt: "", plan: "free" as const };

function postRequest(body: unknown): Request {
  return new Request("http://test", { method: "POST", body: JSON.stringify(body) });
}

describe("/api/feedback", () => {
  beforeEach(() => {
    authMocks.getCurrentServerUser.mockReset().mockResolvedValue(null);
    dbMocks.createFeedbackSubmission.mockReset().mockResolvedValue(undefined);
    dbMocks.listFeedbackSubmissions.mockReset().mockResolvedValue([]);
    rateLimitMocks.checkRateLimit.mockReset().mockResolvedValue({ ok: true });
    rateLimitMocks.rateLimitedResponse.mockReset().mockReturnValue(NextResponse.json({ error: "rate limited" }, { status: 429 }));
  });

  describe("GET", () => {
    it("404s without the admin key, same as /api/candidate-variables", async () => {
      const res = await GET(new Request("http://test"));
      expect(res.status).toBe(404);
      expect(dbMocks.listFeedbackSubmissions).not.toHaveBeenCalled();
    });

    it("returns submissions with the correct admin key", async () => {
      process.env.ADMIN_API_KEY = "secret";
      dbMocks.listFeedbackSubmissions.mockResolvedValue([{ id: "1" }]);
      const res = await GET(new Request("http://test", { headers: { "x-admin-key": "secret" } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ submissions: [{ id: "1" }] });
      delete process.env.ADMIN_API_KEY;
    });
  });

  describe("POST", () => {
    it("rejects an empty message", async () => {
      const res = await POST(postRequest({ message: "   ", category: "bug", page: "/results" }));
      expect(res.status).toBe(400);
      expect(dbMocks.createFeedbackSubmission).not.toHaveBeenCalled();
    });

    it("is rate limited, since it's open to guests with no account to throttle by", async () => {
      rateLimitMocks.checkRateLimit.mockResolvedValue({ ok: false });
      const res = await POST(postRequest({ message: "hello", category: "bug", page: "/results" }));
      expect(res.status).toBe(429);
      expect(dbMocks.createFeedbackSubmission).not.toHaveBeenCalled();
    });

    it("accepts a guest submission with no pilot identity attached", async () => {
      const res = await POST(postRequest({ message: "The interview took forever", category: "bug", page: "/interview" }));
      expect(res.status).toBe(200);
      expect(dbMocks.createFeedbackSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ pilotId: null, pilotEmail: null, message: "The interview took forever", category: "bug" })
      );
    });

    it("attaches the signed-in pilot's real identity, not anything the client sent", async () => {
      authMocks.getCurrentServerUser.mockResolvedValue(SIGNED_IN_USER);
      const res = await POST(
        postRequest({ message: "Neat idea", category: "idea", page: "/results", pilotId: "spoofed", pilotEmail: "spoofed@example.com" })
      );
      expect(res.status).toBe(200);
      expect(dbMocks.createFeedbackSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ pilotId: "user-1", pilotEmail: "pilot@example.com" })
      );
    });

    it("falls back to 'other' for an unrecognized category instead of rejecting the submission", async () => {
      const res = await POST(postRequest({ message: "hmm", category: "not-a-real-category", page: "/results" }));
      expect(res.status).toBe(200);
      expect(dbMocks.createFeedbackSubmission).toHaveBeenCalledWith(expect.objectContaining({ category: "other" }));
    });

    it("rejects a message over the length cap", async () => {
      const res = await POST(postRequest({ message: "x".repeat(4001), category: "bug", page: "/results" }));
      expect(res.status).toBe(400);
      expect(dbMocks.createFeedbackSubmission).not.toHaveBeenCalled();
    });
  });
});
