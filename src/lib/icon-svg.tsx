import {
  LOGO_BORDER as B,
  LOGO_L_PATH,
  LOGO_PLATE_RADIUS,
  LOGO_RASTER_COLORS as C,
  LOGO_S_PATH,
  LOGO_SMALL_PX,
  LOGO_SMALL_STROKE,
  LOGO_STROKE,
  LOGO_VIEWBOX,
} from "@/lib/logo-geometry";

/**
 * The app icon rendered server-side for PWA/manifest assets — the same mark as `LogoMark` (components/ui/Logo.tsx),
 * with fixed hex colors instead of CSS variables, since these render once to a static raster image rather than live
 * in a themeable page. `fullBleed` drops the rounded corners for iOS, which rounds a home-screen icon itself — a
 * pre-rounded panel would leave odd corners.
 */
export function iconMarkup(size: number, { fullBleed = false }: { fullBleed?: boolean } = {}) {
  const small = size < LOGO_SMALL_PX;
  const stroke = small ? LOGO_SMALL_STROKE : LOGO_STROKE;
  return (
    <svg width={size} height={size} viewBox={LOGO_VIEWBOX}>
      <rect width="64" height="64" rx={fullBleed ? 0 : LOGO_PLATE_RADIUS} fill={C.plate} />
      <rect
        x={B.inset}
        y={B.inset}
        width={64 - 2 * B.inset}
        height={64 - 2 * B.inset}
        rx={B.radius}
        fill="none"
        stroke={C.ink}
        strokeWidth={small ? B.smallStroke : B.stroke}
      />
      <path d={LOGO_L_PATH} fill="none" stroke={C.ink} strokeWidth={stroke} strokeLinejoin="miter" />
      <path d={LOGO_S_PATH} fill="none" stroke={C.ink} strokeWidth={stroke} />
    </svg>
  );
}
