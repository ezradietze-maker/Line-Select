// Kept apart from `rail.ts` (a client hook) so the server-rendered layout can
// inline the bootstrap script without importing client code.

/** Whether the desktop sidebar is folded down to its icon rail — a per-device preference. */
export const RAIL_KEY = "line-select:rail:v1";

/**
 * Read before first paint by the bootstrap script in `theme.ts`, so a pilot
 * who keeps the rail folded never sees it open and then snap shut. The
 * `<html data-rail>` attribute is the source of truth for every collapsed
 * style (`rail-collapsed:` in globals.css); React only reads it back for
 * labels and `aria-pressed`.
 *
 * Also folds it, not kept as the pilot's choice, on a window under 48 of the page's own rems. Safari's larger text
 * grows the rem but not the 48rem breakpoint (media queries keep the initial size), so the sidebar shows there, held
 * to 31.25vw (globals.css), too narrow for its labels; Chrome hides it outright. Never at normal text, or in Chrome,
 * where the two are the same 48rem.
 */
export const RAIL_BOOTSTRAP = `
  try {
    if (localStorage.getItem('${RAIL_KEY}') === 'collapsed') {
      document.documentElement.setAttribute('data-rail', 'collapsed');
    }
  } catch (e) {}
  try {
    if (matchMedia('(min-width: 48rem)').matches && innerWidth < 48 * parseFloat(getComputedStyle(document.documentElement).fontSize)) {
      document.documentElement.setAttribute('data-rail', 'collapsed');
    }
  } catch (e) {}
`;
