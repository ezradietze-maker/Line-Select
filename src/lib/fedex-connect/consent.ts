/**
 * The consent a pilot must accept before connecting a FedEx account, as plain data so the screen and any record share
 * one source of truth. Written in the pilot's interest and kept truthful (step-8 phase 2): FedEx has not approved this,
 * we have not seen FedEx's computer-use policy for pilots, and connecting is at the pilot's own risk.
 *
 * Bump `CONSENT_VERSION` whenever the wording below changes materially; a pilot who accepted an older version is asked
 * to accept again.
 */

// .2: the View/Add list joined what's read. The panel on View/Add says one connection reads it, and the terms a pilot
// accepted there named only open time.
export const CONSENT_VERSION = "2026-11-14.2";

/** What Line Select reads from the pilot's connection. Only what the feature needs. */
export const WHAT_WE_READ: string[] = [
  "Your open-time list, so each trip can be scored for you and checked against your line and the contract.",
  "During the View/Add window, the open trips on your View/Add make-up screen, to build your list the same way.",
  "Later, with a separate connection step: your own schedule and trip details, to watch for revisions. Not enabled today.",
];

/** What Line Select never does. Flat promises, each enforced in code. */
export const WHAT_WE_NEVER_DO: string[] = [
  "We never see or store your FedEx password. You sign in on FedEx's own page, in your own browser.",
  "We never bypass Okta or two-factor. Every sign-in is approved by you.",
  "We never pick up, trade, or drop a trip automatically. Any action is yours to confirm in VIPS, like Send to VIPS today.",
  "We never get around a FedEx limit or block. We stay well under your own daily open-time limit and stop when it's reached.",
  "We never share your connection across pilots, or use it for anyone but you.",
];

/**
 * What disconnecting does, said where a pilot disconnects and in the terms. It deletes the session and the consent, but
 * the log of the connection's uses stays on the record (`lib/server/fedex-session.ts` `disconnect`) until the record
 * expires, as the Privacy Policy (13a) says: "deletes anything we hold" was more than it does.
 */
export const DISCONNECT_DOES =
  "Disconnecting deletes your FedEx session and your consent, and stops any future reads. The log of when your connection was used stays, so you can still see it, for up to 180 days.";

/** The risk disclosures the pilot must see, because the phase-0 gates (lawyer, LLC, insurance, policy review) were not done. */
export const RISK_DISCLOSURES: string[] = [
  "FedEx has not approved Line Select, and we are not affiliated with FedEx.",
  "We have not seen FedEx's computer-use policy that applies to pilots. Using a third-party tool with your FedEx login may be against it.",
  "Connecting is at your own risk. Your own FedEx policy applies to you, and any consequence with FedEx would be yours.",
  "This is new. A FedEx change could break it, and if FedEx objects, the feature pauses while we talk to them.",
  `You can disconnect at any time. ${DISCONNECT_DOES}`,
];
