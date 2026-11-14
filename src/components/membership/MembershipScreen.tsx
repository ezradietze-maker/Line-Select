"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { useAppState } from "@/lib/app-state";
import { fetchBillingStatus, membershipEnded, openBillingPortal, startMembershipCheckout, type BillingStatus } from "@/lib/billing";

const PANEL = "panel-glass p-6";

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

const noSubscribe = () => () => {};
function readCheckoutParam(): "success" | "cancelled" | null {
  const value = new URLSearchParams(window.location.search).get("checkout");
  return value === "success" || value === "cancelled" ? value : null;
}
/** Reads ?checkout=success|cancelled off the URL without a hydration mismatch or a setState-in-effect. */
function useCheckoutOutcome(): "success" | "cancelled" | null {
  return useSyncExternalStore(noSubscribe, readCheckoutParam, () => null);
}

export function MembershipScreen() {
  const { user } = useAppState();
  const outcome = useCheckoutOutcome();
  // Keyed on the pilot so the status reloads cleanly on sign-in/out, and state is only ever set from an async callback.
  const [data, setData] = useState<{ forUser: string | null; status: BillingStatus | null }>({ forUser: null, status: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    fetchBillingStatus().then((status) => {
      if (active) setData({ forUser: user.id, status });
    });
    return () => {
      active = false;
    };
  }, [user]);

  const userId = user?.id ?? null;
  const loaded = data.forUser === userId;
  const status = loaded ? data.status : null;
  const loading = Boolean(user) && !loaded;

  async function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    const result = await action();
    // On success the browser is already navigating to Stripe; leave the button busy.
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">Membership</h1>
        <p className="text-sm text-ink-muted">Line Select Pro is $20/month, and your first membership starts with a free month.</p>
      </header>

      {outcome === "success" && (
        <div className="relative overflow-hidden rounded-[4px] border border-good/40 bg-good-soft py-3 pl-5 pr-4 text-sm text-ink">
          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-good" />
          You&rsquo;re all set — welcome to Line Select Pro.{status?.status === "trialing" && " Your free month has started."}
        </div>
      )}
      {outcome === "cancelled" && (
        <div className="rounded-[4px] border border-border bg-panel px-4 py-3 text-sm text-ink-muted">
          No charge — you closed checkout before finishing. You can start whenever you like.
        </div>
      )}

      {!user ? (
        <div className={PANEL}>
          <p className="text-sm text-ink-muted">Sign in from the account menu to start or manage a membership.</p>
        </div>
      ) : loading ? (
        <div className={PANEL}>
          <p className="text-sm text-ink-faint">Loading your membership…</p>
        </div>
      ) : (
        <MembershipBody status={status} busy={busy} error={error} onCheckout={() => run(startMembershipCheckout)} onPortal={() => run(openBillingPortal)} />
      )}

      <p className="text-center text-xs text-ink-faint">
        Every pilot has full access right now — paying is optional while Line Select is in testing. Your card is only ever
        entered on Stripe&rsquo;s secure page; we never see it.
      </p>
    </div>
  );
}

export function MembershipBody({
  status,
  busy,
  error,
  onCheckout,
  onPortal,
}: {
  status: BillingStatus | null;
  busy: boolean;
  error: string | null;
  onCheckout: () => void;
  onPortal: () => void;
}) {
  // The status didn't load (offline, or the server failed): not the same as billing being off, so don't say it is.
  if (!status) {
    return (
      <div className={PANEL}>
        <p className="text-sm text-ink-muted">Couldn&rsquo;t load your membership just now. Reload the page to try again.</p>
      </div>
    );
  }

  // Billing not configured on this deployment yet.
  if (!status.enabled) {
    return (
      <div className={PANEL}>
        <p className="text-sm text-ink-muted">Paid membership isn&rsquo;t switched on for this site yet. You already have full access as a free member.</p>
      </div>
    );
  }

  const trialEnds = formatDate(status.trialEndsAt);
  const renews = formatDate(status.currentPeriodEnd);
  const active = status.status === "trialing" || status.status === "active";

  if (active) {
    return (
      <div className={`${PANEL} space-y-4`}>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-[2px] bg-on-sign px-2 py-0.5 font-display text-xs font-bold text-sign">Pro</span>
          <span className="text-sm font-medium text-ink">{status.status === "trialing" ? "Free month in progress" : "Membership active"}</span>
        </div>
        <p className="text-sm text-ink-muted">
          {status.status === "trialing"
            ? trialEnds
              ? `Your free month runs through ${trialEnds}, then it’s $20/month. Cancel anytime before then and you won’t be charged.`
              : "You’re on your free month. Cancel anytime before it ends and you won’t be charged."
            : renews
              ? `Renews ${renews} at $20/month.`
              : "Billed $20/month."}
        </p>
        <Button variant="secondary" onClick={onPortal} disabled={busy}>
          {busy ? "Opening…" : "Manage membership"}
        </Button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  // Still open but unpaid (past due, unpaid, incomplete, paused): fix the card; a second membership would bill twice.
  if (status.hasSubscription && status.status && !membershipEnded(status.status)) {
    return (
      <div className={`${PANEL} space-y-4`}>
        <div className="font-display text-lg font-extrabold text-ink">Your last payment didn&rsquo;t go through</div>
        <p className="text-sm text-ink-muted">Update your card in the billing portal to keep your membership. Stripe tries the payment again once it&rsquo;s updated.</p>
        <Button onClick={onPortal} disabled={busy}>
          {busy ? "Opening…" : "Update your card"}
        </Button>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  // No membership, or one that ended: start one. Only a pilot's first comes with the free month.
  const lapsed = status.hasSubscription;
  return (
    <div className={`${PANEL} space-y-4`}>
      <div className="space-y-1">
        <div className="font-display text-lg font-extrabold text-ink">Line Select Pro</div>
        <div className="text-sm text-ink-muted">{status.freeMonth ? "$20/month · first month free" : "$20/month"}</div>
      </div>
      <ul className="space-y-1.5 text-sm text-ink-muted">
        <li>Every line scored and ranked for how you actually bid</li>
        <li>Sorts, filters, the calendar feed, and Send to VIPS</li>
        <li>Cancel anytime from Stripe&rsquo;s portal</li>
      </ul>
      <Button onClick={onCheckout} disabled={busy}>
        {busy ? "Starting…" : status.freeMonth ? "Start free month" : "Start membership"}
      </Button>
      {lapsed && (
        <button type="button" onClick={onPortal} disabled={busy} className="block text-sm text-ink-faint underline decoration-dotted underline-offset-4 hover:text-ink">
          See past invoices in the billing portal
        </button>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
