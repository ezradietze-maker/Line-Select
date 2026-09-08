import { DateTime } from "luxon";
import type { Line } from "@/types/bidpack";

function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** RFC 5545 line folding at 75 octets — a simple char-based approximation (this app's own text is plain ASCII), not a full UTF-8 octet-boundary implementation. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

export interface IcsExportResult {
  ok: boolean;
  /** Present only when ok — the .ics file content, ready to download. */
  content?: string;
  /** Present only when !ok — why no honest calendar dates could be produced for this line. */
  reason?: string;
}

/**
 * Builds a real .ics calendar file for one line's trips — matches Acrobid's
 * "add trips to your device calendar" feature, staying inside the same safe
 * boundary as the existing copy-to-clipboard export (purely local, no
 * FedEx account or credentials involved).
 *
 * All-day, multi-day events, not exact clock times: this app can read a
 * trip's real report time as printed local text (`schedule[0].reportTimeLocal`),
 * but doesn't track which IANA timezone that belongs to per airport, so
 * rather than guess at a precise UTC instant, the report time is named in
 * plain text in the event's own description instead of claimed as the
 * event's actual start time.
 *
 * Real dates only: if this line's trips don't have a grid-confirmed
 * placement against the bid pack's own start date (see `Trip.startDayIndex`'s
 * doc comment — a whole line is placed together or not at all), there's
 * nothing honest to export, so this returns `ok: false` with a plain-English
 * reason instead of guessing at dates.
 */
export function buildLineCalendar(line: Line, bidPeriodStart: string | null): IcsExportResult {
  const placementIsReal = bidPeriodStart !== null && line.trips.every((t) => t.startDayIndex !== null);
  if (!placementIsReal) {
    return {
      ok: false,
      reason:
        "This line's trip dates couldn't be confidently read from the bid pack, so there's nothing real to export to a calendar.",
    };
  }

  const base = DateTime.fromISO(bidPeriodStart!, { zone: "utc" });
  const stamp = DateTime.utc().toFormat("yyyyLLdd'T'HHmmss'Z'");

  const events = line.trips.map((trip, i) => {
    const start = base.plus({ days: trip.startDayIndex! });
    const end = start.plus({ days: trip.days });
    const reportTime = trip.schedule[0]?.reportTimeLocal;
    const cities = trip.layoverCities.length > 0 ? trip.layoverCities.join(" \u2192 ") : "no layovers";
    const summary = trip.pairingNumber
      ? `Pairing ${trip.pairingNumber} (Line ${line.lineNumber})`
      : `Line ${line.lineNumber} trip`;
    const description = [
      reportTime ? `Reports ${reportTime.slice(0, 2)}:${reportTime.slice(2)} local` : null,
      `${trip.days}-day trip, ${cities}`,
      `${trip.creditHours.toFixed(1)} credit hours`,
    ]
      .filter((v): v is string => !!v)
      .join(" \u2014 ");

    return [
      "BEGIN:VEVENT",
      `UID:line-select-${line.id}-${i}@line-select.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start.toFormat("yyyyLLdd")}`,
      `DTEND;VALUE=DATE:${end.toFormat("yyyyLLdd")}`,
      foldLine(`SUMMARY:${escapeIcsText(summary)}`),
      foldLine(`DESCRIPTION:${escapeIcsText(description)}`),
      "END:VEVENT",
    ].join("\r\n");
  });

  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Line Select//Bid Line Export//EN",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return { ok: true, content };
}
