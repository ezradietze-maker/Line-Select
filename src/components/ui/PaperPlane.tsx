/**
 * A message on its way: a paper plane that folds into view and flies off up and to the right, once. Keyed by the
 * caller (`key={sends}`) to fly again on the next send; placed inside a `relative` box it starts from. Not drawn
 * under reduced motion (see `.paper-plane`).
 */
export function PaperPlane({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`paper-plane pointer-events-none absolute z-10 text-accent ${className}`}>
      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round">
        <path d="M2.5 11.2 21 3.5l-5.6 17-4.6-6.4-8.3-2.9Z" fill="var(--color-accent-soft)" />
        <path d="m21 3.5-10.2 10.6v5.2l2.6-3.3" />
      </svg>
    </span>
  );
}
