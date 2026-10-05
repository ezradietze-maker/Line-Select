import {
  LOGO_L_PATH,
  LOGO_PLATE_RADIUS,
  LOGO_RASTER_COLORS as C,
  LOGO_S_PATH,
  LOGO_STROKE,
  LOGO_THRESHOLD_BARS_X,
  LOGO_THRESHOLD_BARS_Y,
  LOGO_VIEWBOX,
} from "@/lib/logo-geometry";

/**
 * The app icon rendered server-side for PWA/manifest assets — the same mark
 * as `LogoMark` (components/ui/Logo.tsx), with fixed hex colors instead of
 * CSS variables, since these render once to a static raster image rather
 * than live in a themeable page. Threshold bars only at sizes where they read.
 * `fullBleed` drops the rounded corners and rim for iOS, which rounds a
 * home-screen icon itself — a pre-rounded plate would leave dark corners.
 */
export function iconMarkup(size: number, { fullBleed = false }: { fullBleed?: boolean } = {}) {
  const radius = fullBleed ? 0 : LOGO_PLATE_RADIUS;
  return (
    <svg width={size} height={size} viewBox={LOGO_VIEWBOX}>
      <defs>
        <radialGradient id="plate" cx="30%" cy="22%" r="95%">
          <stop offset="0" stopColor={C.plate1} />
          <stop offset="1" stopColor={C.plate2} />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx={radius} fill="url(#plate)" />
      {!fullBleed && <rect x="0.5" y="0.5" width="63" height="63" rx={radius - 0.5} fill="none" stroke={C.rim} />}
      <path
        d={LOGO_L_PATH}
        fill="none"
        stroke={C.ink}
        strokeWidth={LOGO_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={0.92}
      />
      {size >= 48 && (
        <g stroke={C.ink} strokeOpacity={0.45} strokeWidth={1.6} strokeLinecap="round">
          {LOGO_THRESHOLD_BARS_X.map((x) => (
            <line key={x} x1={x} y1={LOGO_THRESHOLD_BARS_Y[0]} x2={x} y2={LOGO_THRESHOLD_BARS_Y[1]} />
          ))}
        </g>
      )}
      <path d={LOGO_S_PATH} fill="none" stroke={C.accent} strokeWidth={LOGO_STROKE} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
