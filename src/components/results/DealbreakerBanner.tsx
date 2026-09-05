import type { DealbreakerViolation } from "@/lib/scoring";

interface DealbreakerBannerProps {
  violations: DealbreakerViolation[];
}

/**
 * Deliberately always visible — never behind an expand toggle. A line that
 * violates something the pilot was unambiguous about refusing needs to be
 * impossible to miss even glancing at the collapsed card, not folded quietly
 * into the Satisfaction Index the way a mild miss would be (see
 * `scoring.ts`'s `DEALBREAKER_SCORE_CAP` doc comment: capped, not zeroed —
 * still a real line worth showing, just flagged).
 */
export function DealbreakerBanner({ violations }: DealbreakerBannerProps) {
  if (violations.length === 0) return null;

  return (
    <div className="border-b border-danger/30 bg-danger-soft px-5 py-2.5 sm:px-6">
      <div className="flex items-start gap-2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mt-0.5 h-4 w-4 shrink-0 text-danger">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 3h.01M10.3 3.9L2.7 17a2 2 0 001.7 3h15.2a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
        </svg>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-danger">
            Violates {violations.length === 1 ? "something" : "things"} you said {violations.length === 1 ? "was" : "were"} a dealbreaker
          </div>
          <ul className="mt-1 space-y-0.5">
            {violations.map((v, i) => (
              <li key={i} className="text-sm leading-relaxed text-danger">
                &ldquo;{v.statement}&rdquo;
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
