/**
 * The app icon rendered server-side for PWA/manifest assets — same shape as
 * `LogoMark` in components/ui/icons.tsx, but with fixed hex colors instead
 * of CSS variables, since these render once to a static raster image rather
 * than live in a themeable page.
 */
export function iconMarkup(size: number) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28">
      <rect width="28" height="28" rx="7" fill="#1c3d5c" />
      <circle cx="7" cy="20" r="1.6" fill="#b5792b" fillOpacity="0.55" />
      <path
        d="M7 20C11 20 11 8 21 8"
        stroke="#b5792b"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="21" cy="8" r="2.1" fill="#b5792b" />
    </svg>
  );
}
