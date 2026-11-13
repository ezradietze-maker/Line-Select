/**
 * Mark: a tick drawn once, like a grease pencil on a strip — that something was sent, copied or saved. Keyed by the
 * caller (`key={sends}`) to draw again on the next one; placed inside a `relative` box when given a position. Drawn
 * whole, without the stroke, under reduced motion (see `.tick-draw`).
 */
export function MarkTick({ className = "text-good" }: { className?: string }) {
  return (
    <span aria-hidden className={`pointer-events-none inline-flex ${className}`}>
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={3}>
        <path className="tick-draw" strokeLinecap="square" strokeLinejoin="miter" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}
