/**
 * The app's plain text box, number box and menu, shared so every screen's fields look alike. The edge is `field-edge`,
 * which holds 3:1 against the page in every theme: the hairline the copies used before was too faint to show where to
 * type. Width and anything else a screen needs are added where it's used; the focus ring comes from globals.css.
 */
export const FIELD = "rounded-md border border-field-edge bg-canvas/60 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none";
