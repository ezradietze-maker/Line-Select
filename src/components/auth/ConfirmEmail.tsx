"use client";

import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Notice } from "@/components/ui/Notice";
import { fetchEmailResetEnabled, resendConfirmEmail } from "@/lib/auth";
import type { UserAccount } from "@/types/auth";

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "confirmed" } | { kind: "failed"; error: string };

/**
 * "Confirm your email": sends a fresh link to the signed-in pilot's address, and says where it went. Beside every
 * action an unconfirmed account is refused, and in the app's own notice.
 */
export function ConfirmEmailButton({ label = "Confirm your email", className = "" }: { label?: string; className?: string }) {
  const [state, setState] = useState<SendState>({ kind: "idle" });

  async function send() {
    setState({ kind: "sending" });
    const result = await resendConfirmEmail();
    if (!result.ok) setState({ kind: "failed", error: result.error });
    else if ("confirmed" in result) setState({ kind: "confirmed" });
    else setState({ kind: "sent", email: result.email });
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {state.kind !== "sent" && state.kind !== "confirmed" && (
        <button
          type="button"
          onClick={send}
          disabled={state.kind === "sending"}
          className="font-medium underline decoration-dotted underline-offset-4 hover:opacity-80 disabled:opacity-60"
        >
          {state.kind === "sending" ? "Sending…" : label}
        </button>
      )}
      <span role="status" aria-live="polite">
        {state.kind === "sent" && (
          <>
            Sent to <span className="font-medium">{state.email}</span>. Open the link in it; check your spam folder if it isn&rsquo;t there.
          </>
        )}
        {state.kind === "confirmed" && "Your email is already confirmed. Reload the page to carry on."}
        {state.kind === "failed" && state.error}
      </span>
    </span>
  );
}

/** A refused action's own words, with the button to confirm under them. */
export function ConfirmEmailRefusal({ message, className = "" }: { message: string; className?: string }) {
  return (
    <ErrorBanner className={className}>
      <p>{message}</p>
      <ConfirmEmailButton className="mt-2" />
    </ErrorBanner>
  );
}

/** Whether a failed request's answer was the one an unconfirmed account gets (`confirmEmailRefusal` on the server). */
export async function isConfirmEmailRefusal(res: Response): Promise<{ error: string } | null> {
  if (res.status !== 403) return null;
  const data = (await res.clone().json().catch(() => null)) as { confirmEmail?: unknown; error?: unknown } | null;
  return data?.confirmEmail === true && typeof data.error === "string" ? { error: data.error } : null;
}

const DISMISSED_KEY = "line-select:confirm-email-notice-dismissed";

/**
 * The app's notice for a signed-in pilot whose address isn't confirmed: their address, "Send it again", and a way to
 * put it away for this visit. When the server can't send email it says so instead, since nobody can confirm until it
 * can.
 */
export function ConfirmEmailNotice({ user }: { user: UserAccount }) {
  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof window !== "undefined" && window.sessionStorage.getItem(DISMISSED_KEY) === user.id;
    } catch {
      return false;
    }
  });
  const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchEmailResetEnabled().then((on) => !cancelled && setEmailEnabled(on));
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || emailEnabled === null) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, user.id);
    } catch {
      // Private mode: it comes back on the next page load, which is fine.
    }
  }

  const dismissButton = (
    <button type="button" onClick={dismiss} className="font-medium underline decoration-dotted underline-offset-4 hover:opacity-80">
      Dismiss
    </button>
  );

  return (
    <Notice tone={emailEnabled ? "warn" : "info"} role="status" className="mx-auto mb-4 w-full max-w-3xl" action={dismissButton}>
      {emailEnabled ? (
        <>
          <p>
            Confirm your email, <span className="font-medium break-all">{user.email}</span>, to trade, share what you held and
            count toward your seat&rsquo;s numbers. Everything else works now.
          </p>
          <ConfirmEmailButton label="Send the link again" className="mt-1.5" />
        </>
      ) : (
        <p>
          Line Select can&rsquo;t send email yet, so your address can&rsquo;t be confirmed for now. Until it can, trading and
          sharing what you held stay closed. Everything else works.
        </p>
      )}
    </Notice>
  );
}
