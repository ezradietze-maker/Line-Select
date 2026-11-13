"use client";

import { useEffect, useState } from "react";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Notice } from "@/components/ui/Notice";
import { useAppState } from "@/lib/app-state";
import { checkSession, fetchEmailResetEnabled, resendConfirmEmail } from "@/lib/auth";
import type { UserAccount } from "@/types/auth";

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent"; email: string } | { kind: "confirmed" } | { kind: "failed"; error: string };

/**
 * "Confirm your email": sends a fresh link to the signed-in pilot's address, and says where it went. Beside every
 * action an unconfirmed account is refused, and in the app's own notice.
 */
export function ConfirmEmailButton({ label = "Confirm your email", className = "" }: { label?: string; className?: string }) {
  const [state, setState] = useState<SendState>({ kind: "idle" });
  const { refreshUser } = useAppState();

  async function send() {
    setState({ kind: "sending" });
    const result = await resendConfirmEmail();
    if (!result.ok) setState({ kind: "failed", error: result.error });
    else if ("confirmed" in result) {
      setState({ kind: "confirmed" });
      // Confirmed elsewhere already: the app asks who's signed in again, and the notices for it go.
      void refreshUser();
    } else setState({ kind: "sent", email: result.email });
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
        {state.kind === "confirmed" && "Your email is already confirmed."}
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
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchEmailResetEnabled().then((on) => !cancelled && setEmailEnabled(on));
    return () => {
      cancelled = true;
    };
  }, []);

  // Watch for the address being confirmed, here or on another device — the pilot opens the link on their phone and the
  // account (shared between devices) comes back verified. The moment it does, say so and reload so trading and sharing
  // unlock, instead of leaving this screen waiting until the pilot reloads by hand.
  useEffect(() => {
    if (dismissed || confirmed || emailEnabled !== true) return;
    let stop = false;
    const tick = async () => {
      if (stop || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
      const { user: fresh } = await checkSession();
      if (!stop && fresh?.id === user.id && fresh.emailVerified) setConfirmed(true);
    };
    const timer = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [dismissed, confirmed, emailEnabled, user.id]);

  useEffect(() => {
    if (!confirmed) return;
    const timer = setTimeout(() => window.location.reload(), 1600);
    return () => clearTimeout(timer);
  }, [confirmed]);

  if (confirmed) {
    return (
      <Notice tone="good" role="status" className="mx-auto mb-4 w-full max-w-3xl">
        <p>
          <span className="font-medium">Email confirmed.</span> You&rsquo;re all set — trading, sharing and your seat&rsquo;s
          numbers are unlocked. Refreshing…
        </p>
      </Notice>
    );
  }

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
            count toward your seat&rsquo;s numbers. Until then your pack, interview and rankings work for you alone, and your
            account stays as it is: nothing is removed while you wait.
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
