/**
 * The consent a pilot must accept before connecting a FedEx account, as plain data so the screen and any record share
 * one source of truth. Written in the pilot's interest and kept truthful (step-8 phase 2): FedEx has not approved this,
 * we have not seen FedEx's computer-use policy for pilots, and connecting is at the pilot's own risk.
 *
 * Bump `CONSENT_VERSION` whenever the wording below changes materially; a pilot who accepted an older version is asked
 * to accept again.
 */

export const CONSENT_VERSION = "2026-11-08.1";

/** What Line Select reads from the pilot's connection. Only what the feature needs. */
export const WHAT_WE_READ: string[] = [
  "Your open-time list, so each trip can be scored for you and checked against your line and the contract.",
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

/** The risk disclosures the pilot must see, because the phase-0 gates (lawyer, LLC, insurance, policy review) were not done. */
export const RISK_DISCLOSURES: string[] = [
  "FedEx has not approved Line Select, and we are not affiliated with FedEx.",
  "We have not seen FedEx's computer-use policy that applies to pilots. Using a third-party tool with your FedEx login may be against it.",
  "Connecting is at your own risk. Your own FedEx policy applies to you, and any consequence with FedEx would be yours.",
  "This is new. A FedEx change could break it, and if FedEx objects, the feature pauses while we talk to them.",
  "You can disconnect at any time, which deletes anything we hold for the connection.",
];
