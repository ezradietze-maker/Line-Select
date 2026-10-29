import type { ReactNode } from "react";

/**
 * What each color means, in one line right above the picture it explains — the month calendar's, or a trip's — so a
 * pilot never has to scroll off to a legend to read it.
 */

/** A leg as the pictures draw it: a bold line with a tick at each end — blue, or magenta for a deadhead. */
export function LegSample({ deadhead = false }: { deadhead?: boolean }) {
  const tone = deadhead ? "bg-deadhead" : "bg-leg";
  return (
    <span aria-hidden className="relative inline-block h-2.5 w-6 shrink-0 align-middle">
      <span className={`absolute left-0 top-0 h-full w-[2px] rounded-full ${tone}`} />
      <span className={`absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 ${tone}`} />
      <span className={`absolute right-0 top-0 h-full w-[2px] rounded-full ${tone}`} />
    </span>
  );
}

function Line({ tone }: { tone: string }) {
  return <span aria-hidden className={`inline-block h-[3px] w-5 shrink-0 rounded-full ${tone}`} />;
}

function Item({ swatch, label }: { swatch: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {swatch}
      {label}
    </span>
  );
}

export function ColorKey({ variant, className = "" }: { variant: "calendar" | "trip"; className?: string }) {
  const trip = variant === "trip";
  return (
    <div className={`flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-ink-muted ${className}`} aria-label="What the colors mean">
      <Item swatch={<LegSample />} label="Flight" />
      <Item swatch={<LegSample deadhead />} label="Deadhead" />
      <Item swatch={<Line tone="bg-layover" />} label="Layover" />
      {trip && (
        <Item
          swatch={
            <span aria-hidden className="inline-flex items-center gap-[2px]">
              <span className="inline-block h-2 w-3 rounded-full bg-gt" />
              <span className="inline-block h-[3px] w-2.5 rounded-full bg-layover" />
            </span>
          }
          label="Hotel van (GT)"
        />
      )}
      <Item swatch={<Line tone="bg-rest" />} label="Rest hotel at a hub" />
      <Item swatch={<Line tone="bg-standby" />} label="Hotel standby" />
      <Item swatch={<span aria-hidden className="inline-block h-1.5 w-5 shrink-0 rounded-[2px] bg-calendar-accent/20" />} label="On duty, on the ground" />
      <Item swatch={<span className="font-mono text-[10px] font-semibold text-report">Rpt</span>} label="Report" />
      {trip && <Item swatch={<span className="font-mono text-[10px] font-semibold text-gt">P/U</span>} label="Hotel pickup" />}
    </div>
  );
}
