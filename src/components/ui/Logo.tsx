import { useId } from "react";
import {
  LOGO_L_PATH,
  LOGO_PLATE_RADIUS,
  LOGO_S_PATH,
  LOGO_STROKE,
  LOGO_THRESHOLD_BARS_X,
  LOGO_THRESHOLD_BARS_Y,
  LOGO_VIEWBOX,
} from "@/lib/logo-geometry";

interface LogoMarkProps {
  className?: string;
  /** Draws the runway threshold bars — only worth it from roughly 48px up, where they read as marks rather than noise. */
  detailed?: boolean;
}

/**
 * The Line Select mark (see `logo-geometry.ts`). Colors come from the
 * `--logo-*` tokens, so it follows light, dark and red-light themes on its
 * own. Gradient ids are per-instance (`useId`), since the sidebar and the
 * mobile header can render it twice on one page.
 */
export function LogoMark({ className = "h-8 w-8", detailed = false }: LogoMarkProps) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox={LOGO_VIEWBOX} className={className} aria-hidden>
      <defs>
        <radialGradient id={`plate-${id}`} cx="30%" cy="22%" r="95%">
          <stop offset="0" stopColor="var(--logo-plate-1)" />
          <stop offset="1" stopColor="var(--logo-plate-2)" />
        </radialGradient>
        <linearGradient id={`sheen-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.1" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx={LOGO_PLATE_RADIUS} fill={`url(#plate-${id})`} />
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="63"
        rx={LOGO_PLATE_RADIUS - 0.5}
        fill={`url(#sheen-${id})`}
        stroke="var(--logo-rim)"
      />
      <path
        d={LOGO_L_PATH}
        fill="none"
        stroke="var(--logo-ink)"
        strokeWidth={LOGO_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeOpacity={0.92}
      />
      {detailed && (
        <g stroke="var(--logo-ink)" strokeOpacity={0.45} strokeWidth={1.6} strokeLinecap="round">
          {LOGO_THRESHOLD_BARS_X.map((x) => (
            <line key={x} x1={x} y1={LOGO_THRESHOLD_BARS_Y[0]} x2={x} y2={LOGO_THRESHOLD_BARS_Y[1]} />
          ))}
        </g>
      )}
      <path
        d={LOGO_S_PATH}
        fill="none"
        stroke="var(--logo-accent)"
        strokeWidth={LOGO_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "Line Select" set in the display face, with "Select" in the accent — the mark's own two colors, in words. */
export function Wordmark({ className = "text-[15px]" }: { className?: string }) {
  return (
    <span className={`font-display font-semibold tracking-[0.01em] text-ink ${className}`}>
      Line <span className="text-accent">Select</span>
    </span>
  );
}
