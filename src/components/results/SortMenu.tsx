"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  betterLabel,
  DEFAULT_SORT,
  LINE_SORTS,
  orderLabels,
  previewSort,
  searchSorts,
  SORT_GROUPS,
  SORT_REGIONS,
  sortAvailable,
  type SortChoice,
  type SortDef,
} from "@/lib/line-sorts";
import type { LineScore } from "@/lib/scoring";
import type { LineSort } from "@/lib/use-line-sort";
import type { Region } from "@/lib/metrics/trip-facts";

/** The sort button and its menu: every measure in plain words, searchable, with a look at what each one puts on top. */
export function SortMenu({ sort, lines }: { sort: LineSort; lines: LineScore[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => {
          sort.prepare();
          setOpen(true);
        }}
        className="flex min-h-10 items-center gap-1.5 rounded-md border border-hairline bg-canvas/50 px-2.5 py-2 text-left text-sm text-ink transition-colors hover:border-accent focus:border-accent focus:outline-none"
      >
        <span className="text-ink-muted">Sort:</span>
        <span className="max-w-[11rem] truncate font-medium sm:max-w-[16rem]">{sort.def.label}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink-faint">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && sort.ctx && <SortDialog sort={sort} lines={lines} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Said under the controls while the list isn't in the pilot's ranking: what they see isn't what they'd bid. */
export function SortNote({ sort }: { sort: LineSort }) {
  if (sort.isRanking) return null;
  return (
    <p className="mt-2 text-xs text-ink-muted print:hidden">
      Sorted by {sort.def.label.toLowerCase()} to look through. Send to VIPS and Copy still follow your ranking and tiers.{" "}
      <button type="button" onClick={() => sort.choose(DEFAULT_SORT)} className="font-semibold text-accent underline-offset-2 hover:underline">
        Back to your ranking
      </button>
    </p>
  );
}

function SortDialog({ sort, lines, onClose }: { sort: LineSort; lines: LineScore[]; onClose: () => void }) {
  const ctx = sort.ctx!;
  const baseId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  // After the dialog has taken focus for itself: its own effect runs before this one.
  useEffect(() => searchRef.current?.focus(), []);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Pick<SortChoice, "city" | "region">>({ city: sort.choice.city, region: sort.choice.region });
  // A flip belongs to the sort it was set on: the next one looked at starts from its own better end.
  const [flippedId, setFlippedId] = useState(sort.choice.reversed ? sort.choice.id : null);
  const offered = useMemo(() => LINE_SORTS.filter((d) => sortAvailable(d, ctx)), [ctx]);
  const found = useMemo(() => searchSorts(offered, query), [offered, query]);
  const [activeId, setActiveId] = useState(sort.def.id);
  const active = found.find((d) => d.id === activeId) ?? found[0] ?? null;
  const flipped = !!active && flippedId === active.id;
  const preview = useMemo(() => (active ? previewSort(lines, active, { ...picked, id: active.id, reversed: flipped }, ctx) : null), [active, lines, picked, flipped, ctx]);
  const notOffered = LINE_SORTS.length - offered.length;
  const optionId = (id: string) => `${baseId}-${id}`;

  function move(step: number) {
    if (found.length === 0) return;
    const i = active ? found.indexOf(active) : -1;
    const next = found[(i + step + found.length) % found.length];
    setActiveId(next.id);
    document.getElementById(optionId(next.id))?.scrollIntoView({ block: "nearest" });
  }

  function choose(def: SortDef) {
    sort.choose({ id: def.id, ...(flippedId === def.id ? { reversed: true } : {}), ...(picked.city ? { city: picked.city } : {}), ...(picked.region ? { region: picked.region } : {}) });
    onClose();
  }

  const order = active ? orderLabels(active) : null;
  const city = picked.city && ctx.cities.includes(picked.city) ? picked.city : ctx.cities[0];

  return (
    <Modal title="Sort lines by" onClose={onClose} wide>
      <input
        ref={searchRef}
        type="search"
        role="combobox"
        aria-expanded
        aria-controls={`${baseId}-list`}
        aria-activedescendant={active ? optionId(active.id) : undefined}
        aria-label="Search measures"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            move(e.key === "ArrowDown" ? 1 : -1);
          } else if (e.key === "Enter" && active) {
            e.preventDefault();
            choose(active);
          }
        }}
        placeholder="Search: credit, layover, hub turn…"
        className="w-full rounded-md border border-hairline bg-canvas/50 px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
      <div className="mt-3 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div id={`${baseId}-list`} role="listbox" aria-label="Measures" className="max-h-[30vh] overflow-y-auto pr-1 sm:max-h-[48vh]">
          {found.length === 0 && <p className="py-3 text-sm text-ink-muted">Nothing by that name.</p>}
          {query.trim()
            ? found.map((d) => <SortOption key={d.id} def={d} id={optionId(d.id)} active={d.id === active?.id} chosen={d.id === sort.def.id} onHover={setActiveId} onChoose={choose} />)
            : SORT_GROUPS.map((g) => {
                const inGroup = found.filter((d) => d.group === g.id);
                if (inGroup.length === 0) return null;
                const labelId = `${baseId}-group-${g.id}`;
                return (
                  <div key={g.id} role="group" aria-labelledby={labelId} className="mb-2">
                    <div id={labelId} className="sticky top-0 bg-surface py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      {g.label}
                    </div>
                    {inGroup.map((d) => (
                      <SortOption key={d.id} def={d} id={optionId(d.id)} active={d.id === active?.id} chosen={d.id === sort.def.id} onHover={setActiveId} onChoose={choose} />
                    ))}
                  </div>
                );
              })}
          {notOffered > 0 && !query.trim() && <p className="py-2 text-xs text-ink-muted">{notOffered} more need answers from your interview, such as where you commute from.</p>}
        </div>

        {active && preview && order && (
          <div className="rounded-lg border border-hairline bg-canvas/40 p-3 text-sm">
            <div className="font-semibold text-ink">{active.label}</div>
            <p className="mt-1 text-ink-muted">{active.definition}</p>
            {betterLabel(active) && <p className="mt-1 text-xs font-medium text-ink-muted">{betterLabel(active)}</p>}

            {active.needs === "city" && (
              <label className="mt-3 flex items-center gap-2 text-ink-muted">
                City
                <select
                  value={city}
                  onChange={(e) => setPicked({ ...picked, city: e.target.value })}
                  className="rounded-md border border-hairline bg-surface px-2 py-1.5 font-mono text-sm text-ink focus:border-accent focus:outline-none"
                >
                  {ctx.cities.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
            )}
            {active.needs === "region" && (
              <label className="mt-3 flex items-center gap-2 text-ink-muted">
                Region
                <select
                  value={picked.region ?? SORT_REGIONS[0].id}
                  onChange={(e) => setPicked({ ...picked, region: e.target.value as Region })}
                  className="rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                >
                  {SORT_REGIONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <fieldset className="mt-3">
              <legend className="sr-only">Order</legend>
              <div className="flex overflow-hidden rounded-md border border-hairline text-xs">
                {[
                  { flipped: false, label: order.usual },
                  { flipped: true, label: order.flipped },
                ].map((o) => (
                  <label key={o.label} className={`flex-1 cursor-pointer px-2 py-2 text-center font-medium has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${flipped === o.flipped ? "bg-accent-soft text-accent" : "text-ink-muted hover:text-ink"}`}>
                    <input type="radio" name={`${baseId}-order`} className="sr-only" checked={flipped === o.flipped} onChange={() => setFlippedId(o.flipped ? active.id : null)} />
                    {o.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">On top</div>
            <ol className="mt-1 space-y-1" aria-live="polite">
              {preview.top.map((t) => (
                <li key={t.lineNumber} className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-ink">Line {t.lineNumber}</span>
                  <span className="text-right text-ink-muted">{t.text}</span>
                </li>
              ))}
            </ol>
            {preview.measured < preview.total && <p className="mt-2 text-xs text-ink-muted">Known for {preview.measured} of {preview.total} lines. The rest go last.</p>}

            <Button onClick={() => choose(active)} className="mt-3 w-full">
              Sort by this
            </Button>
            <p className="mt-2 text-xs text-ink-muted">Sorting is for looking. Send to VIPS and Copy keep following your ranking and tiers.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function SortOption({
  def,
  id,
  active,
  chosen,
  onHover,
  onChoose,
}: {
  def: SortDef;
  id: string;
  active: boolean;
  chosen: boolean;
  onHover: (id: string) => void;
  onChoose: (def: SortDef) => void;
}) {
  return (
    // Keys reach the rows through the search box (aria-activedescendant), so a row itself never takes focus. A hover
    // already shows the row, so a click sorts by it; a phone has no hover, so its first tap shows and its second sorts.
    <div
      id={id}
      role="option"
      aria-selected={active}
      onMouseEnter={() => onHover(def.id)}
      onClick={() => (active ? onChoose(def) : onHover(def.id))}
      className={`flex min-h-10 cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-2 text-sm ${active ? "bg-accent-soft text-accent" : "text-ink"}`}
    >
      <span>{def.label}</span>
      {chosen && <span className="shrink-0 text-xs font-medium text-ink-muted">Now</span>}
    </div>
  );
}
