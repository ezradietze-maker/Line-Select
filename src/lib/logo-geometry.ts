/**
 * The Line Select mark — an "LS" monogram on a 64-unit plate. The L is a
 * runway (its threshold bars appear at larger sizes); the S is a procedure
 * turn lining up to land on it. Shared by the live, theme-aware `LogoMark`
 * and the fixed-color raster app icons (`icon-svg.tsx`), so the two can't
 * drift apart.
 */
export const LOGO_VIEWBOX = "0 0 64 64";
export const LOGO_PLATE_RADIUS = 15;
export const LOGO_STROKE = 4.6;

/** The runway: up the left side, then along the bottom. */
export const LOGO_L_PATH = "M16 13 V44 H48";

/** The procedure turn: in from the top right, two 180° turns, rolling out over the runway. */
export const LOGO_S_PATH = "M45 12 H33.5 A6.25 6.25 0 0 0 33.5 24.5 H36 A6.25 6.25 0 0 1 36 37 H24.5";

/** Runway threshold bars under the L — only drawn where the mark is big enough for them to read. */
export const LOGO_THRESHOLD_BARS_X = [22, 26, 30];
export const LOGO_THRESHOLD_BARS_Y: [number, number] = [49.5, 52.5];

/** The plate's fixed colors for raster icons, which can't read CSS variables — the dark theme's, since a home-screen icon sits on any wallpaper. */
export const LOGO_RASTER_COLORS = {
  plate1: "#2b1f12",
  plate2: "#100b06",
  ink: "#f3e4c8",
  accent: "#e8a54b",
  rim: "rgba(232,165,75,0.25)",
};
