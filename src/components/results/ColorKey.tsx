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
      <Item swatch={<LegSample />} label="FX Flight" />
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
      {!trip && (
        <>
          <Item
            swatch={
              <svg aria-hidden width="26" height="12" className="shrink-0 overflow-visible text-leg">
                <line x1="17" y1="2" x2="25" y2="2" stroke="currentColor" strokeWidth="3" />
                <line x1="25" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="2" y1="10" x2="10" y2="10" stroke="currentColor" strokeWidth="3" />
              </svg>
            }
            label="Date line eastbound (−h: clock goes back)"
          />
          <Item
            swatch={
              <svg aria-hidden width="26" height="10" className="shrink-0 overflow-visible text-leg">
                <line x1="1" y1="5" x2="7" y2="5" stroke="currentColor" strokeWidth="3" />
                <polyline points="7,5 9,2.5 11,7.5 13,2.5 15,7.5 17,2.5 19,5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                <line x1="19" y1="5" x2="25" y2="5" stroke="currentColor" strokeWidth="3" />
              </svg>
            }
            label="Date line westbound (+h: clock jumps ahead)"
          />
        </>
      )}
      <Item swatch={<Line tone="bg-standby" />} label="Hotel standby" />
      <Item
        swatch={
          <span aria-hidden className="inline-block h-3 w-7 shrink-0 rounded-[3px] bg-calendar-accent/30" />
        }
        label="Duty Period + GT"
      />
      <Item swatch={<span className="font-mono text-[10px] font-semibold text-report">Rpt</span>} label="Report" />
      {trip && <Item swatch={<span className="font-mono text-[10px] font-semibold text-gt">P/U</span>} label="Hotel pickup" />}
    </div>
  );
}
