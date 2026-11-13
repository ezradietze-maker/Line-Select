import { LOGO_BORDER as B, LOGO_L_PATH, LOGO_PLATE_RADIUS, LOGO_S_PATH, LOGO_STROKE, LOGO_VIEWBOX } from "@/lib/logo-geometry";

interface LogoMarkProps {
  className?: string;
}

/**
 * The Line Select mark (see `logo-geometry.ts`): an airfield location sign reading "LS". Colors come from the
 * `--logo-*` tokens, so it follows the day, night and red-light themes on its own.
 */
export function LogoMark({ className = "h-8 w-8" }: LogoMarkProps) {
  return (
    <svg viewBox={LOGO_VIEWBOX} className={className} aria-hidden>
      <rect width="64" height="64" rx={LOGO_PLATE_RADIUS} fill="var(--logo-plate)" />
      <rect
        x={B.inset}
        y={B.inset}
        width={64 - 2 * B.inset}
        height={64 - 2 * B.inset}
        rx={B.radius}
        fill="none"
        stroke="var(--logo-ink)"
        strokeWidth={B.stroke}
      />
      <path d={LOGO_L_PATH} fill="none" stroke="var(--logo-ink)" strokeWidth={LOGO_STROKE} strokeLinejoin="miter" />
      <path d={LOGO_S_PATH} fill="none" stroke="var(--logo-ink)" strokeWidth={LOGO_STROKE} />
    </svg>
  );
}

/**
 * "Line Select" as the sign beside the mark: an airfield direction sign, black letters on a yellow panel, so the
 * mark and the name stand together like a sign array at a taxiway junction.
 */
export function Wordmark({ className = "text-[15px]" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-[3px] bg-[var(--logo-ink)] px-[0.45em] py-[0.2em] font-display font-extrabold uppercase leading-none tracking-[0.04em] text-[var(--logo-plate)] ${className}`}
    >
      Line&nbsp;<span>Select</span>
    </span>
  );
}
