"use client";

import { DateTime } from "luxon";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Modal } from "@/components/ui/Modal";
import { Notice } from "@/components/ui/Notice";
import { CONSENT_VERSION, RISK_DISCLOSURES, WHAT_WE_NEVER_DO, WHAT_WE_READ } from "@/lib/fedex-connect/consent";
import { FEDEX_SIGN_IN_URL } from "@/lib/fedex-connect/fedex-client";
import { useFedexConnection } from "@/lib/fedex-connect/use-fedex-connection";
import type { AuditEntry } from "@/lib/fedex-connect/types";

/**
 * "Connect FedEx for live updates" on the /open-time page (step-8 phases 2–4). The pilot signs in on FedEx's own page;
 * we never render a password field and never see the password. The live feed itself is NOT wired yet (needs a discovery
 * session with a current pilot), so the panel shows "coming soon / needs setup" and reads nothing from FedEx. A truthful
 * consent screen and a big Disconnect control, as the plan requires.
 */
export function ConnectFedexPanel({ signedIn }: { signedIn: boolean }) {
  const { connection, loading, busy, error, acceptConsent, disconnect } = useFedexConnection(signedIn);
  const [showConsent, setShowConsent] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const status = connection?.status ?? "none";
  const connected = status === "coming-soon" || status === "connected" || status === "expired";
  const liveWired = connection?.liveWired ?? false;

  const onAccept = async () => {
    const ok = await acceptConsent();
    if (ok) {
      setShowConsent(false);
      setAccepted(false);
    }
  };

  return (
    <section aria-label="Connect FedEx for live updates" className="panel-glass mt-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-ink">Connect FedEx for live updates</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Read your open time straight from FedEx and score it for you, instead of pasting the list. You sign in on
            FedEx&rsquo;s own page &mdash; we never see your password.
          </p>
        </div>
        {!connected && signedIn && (
          <Button variant="secondary" className="px-3 py-1.5 text-xs" disabled={busy || loading} onClick={() => setShowConsent(true)}>
            Connect FedEx for live updates
          </Button>
        )}
      </div>

      {/* The one hard blocker, stated in the UI: the live feed isn't wired until discovery with a current pilot. */}
      <Notice tone="warn" className="mt-3">
        <span className="block font-medium text-ink">Coming soon &mdash; still being set up.</span>
        <span className="mt-1 block text-xs">
          The live FedEx feed isn&rsquo;t switched on yet. It needs a setup step with a current pilot before it can read
          anything. You can accept the terms now, but no open time is read from FedEx until this is finished. For now,
          paste your list above.
        </span>
      </Notice>

      {!signedIn && (
        <p className="mt-3 text-xs text-ink-muted">Sign in to connect your FedEx account. Your connection belongs to your account.</p>
      )}

      {error && (
        <Notice tone="warn" className="mt-3">
          <span className="text-xs">{error}</span>
        </Notice>
      )}

      {connected && connection && (
        <div className="mt-3 rounded-md border border-hairline bg-canvas/40 p-3">
          <p className="text-xs text-ink">
            {status === "expired" ? "Your FedEx session has expired." : "FedEx connection set up."}{" "}
            <span className="text-ink-muted">
              Terms accepted {connection.consentAt ? DateTime.fromMillis(connection.consentAt).toFormat("LLL d, HH:mm") : "—"}.
            </span>
          </p>

          {liveWired ? (
            <a href={FEDEX_SIGN_IN_URL} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-xs text-accent underline-offset-2 hover:underline">
              Sign in on FedEx&rsquo;s own page to start live updates
            </a>
          ) : (
            <p className="mt-2 text-xs text-ink-faint">
              Sign-in to FedEx opens here once the live feed is set up. Nothing is read from FedEx until then.
            </p>
          )}

          <div className="mt-3">
            <Button variant="danger" className="px-3 py-1.5 text-xs" disabled={busy} onClick={() => setConfirmDisconnect(true)}>
              Disconnect FedEx
            </Button>
          </div>

          <AuditList audit={connection.audit} />
        </div>
      )}

      {showConsent && (
        <ConsentModal
          accepted={accepted}
          busy={busy}
          onToggle={setAccepted}
          onAccept={onAccept}
          onClose={() => {
            setShowConsent(false);
            setAccepted(false);
          }}
        />
      )}

      {confirmDisconnect && (
        <ConfirmModal
          title="Disconnect FedEx?"
          confirmLabel="Disconnect FedEx"
          destructive
          onConfirm={async () => {
            await disconnect();
            setConfirmDisconnect(false);
          }}
          onCancel={() => setConfirmDisconnect(false)}
        >
          <p>This deletes anything we hold for your FedEx connection and stops any future reads. Your open-time scoring from a pasted list is unaffected. You can reconnect any time.</p>
        </ConfirmModal>
      )}
    </section>
  );
}

function ConsentModal({ accepted, busy, onToggle, onAccept, onClose }: { accepted: boolean; busy: boolean; onToggle: (v: boolean) => void; onAccept: () => void; onClose: () => void }) {
  return (
    <Modal title="Connect your FedEx account" onClose={onClose}>
      <div className="space-y-4 text-sm leading-relaxed text-ink-muted">
        <Notice tone="warn">
          <span className="block text-xs">
            Read this before connecting. FedEx has not approved Line Select, and we have not seen FedEx&rsquo;s computer-use
            policy for pilots. Connecting is at your own risk.
          </span>
        </Notice>

        <List title="What we read" items={WHAT_WE_READ} />
        <List title="What we never do" items={WHAT_WE_NEVER_DO} tone="good" />
        <List title="The risk you&rsquo;re accepting" items={RISK_DISCLOSURES} tone="warn" />

        <label className="flex items-start gap-2 text-xs text-ink">
          <input type="checkbox" checked={accepted} onChange={(e) => onToggle(e.target.checked)} className="mt-0.5 h-4 w-4 accent-brand" />
          <span>I&rsquo;ve read the above. I understand FedEx hasn&rsquo;t approved this, that I haven&rsquo;t seen FedEx&rsquo;s policy, and that connecting is at my own risk.</span>
        </label>
      </div>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
        <Button variant="primary" disabled={!accepted || busy} onClick={onAccept}>
          {busy ? "Saving…" : "Accept and connect"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className="mt-3 text-[11px] text-ink-faint">Consent version {CONSENT_VERSION}. You can withdraw it any time by disconnecting.</p>
    </Modal>
  );
}

function List({ title, items, tone }: { title: string; items: string[]; tone?: "good" | "warn" }) {
  const dot = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-ink-muted";
  return (
    <div>
      <p className="text-xs font-medium text-ink">{title}</p>
      <ul className="mt-1 space-y-1 text-xs">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className={`mt-1 h-1 w-1 shrink-0 rounded-full bg-current ${dot}`} aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuditList({ audit }: { audit: AuditEntry[] }) {
  if (audit.length === 0) return null;
  const recent = [...audit].reverse().slice(0, 8);
  return (
    <details className="mt-3 text-xs text-ink-muted">
      <summary className="cursor-pointer">When your connection was used ({audit.length})</summary>
      <ul className="mt-1 space-y-0.5">
        {recent.map((e, i) => (
          <li key={`${e.at}-${i}`}>
            <span className="text-ink-faint">{DateTime.fromMillis(e.at).toFormat("LLL d, HH:mm")}</span> &mdash; {e.detail}
          </li>
        ))}
      </ul>
    </details>
  );
}
