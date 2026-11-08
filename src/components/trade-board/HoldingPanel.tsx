"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { TextField } from "@/components/ui/TextField";
import { useAppState } from "@/lib/app-state";
import { heldTripsOfLine, tradeLocksFor, tripInstances } from "@/lib/trades/holding";
import { clearTradeHolding, fetchTradeHolding, saveTradeHolding, saveTradeSettings } from "@/lib/trades/holding-client";
import { tripInstanceKey } from "@/lib/trades/legality";
import type { BidPack, Trip } from "@/types/bidpack";
import type { HeldTrip, TradeHolding, TradeLock, TradeSettings } from "@/types/trade";

/** Past this many matches, a search for a pairing shows the first ones and asks for more digits. */
const MAX_SEARCH_RESULTS = 12;

function hours(h: number): string {
  const total = Math.round(h * 60);
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, "0")}`;
}

function dateOf(pack: BidPack, dayIndex: number): string | null {
  if (!pack.bidPeriodStart) return null;
  const d = new Date(`${pack.bidPeriodStart}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function tripText(pack: BidPack, trip: Trip): string {
  const name = trip.pairingNumber ? `Pairing ${trip.pairingNumber}` : "Trip";
  const date = trip.startDayIndex === null ? null : dateOf(pack, trip.startDayIndex);
  const cities = trip.layoverCities.length ? trip.layoverCities.join(" → ") : "no layovers";
  return `${name}${date ? ` · ${date}` : ""} · ${trip.days}-day · ${cities} · ${hours(trip.creditHours)} credit`;
}

/**
 * "What you hold": a pilot confirms their trips for this bid pack, which is what lets the site look for trades that suit
 * them. The site can't see VIPS, so the pilot says, starting from the award in their Logbook, and updates it after a
 * trade. Trips they can't trade are marked here.
 */
export function HoldingPanel({ bidPack }: { bidPack: BidPack }) {
  const { profile } = useAppState();
  const [loaded, setLoaded] = useState(false);
  const [holding, setHolding] = useState<TradeHolding | null>(null);
  const [settings, setSettings] = useState<TradeSettings>({ suggestMe: true, emailMatches: false });
  const [editing, setEditing] = useState(false);
  const [lineNumber, setLineNumber] = useState<string | null>(null);
  const [draft, setDraft] = useState<HeldTrip[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const instances = useMemo(() => tripInstances(bidPack), [bidPack]);
  const byKey = useMemo(() => new Map(instances.map((t) => [tripInstanceKey(t), t])), [instances]);
  const locks = useMemo(() => tradeLocksFor(bidPack), [bidPack]);
  const lines = useMemo(() => bidPack.lines.filter((l) => !l.estimated), [bidPack]);
  const awarded = (profile?.logbook ?? []).find((m) => m.bidPackId === bidPack.id && m.lineNumber)?.lineNumber ?? null;

  useEffect(() => {
    let cancelled = false;
    void fetchTradeHolding(bidPack.id).then((state) => {
      if (cancelled) return;
      if (state) {
        setHolding(state.holding);
        setSettings(state.settings);
      } else setError("Couldn't load what you hold just now.");
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [bidPack.id]);

  function chooseLine(number: string | null) {
    setLineNumber(number);
    const line = lines.find((l) => l.lineNumber === number);
    setDraft(line ? heldTripsOfLine(line) : []);
  }

  function startEditing() {
    setError(null);
    setSearch("");
    if (holding) {
      setLineNumber(holding.lineNumber);
      setDraft(holding.trips);
    } else chooseLine(awarded);
    setEditing(true);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const saved = await saveTradeHolding({
      packId: bidPack.id,
      bidPackMeta: { base: bidPack.base, aircraft: bidPack.aircraft, seat: bidPack.seat, month: bidPack.month },
      lineNumber,
      trips: draft,
    });
    setBusy(false);
    if (!saved) return setError("Couldn't save what you hold. Check your connection and try again.");
    setHolding(saved);
    setEditing(false);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const ok = await clearTradeHolding(bidPack.id);
    setBusy(false);
    if (!ok) return setError("Couldn't remove that. Check your connection and try again.");
    setHolding(null);
    setEditing(false);
  }

  async function changeSettings(change: Partial<TradeSettings>) {
    const next = { ...settings, ...change };
    setSettings(next);
    if (!(await saveTradeSettings(next))) {
      setSettings(settings);
      setError("Couldn't save that. Check your connection and try again.");
    }
  }

  const heldKeys = new Set(draft.map(tripInstanceKey));
  const query = search.trim();
  const found = query ? instances.filter((t) => t.pairingNumber?.startsWith(query) && !heldKeys.has(tripInstanceKey(t))) : [];

  if (!loaded) return null;

  return (
    <section className="panel-glass mt-6 p-5">
      <h2 className="font-display text-base font-semibold text-ink">What you hold</h2>
      {error && <ErrorBanner className="mt-3">{error}</ErrorBanner>}

      {!editing && !holding && (
        <>
          <p className="mt-1.5 text-sm text-ink-muted">
            Confirm your trips and the site can look for trades that leave you and other pilots better off. Your name and
            these trips can then appear on trades suggested to other pilots in your base, aircraft and seat.
          </p>
          <Button className="mt-3" onClick={startEditing}>
            Confirm what I hold
          </Button>
        </>
      )}

      {!editing && holding && (
        <>
          <ul className="mt-2 space-y-1 text-sm text-ink-muted">
            {holding.trips.map((h) => {
              const trip = byKey.get(tripInstanceKey(h));
              return (
                <li key={tripInstanceKey(h)}>
                  {trip ? tripText(bidPack, trip) : "A trip that isn't in this bid pack"}
                  {h.lock && <span className="ml-2 text-warn">Can&rsquo;t trade: {locks.find((l) => l.lock === h.lock)?.label ?? h.lock}</span>}
                </li>
              );
            })}
          </ul>
          <label className="mt-3 flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-0.5" checked={settings.suggestMe} onChange={(e) => void changeSettings({ suggestMe: e.target.checked })} />
            <span>Include me when suggesting trades</span>
          </label>
          <label className="mt-2 flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-0.5" checked={settings.emailMatches} disabled={!settings.suggestMe} onChange={(e) => void changeSettings({ emailMatches: e.target.checked })} />
            <span>Email me when a trade needs my answer</span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={startEditing}>
              Update
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
              Remove
            </Button>
          </div>
        </>
      )}

      {editing && (
        <div className="mt-2 space-y-4">
          {(!holding || holding.lineNumber) && (
            <div>
              <label htmlFor="held-line" className="mb-1.5 block text-sm font-medium text-ink">
                The line you were awarded
              </label>
              <select
                id="held-line"
                value={lineNumber ?? ""}
                onChange={(e) => chooseLine(e.target.value || null)}
                className="w-full rounded-md border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                <option value="">Choose a line, or add trips below</option>
                {lines.map((l) => (
                  <option key={l.id} value={l.lineNumber}>
                    Line {l.lineNumber}
                    {l.lineNumber === awarded ? " (from your Logbook)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {draft.length > 0 && (
            <ul className="space-y-3">
              {draft.map((h) => {
                const key = tripInstanceKey(h);
                const trip = byKey.get(key);
                return (
                  <li key={key} className="text-sm text-ink">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>{trip ? tripText(bidPack, trip) : "A trip that isn't in this bid pack"}</span>
                      <button type="button" className="text-xs text-ink-muted underline" onClick={() => setDraft(draft.filter((d) => d !== h))}>
                        I no longer hold this
                      </button>
                    </div>
                    <label className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      Can&rsquo;t trade it?
                      <select
                        value={h.lock ?? ""}
                        onChange={(e) => setDraft(draft.map((d) => (d === h ? { ...d, lock: (e.target.value || null) as TradeLock | null } : d)))}
                        className="max-w-full rounded-md border border-border-strong bg-surface px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand/40"
                      >
                        <option value="">I can trade it</option>
                        {locks.map((l) => (
                          <option key={l.lock} value={l.lock}>
                            {l.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <div>
            <TextField label="Add a trip by its pairing number" inputMode="numeric" placeholder="e.g. 83" value={search} onChange={(e) => setSearch(e.target.value)} />
            {query && found.length === 0 && <p className="mt-1.5 text-xs text-ink-muted">No other trips with that pairing number in this bid pack.</p>}
            {found.length > 0 && (
              <ul className="mt-2 space-y-1">
                {found.slice(0, MAX_SEARCH_RESULTS).map((t) => (
                  <li key={tripInstanceKey(t)}>
                    <button
                      type="button"
                      className="text-left text-sm text-ink underline decoration-dotted underline-offset-4"
                      onClick={() => {
                        setDraft([...draft, { id: t.id, startDayIndex: t.startDayIndex!, lock: null }].sort((a, b) => a.startDayIndex - b.startDayIndex));
                        setSearch("");
                      }}
                    >
                      {tripText(bidPack, t)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || draft.length === 0} onClick={() => void confirm()}>
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
