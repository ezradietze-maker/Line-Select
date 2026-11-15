import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionView } from "@/lib/fedex-connect/types";

const kv = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/lib/server/kv", () => ({
  getJson: vi.fn(async (key: string) => kv.get(key) ?? null),
  setJson: vi.fn(async (key: string, value: unknown) => void kv.set(key, value)),
}));
const hook = vi.hoisted(() => ({ connection: null as ConnectionView | null }));
vi.mock("@/lib/fedex-connect/use-fedex-connection", () => ({
  useFedexConnection: () => ({ connection: hook.connection, loading: false, busy: false, error: null, acceptConsent: async () => true, disconnect: async () => true }),
}));

const { ConnectFedexPanel } = await import("@/components/fedex-connect/ConnectFedexPanel");
const { DISCONNECT_DOES, RISK_DISCLOSURES, CONSENT_VERSION } = await import("@/lib/fedex-connect/consent");
const { disconnect, saveConnection, withAudit } = await import("@/lib/server/fedex-session");
const { emptyConnection, toView } = await import("@/lib/fedex-connect/types");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&rsquo;/g, "'").replace(/\s+/g, " ");

describe("Disconnect FedEx", () => {
  it("says what it deletes and what it keeps, as it does it", async () => {
    const accepted = withAudit({ ...emptyConnection("u1"), status: "coming-soon", consentVersion: CONSENT_VERSION, consentAt: 1 }, { at: 1, action: "consent", detail: "accepted" });
    await saveConnection(accepted);
    const after = await disconnect("u1");
    // Session and consent gone; the log stays on the record.
    expect(after.encryptedSession).toBeNull();
    expect(after.consentAt).toBeNull();
    expect(after.audit.map((a) => a.action)).toEqual(["consent", "disconnect"]);
    // So nothing a pilot reads says everything is deleted.
    for (const words of [DISCONNECT_DOES, ...RISK_DISCLOSURES, ...after.audit.map((a) => a.detail)]) expect(words).not.toMatch(/anything (?:we hold|held)/i);
    expect(DISCONNECT_DOES).toMatch(/log .* stays/);

    // And the log it keeps is still shown once disconnected.
    hook.connection = toView(after, false);
    const shown = text(renderToStaticMarkup(createElement(ConnectFedexPanel, { signedIn: true })));
    expect(shown).toContain("When your connection was used (2)");
    expect(shown).toContain("Connect FedEx for live updates");
  });

  it("isn't printed: it's a switch, with nothing to keep on paper", () => {
    hook.connection = null;
    const html = renderToStaticMarkup(createElement(ConnectFedexPanel, { signedIn: false }));
    expect(html.match(/<section[^>]*>/)?.[0]).toContain("print:hidden");
  });
});
