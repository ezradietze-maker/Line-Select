import type { HeldByNoteData } from "@/lib/use-held-by";

const RELATION = { you: "you", senior: "senior to you", junior: "junior to you" } as const;

/** Under the odds in an opened line card. Says where it comes from, and never claims to be the full award. */
export function HeldByNote({ note, showOdds }: { note: HeldByNoteData; showOdds: boolean }) {
  const { holder, oddsCheckedAgainst } = note;
  const odds = showOdds && oddsCheckedAgainst ? `Odds checked against ${oddsCheckedAgainst} shared awards.` : null;
  if (!holder && !odds) return null;
  return (
    <p className="mt-1.5 text-xs text-ink-muted">
      {holder && (
        <>
          <span className="font-medium text-ink">Held by {holder.seniority !== null ? `seniority #${holder.seniority}` : `bid position #${holder.bidPosition}`}</span>
          {holder.relation && ` · ${RELATION[holder.relation]}`}
          <span className="text-ink-faint"> · from pilots who shared, not the full award</span>
        </>
      )}
      {holder && odds && " "}
      {odds && <span className="text-ink-faint">{odds}</span>}
    </p>
  );
}
