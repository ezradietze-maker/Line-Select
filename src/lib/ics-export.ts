import { DateTime } from "luxon";
import type { Line } from "@/types/bidpack";

/** An event's id with only id characters: a pack's pairing number with a line break in it wrote a line of its own. */
const safeUid = (uid: string) => uid.replace(/[^A-Za-z0-9._@-]/g, "-");

export function escapeIcsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

const encoder = new TextEncoder();
const octets = (s: string) => encoder.encode(s).length;

/** RFC 5545 3.1 line folding: no line over 75 octets, and never splitting a multi-byte character (hotel names and arrows aren't plain ASCII). */
export function foldLine(line: string): string {
  if (octets(line) <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let used = 0;
  for (const ch of line) {
    const size = octets(ch);
    if (used + size > 75) {
      parts.push(current);
      current = " ";
      used = 1;
    }
    current += ch;
    used += size;
  }
  parts.push(current);
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
 *
 * Each event is named (UID) by the bid month, the pairing and its date, as the calendar link names its trips: line ids
 * repeat every month (`line-101`), so a UID built from one made importing December's file move November's events.
 */
export function buildLineCalendar(line: Line, bidPeriodStart: string | null, bidMonth: string): IcsExportResult {
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

  const events = line.trips.map((trip) => {
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
      `UID:${safeUid(`line-trip-${bidMonth}-${trip.pairingNumber ?? trip.id}-${start.toFormat("yyyy-LL-dd")}@lineselect`)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start.toFormat("yyyyLLdd")}`,
      `DTEND;VALUE=DATE:${end.toFormat("yyyyLLdd")}`,
      foldLine(`SUMMARY:${escapeIcsText(summary)}`),
      foldLine(`DESCRIPTION:${escapeIcsText(description)}`),
      "END:VEVENT",
    ].join("\r\n");
  });

  // RFC 5545 3.1: every line ends in CRLF, the last one too.
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Line Select//Bid Line Export//EN",
    "CALSCALE:GREGORIAN",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n") + "\r\n";

  return { ok: true, content };
}

export const icsUtc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * The bid deadline as a calendar event with two alarms — the day before and an hour before — so a pilot's own phone
 * reminds them whether or not Line Select is open. `deadline` is the instant the pilot typed in, never a guess.
 *
 * Named (UID) by the pack, not the time: a corrected close then replaces the event already imported instead of adding
 * a second one. It lasts 15 minutes, as RFC 5545 needs an end after the start.
 */
export function buildDeadlineReminderIcs(packId: string, deadline: string, label: string, now: number = Date.now()): string {
  const at = new Date(deadline).getTime();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Line Select//Bid deadline//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${safeUid(`bid-close-${packId}@lineselect`)}`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${icsUtc(at)}`,
    "DURATION:PT15M",
    `SUMMARY:${escapeIcsText(`Bid closes — ${label}`)}`,
    `DESCRIPTION:${escapeIcsText("Enter your line order before bidding closes. Line Select doesn't submit anything for you.")}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(`Bid closes tomorrow — ${label}`)}`,
    "TRIGGER:-P1D",
    "END:VALARM",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeIcsText(`Bid closes in an hour — ${label}`)}`,
    "TRIGGER:-PT1H",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
