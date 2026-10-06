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
 */
export const RAIL_BOOTSTRAP = `
  try {
    if (localStorage.getItem('${RAIL_KEY}') === 'collapsed') {
      document.documentElement.setAttribute('data-rail', 'collapsed');
    }
  } catch (e) {}
`;
