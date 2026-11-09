"use client";

import { useCallback, useEffect, useState } from "react";
import { CONSENT_VERSION } from "@/lib/fedex-connect/consent";
import type { ConnectionView } from "@/lib/fedex-connect/types";

/**
 * Client state for a pilot's FedEx connection: fetch status, accept consent, disconnect. All work goes through the
 * isolated `/api/fedex/*` routes; nothing here touches FedEx. Only for signed-in pilots (the record is per account).
 */
export function useFedexConnection(signedIn: boolean) {
  const [connection, setConnection] = useState<ConnectionView | null>(null);
  const [loading, setLoading] = useState(signedIn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!signedIn) {
      setConnection(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/fedex/status", { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { connection: ConnectionView };
      setConnection(data.connection);
      setError(null);
    } catch {
      setError("Couldn't load your FedEx connection.");
    } finally {
      setLoading(false);
    }
  }, [signedIn]);

  useEffect(() => {
    // Deferred so the fetch's own setState doesn't run synchronously inside the effect (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const post = useCallback(async (path: string, body?: unknown): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? "Something went wrong.");
        return false;
      }
      const data = (await res.json()) as { connection: ConnectionView };
      setConnection(data.connection);
      setError(null);
      return true;
    } catch {
      setError("Something went wrong.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const acceptConsent = useCallback(() => post("/api/fedex/connect", { consentVersion: CONSENT_VERSION }), [post]);
  const disconnect = useCallback(() => post("/api/fedex/disconnect"), [post]);

  return { connection, loading, busy, error, refresh, acceptConsent, disconnect };
}
