/** The site's own address: what links, the sitemap and each page's canonical URL are built on. */
export const SITE_URL = "https://www.lineselect.app";

/**
 * Pages that read the same to everyone: nothing on them waits for the pilot's saved pack, profile or account, so they
 * render in the server's HTML (readable without JavaScript, and by search engines) instead of behind "Loading…".
 * The landing page is apart: it handles a returning pilot itself (LandingPage.tsx).
 */
export const PUBLIC_PAGES = ["/pricing", "/how-it-works", "/whats-new", "/privacy", "/terms"] as const;

/**
 * Screens built from what this device or the pilot's account holds, which show a placeholder until it has loaded:
 * drawn before then, they'd show a guest's empty screen, or send a pilot who has a pack off to the upload page.
 */
export const SAVED_STATE_SCREENS = [
  "/auth",
  "/cities",
  "/confirm-email",
  "/confirm-preferences",
  "/contract",
  "/hotel-ratings",
  "/inbox",
  "/interview",
  "/logbook",
  "/open-time",
  "/preferences",
  "/preview",
  "/reset-password",
  "/results",
  "/strategies",
  "/tools",
  "/trade-board",
  "/upload",
  "/view-add",
] as const;

/**
 * Whether this path waits for saved state before it's drawn. Only the screens listed do: the public pages don't, and
 * nor does a wrong link, so the "not on the chart" page shows without JavaScript too.
 */
export function waitsForSavedState(pathname: string): boolean {
  const screen = `/${pathname.split("/")[1] ?? ""}`;
  return (SAVED_STATE_SCREENS as readonly string[]).includes(screen);
}
