import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptSession, encryptSession, withAudit } from "@/lib/server/fedex-session";
import { emptyConnection, type AuditEntry } from "@/lib/fedex-connect/types";

beforeAll(() => {
  process.env.FEDEX_SESSION_KEY = randomBytes(32).toString("base64");
});

describe("session encryption", () => {
  it("round-trips through AES-256-GCM", () => {
    const secret = "opaque-fedex-session-material";
    const blob = encryptSession(secret);
    expect(blob).not.toContain(secret);
    expect(decryptSession(blob)).toBe(secret);
  });

  it("uses a fresh IV, so the same plaintext encrypts differently each time", () => {
    expect(encryptSession("same")).not.toBe(encryptSession("same"));
  });

  it("refuses a tampered blob (GCM auth tag)", () => {
    const blob = encryptSession("x");
    const [iv, tag, data] = blob.split(".");
    const flipped = data[0] === "A" ? "B" : "A";
    expect(() => decryptSession(`${iv}.${tag}.${flipped}${data.slice(1)}`)).toThrow();
  });
});

describe("withAudit", () => {
  it("appends newest last and caps the trail", () => {
    let conn = emptyConnection("u1");
    for (let i = 0; i < 60; i++) {
      const entry: AuditEntry = { at: i, action: "read-open-time", detail: `read ${i}` };
      conn = withAudit(conn, entry);
    }
    expect(conn.audit.length).toBe(50);
    expect(conn.audit[conn.audit.length - 1].detail).toBe("read 59");
    expect(conn.audit[0].detail).toBe("read 10");
  });
});
