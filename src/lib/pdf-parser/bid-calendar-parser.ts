import type { BidCalendarEvent } from "@/types/bidpack";
import type { ExtractedPage, PositionedItem } from "@/lib/pdf-parser/text-extraction";

/**
 * Reads the bid calendar a bid pack prints on its cover page: two month grids (Sunday–Saturday) whose cells
 * name what happens that day — "OCT26 Cap Bid Closes 1200 CT", "CAP Conflict Input Window Opens 1700 CT",
 * "OT Release CAP 1915 LBT F/O 2115 LBT". The text has to be read by position: a row of the page runs across
 * all seven days, so its words belong to different dates.
 *
 * Layout, as printed: each calendar starts with "<Month> <Year>" beside "<N> Week Bidmonth"; a weekday header;
 * then for each week a row of dates ("Aug 30 31 Sep 1 2 …", right-aligned in their cells) followed by that
 * week's events, left-aligned at each cell's start, one event's lines a line apart and a blank line between
 * events. A week number sits in the left margin and is ignored.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DATE_TOKEN = /^(?:([A-Z][a-z]{2})\s+)?(\d{1,2})$/;

interface Row {
  y: number;
  items: PositionedItem[];
}

function rowsOf(items: PositionedItem[], tolerance = 2): Row[] {
  const rows: Row[] = [];
  for (const it of [...items].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= tolerance);
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseBidCalendarPage(page: ExtractedPage): BidCalendarEvent[] {
  const items = page.items.filter((i) => i.str.trim()).map((i) => ({ ...i, str: i.str.trim() }));
  const rows = rowsOf(items);

  // Each calendar's "<Month> <Year>" header, recognised by the "Week Bidmonth" beside it (the page title has none).
  const headers = rows
    .map((r) => {
      const label = r.items.find((i) => /^(\w+)\s+(\d{4})$/.test(i.str) && FULL_MONTHS.includes(i.str.split(/\s+/)[0]));
      if (!label || !r.items.some((i) => /Week\s+Bidmonth/i.test(i.str))) return null;
      const [name, year] = label.str.split(/\s+/);
      return { y: r.y, month: FULL_MONTHS.indexOf(name), year: Number(year) };
    })
    .filter((h): h is { y: number; month: number; year: number } => h !== null);
  if (headers.length === 0) return [];

  const weekdayRow = rows.find((r) => WEEKDAYS.every((d) => r.items.some((i) => i.str === d)));
  if (!weekdayRow) return [];
  const sundayX = weekdayRow.items.find((i) => i.str === "Sunday")!.x;
  const saturdayX = weekdayRow.items.find((i) => i.str === "Saturday")!.x;
  const cellWidth = (saturdayX - sundayX) / 6;

  // Date rows: five or more date tokens and nothing else (the margin's week number is a lone number further left).
  const dateRows = rows.filter((r) => r.items.filter((i) => DATE_TOKEN.test(i.str) && i.x > sundayX - cellWidth / 2).length >= 5);
  if (dateRows.length === 0) return [];

  // Cells start where the events do: the leftmost text under the dates, past the margin.
  const below = items.filter((i) => i.y > dateRows[0].y && i.x > sundayX - cellWidth / 2 && /[A-Za-z]/.test(i.str));
  if (below.length === 0) return [];
  const left = Math.min(...below.map((i) => i.x));
  const dateCell = (x: number) => Math.max(0, Math.min(6, Math.floor((x - left) / cellWidth)));
  const eventCell = (x: number) => Math.max(0, Math.min(6, Math.round((x - left) / cellWidth)));

  const events: BidCalendarEvent[] = [];
  dateRows.forEach((dateRow, w) => {
    const header = [...headers].reverse().find((h) => h.y < dateRow.y);
    if (!header) return;
    const nextBoundary = Math.min(
      dateRows[w + 1]?.y ?? Infinity,
      headers.find((h) => h.y > dateRow.y)?.y ?? Infinity
    );

    // The date in each of the week's seven cells, carrying the month across tokens that don't name one.
    const dates: (string | null)[] = Array(7).fill(null);
    let month: number | null = null;
    for (const it of dateRow.items) {
      const m = it.str.match(DATE_TOKEN);
      if (!m || it.x <= sundayX - cellWidth / 2) continue;
      if (m[1] && MONTHS.includes(m[1])) month = MONTHS.indexOf(m[1]);
      if (month === null) month = header.month;
      // A grid shows a few days of the months on either side; the year follows the header's across a December/January edge.
      const year = header.year + (month - header.month > 6 ? -1 : header.month - month > 6 ? 1 : 0);
      dates[dateCell(it.x)] = iso(year, month, Number(m[2]));
    }

    // The week's event lines, cell by cell, split into events at each blank line.
    const lines = items.filter((i) => i.y > dateRow.y + 1 && i.y < nextBoundary - 1 && i.x > sundayX - cellWidth / 2 && !/^\d{1,2}$/.test(i.str));
    for (let cell = 0; cell < 7; cell++) {
      const date = dates[cell];
      if (!date) continue;
      const inCell = lines.filter((i) => eventCell(i.x) === cell).sort((a, b) => a.y - b.y);
      if (inCell.length === 0) continue;
      const gaps = inCell.slice(1).map((it, k) => it.y - inCell[k].y).filter((g) => g > 1);
      const lineGap = gaps.length ? Math.min(...gaps) : 6;
      let current: PositionedItem[] = [];
      const flush = () => {
        if (current.length === 0) return;
        const text = current.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
        const t = text.match(/\b(\d{2})(\d{2})\s+(CT|LBT)\b/);
        events.push({ date, text, time: t ? `${t[1]}:${t[2]}` : null, zone: t ? (t[3] as "CT" | "LBT") : null });
        current = [];
      };
      inCell.forEach((it, k) => {
        if (k > 0 && it.y - inCell[k - 1].y > lineGap * 1.5) flush();
        current.push(it);
      });
      flush();
    }
  });
  return events.sort((a, b) => a.date.localeCompare(b.date));
}
