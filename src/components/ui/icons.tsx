interface IconProps {
  className?: string;
}

const base = "h-3.5 w-3.5";

export function CalendarIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );
}

export function CoinIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 7v10M9 9.5c0-1.4 1.3-2.5 3-2.5s3 .9 3 2c0 3-6 1.5-6 4.5 0 1.1 1.3 2 3 2s3-1.1 3-2.5" />
    </svg>
  );
}

export function ClockIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function PlaneIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M22 2L15 22l-4-9-9-4 20-7z" />
    </svg>
  );
}

/** Boarding-pass ticket with an upward arrow — uploading your bid pack. */
export function UploadIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} className={className}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" fill="currentColor" fillOpacity="0.12" />
      <path d="M15 6v12" strokeDasharray="2 2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15V9m-2.5 2.5L9 9l2.5 2.5" />
    </svg>
  );
}

/** Cockpit-style gauge with a needle — tuning your preferences. */
export function SlidersIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} className={className}>
      <circle cx="12" cy="13" r="8" fill="currentColor" fillOpacity="0.12" />
      <path strokeLinecap="round" d="M12 5v2M18.9 8.1l-1.4 1.4M5.1 8.1l1.4 1.4" />
      <path strokeLinecap="round" d="M12 13l4-3.2" />
      <circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none" />
      <path strokeLinecap="round" d="M8 20.5h8" />
    </svg>
  );
}

/** Trophy with a filled cup — your ranked lines. */
export function TrophyIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8 4h8v5a4 4 0 01-8 0V4z"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path strokeLinecap="round" d="M8 5H5a3 3 0 003 3M16 5h3a3 3 0 01-3 3M10 15v2a2 2 0 01-2 2H9m5-4v2a2 2 0 002 2h-1M9 20h6" />
    </svg>
  );
}

/** Two arrows with solid heads meeting head-on — offering and counter-offering a trade. */
export function SwapIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} className={className}>
      <path strokeLinecap="round" d="M4 8h11.5" />
      <path d="M14.5 5.3L19 8l-4.5 2.7z" fill="currentColor" stroke="none" />
      <path strokeLinecap="round" d="M20 16H8.5" />
      <path d="M9.5 13.3L5 16l4.5 2.7z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** A bed — hotel layovers, at a glance. */
export function BuildingIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} className={className}>
      <path strokeLinecap="round" d="M3 20V8" />
      <rect x="5.5" y="10.5" width="4.5" height="3" rx="1" fill="currentColor" fillOpacity="0.3" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 16h18v4M3 16v-2.5a2 2 0 012-2h13a2 2 0 012 2V16"
        fill="currentColor"
        fillOpacity="0.1"
      />
      <path strokeLinecap="round" d="M21 20v-4" />
    </svg>
  );
}

/** An envelope — offers and updates addressed to you. */
export function MailIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} className={className}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="currentColor" fillOpacity="0.12" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.5 6.5L12 13l8.5-6.5" />
    </svg>
  );
}

export function StarIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5z"
      />
    </svg>
  );
}

/**
 * The Line Select mark: a flight path curving from your current position
 * to a chosen waypoint — a line, selected. Uses CSS variables directly so
 * it stays on-brand across the light/dark accent tokens without a prop.
 */
export function LogoMark({ className = "h-7 w-7" }: IconProps) {
  return (
    <svg viewBox="0 0 28 28" className={className} aria-hidden>
      <rect width="28" height="28" rx="7" fill="var(--color-brand)" />
      <circle cx="7" cy="20" r="1.6" fill="var(--color-accent)" fillOpacity="0.55" />
      <path
        d="M7 20C11 20 11 8 21 8"
        stroke="var(--color-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="21" cy="8" r="2.1" fill="var(--color-accent)" />
    </svg>
  );
}

export function ChevronLeftIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
    </svg>
  );
}

export function ChevronDownIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** A fork and knife — nearby food. */
export function UtensilsIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3v7a2 2 0 004 0V3M9 10v11M17 3c-1.5 1-2 3-2 5s.5 3 2 3 2-1 2-3-.5-4-2-5zM17 11v10" />
    </svg>
  );
}

/** A dumbbell — nearby gyms. */
export function DumbbellIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9v6M2 10.5v3M20 9v6M22 10.5v3M7 12h10" strokeWidth={2.25} />
      <rect x="5" y="7.5" width="3" height="9" rx="1" fill="currentColor" fillOpacity="0.2" />
      <rect x="16" y="7.5" width="3" height="9" rx="1" fill="currentColor" fillOpacity="0.2" />
    </svg>
  );
}

/** A shopping basket — nearby grocery & pharmacy. */
export function BasketIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 9h16l-1.5 10a2 2 0 01-2 1.7H7.5a2 2 0 01-2-1.7L4 9z" fill="currentColor" fillOpacity="0.12" />
      <path strokeLinecap="round" d="M8 9V7a4 4 0 018 0v2" />
    </svg>
  );
}

/** A steaming cup — nearby coffee. */
export function CupIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 9h11v6a4 4 0 01-4 4H9a4 4 0 01-4-4V9z" fill="currentColor" fillOpacity="0.12" />
      <path strokeLinecap="round" d="M16 10.5h1.5a2.25 2.25 0 010 4.5H16M8 3.5c-.6.6-.6 1.4 0 2M11.5 3.5c-.6.6-.6 1.4 0 2" />
    </svg>
  );
}
