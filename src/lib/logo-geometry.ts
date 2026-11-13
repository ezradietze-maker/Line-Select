/**
 * The Line Select mark — an airfield location sign reading "LS": yellow letters and a yellow border on a black
 * panel, the sign that tells a pilot where they are. Drawn as strokes, never type, so it reads the same before any
 * font loads and at 16px in a browser tab. Shared by the live, theme-aware `LogoMark` and the fixed-color raster app
 * icons (`icon-svg.tsx`), so the two can't drift apart.
 */
export const LOGO_VIEWBOX = "0 0 64 64";
export const LOGO_PLATE_RADIUS = 10;

/** The sign's yellow border, inset from the panel's edge; thicker at tab-icon sizes so it doesn't vanish. */
export const LOGO_BORDER = { inset: 5.5, radius: 4, stroke: 3, smallStroke: 4.2 };

/** Letter stroke: heavy, square-ended, the weight of airfield sign lettering. */
export const LOGO_STROKE = 5.6;
export const LOGO_SMALL_STROKE = 6.6;

/** Below this many px the mark drops to its tab-icon weights. */
export const LOGO_SMALL_PX = 40;

/** The L: down the stem, then along the base. Shifted with the S so the pair sits centered on the panel. */
export const LOGO_L_PATH = "M17.2 18.2 V43 H29.2";

/** The S: two bowls of radius 5.5 stacked on one spine, ending in short terminals top right and bottom left. */
export const LOGO_S_PATH = "M45.6 23.2 A5.5 5.5 0 1 0 41.2 32 A5.5 5.5 0 1 1 36.8 40.8";

/** Fixed colors for raster icons, which can't read CSS variables: the sign's own black and yellow, in every theme. */
export const LOGO_RASTER_COLORS = {
  plate: "#000000",
  ink: "#ffcc00",
};
