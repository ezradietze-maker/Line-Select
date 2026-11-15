import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmailExplained } from "./email";

/** Resend is never called: `fetch` is a stand-in that answers, or never does. */
const message = { to: "pilot@example.com", subject: "Reset your Line Select password", text: "A link" };

beforeEach(() => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("EMAIL_FROM", "Line Select <mail@example.com>");
  vi.stubEnv("APP_URL", "https://example.com");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sending an email", () => {
  it("sends one POST to Resend with the message", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await sendEmailExplained(message)).toEqual({ sent: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(init.body as string)).toEqual({ from: "Line Select <mail@example.com>", to: [message.to], subject: message.subject, text: message.text });
  });

  it("gives up on a Resend that never answers, rather than holding up the morning run behind it", async () => {
    vi.useFakeTimers();
    // Answers only by being stopped, as a stalled connection does.
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))))
    );
    let result: { sent: boolean; reason?: string } | null = null;
    void sendEmailExplained(message).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(result).toMatchObject({ sent: false });
    expect(result!.reason).toMatch(/Resend/);
  });
});
