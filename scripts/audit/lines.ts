/**
 * Audit of every line's totals against the bid pack's own line pages
 * (`.cache/raw/<pdf>.lines.txt`, written by dump-pairings.ts): the printed
 * credit, time away, block, landings, days off, duty periods and carry-over
 * for each line, read here independently, against what the app shows — and
 * whether the trips the app put on each line add up to those printed totals
 * (the test of whether it matched the right trips to the line).
 *
 * Usage: npx tsx scripts/audit/lines.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { DateTime } from "luxon";
import { timezoneForAirport } from "@/lib/airport-timezones";
import { restoreBidPack } from "@/lib/bidpack-storage";
import { tripReportUtc } from "@/lib/trip-anchor";
import { tripDutyPeriods } from "@/lib/duty-periods";
import { buildDetailedMonth } from "@/lib/month-detail";
import { lineStandbyDays } from "@/lib/standby";
import type { BidPack, Line } from "@/types/bidpack";

const totals: Record<string, number> = {};
const bump = (k: string, n = 1) => (totals[k] = (totals[k] ?? 0) + n);
const examples: Record<string, string[]> = {};
const note = (k: string, s: string) => {
  bump(k);
  if ((examples[k] ??= []).length < 8) examples[k].push(s);
};

interface Printed {
  credit: number;
  tafb: number;
  block: number;
  landings: number;
  daysOff: number;
  dutyPeriods: number;
  coCredit: number;
  coBlock: number;
  /** Hotel-standby days, as the grid prints them ("HSBY" in a day's cell). */
  standbyDays: number;
}

const hours = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h + m / 60;
};

/** Every line's printed totals, by seat and line number. */
function readLines(file: string): Map<string, Printed> {
  const out = new Map<string, Printed>();
  const rows = readFileSync(file, "utf8").split("\n");
  let seat = "CAP";
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (/DOMICILE/.test(r)) seat = /First Officer/i.test(r) ? "FO" : "CAP";
    const m = /^LINE\s+(\d+)/.exec(r);
    if (!m) continue;
    const block = rows.slice(i, i + 6).join(" ");
    const g = (re: RegExp) => re.exec(block)?.[1];
    const co = [...block.matchAll(/C\/O\.\s+(\d{1,3}:\d{2})/g)].map((x) => hours(x[1]));
    const cr = g(/CR\.\s+(\d{1,3}:\d{2})/);
    if (!cr) continue;
    out.set(`${seat}|${m[1]}`, {
      credit: hours(cr),
      tafb: hours(g(/TAFB\s+(\d{1,4}:\d{2})/) ?? "0:00"),
      block: hours(g(/BLK\.\s+(\d{1,3}:\d{2})/) ?? "0:00"),
      landings: Number(g(/LANDINGS\s+(\d+)/) ?? NaN),
      daysOff: Number(g(/DAYS\s+OFF\s+(\d+)/) ?? NaN),
      dutyPeriods: Number(g(/NO\.\s+DP.?S\s+(\d+)/i) ?? NaN),
      coCredit: co[0] ?? 0,
      coBlock: co[1] ?? 0,
      standbyDays: (block.match(/HSBY/g) ?? []).length,
    });
  }
  return out;
}

const close = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;
const h = (x: number) => `${Math.floor(x + 1e-9)}:${String(Math.round((x - Math.floor(x + 1e-9)) * 60)).padStart(2, "0")}`;

function checkLine(tag: string, pack: BidPack, line: Line, p: Printed) {
  const where = `${tag} line ${line.lineNumber}`;
  bump("lines checked against their printed totals");
  // What the line card shows, against what the pack prints.
  const shown: [string, number, number, boolean][] = [
    ["credit", line.totalCreditHours, p.credit, close(line.totalCreditHours, p.credit)],
    ["time away (TAFB)", line.totalTafbHours, p.tafb, close(line.totalTafbHours, p.tafb)],
    ["block", line.totalBlockHours ?? NaN, p.block, close(line.totalBlockHours ?? NaN, p.block)],
    ["landings", line.totalLandings, p.landings, line.totalLandings === p.landings],
    ["days off", line.daysOff, p.daysOff, line.daysOff === p.daysOff],
    ["duty periods", line.totalDutyPeriods ?? NaN, p.dutyPeriods, line.totalDutyPeriods === p.dutyPeriods],
    ["carry-over credit", line.carryOverCreditHours ?? 0, p.coCredit, close(line.carryOverCreditHours ?? 0, p.coCredit)],
    ["carry-over block", line.carryOverBlockHours ?? 0, p.coBlock, close(line.carryOverBlockHours ?? 0, p.coBlock)],
  ];
  for (const [what, app, pdf, ok] of shown)
    if (!ok)
      note(
        `lines whose ${what} differs from the PDF`,
        `${where}: app ${what.includes("land") || what.includes("days") || what.includes("duty") ? app : h(app)}, PDF ${what.includes("land") || what.includes("days") || what.includes("duty") ? pdf : h(pdf)}`
      );

  if (line.estimated) {
    note("lines shown without trip detail (trips couldn't be matched)", where);
    return;
  }
  // The trips on the line add up to it.
  const sum = (f: (t: Line["trips"][number]) => number) => line.trips.reduce((a, t) => a + f(t), 0);
  const tripCredit = sum((t) => t.creditHours);
  const tripLandings = sum((t) => t.landings);
  const tripTafb = sum((t) => t.tafbHours);
  const tripBlock = sum((t) =>
    t.schedule
      .flatMap((d) => d.legs)
      .filter((l) => /^\d+$/.test(l.flightNumber))
      .reduce((a, l) => a + (l.blockHours ?? 0), 0)
  );
  const tripDuty = sum((t) => tripDutyPeriods(t));
  // The printed CR. and BLK. are this period's share; a trip crossing the period's edge carries the rest (C/O.).
  if (!close(tripCredit, p.credit + p.coCredit, 0.05) && !close(tripCredit, p.credit, 0.05))
    note(
      "lines whose trips' credit doesn't add up to the printed credit",
      `${where}: trips ${h(tripCredit)}, printed CR ${h(p.credit)} + C/O ${h(p.coCredit)}`
    );
  else bump("lines whose trips' credit adds up");
  if (!close(tripBlock, p.block + p.coBlock, 0.05) && !close(tripBlock, p.block, 0.05))
    note("lines whose trips' block doesn't add up to the printed block", `${where}: trips ${h(tripBlock)}, printed BLK ${h(p.block)} + C/O ${h(p.coBlock)}`);
  else bump("lines whose trips' block adds up");
  if (tripLandings !== p.landings)
    note("lines whose trips' landings don't add up to the printed landings", `${where}: trips ${tripLandings}, printed ${p.landings}`);
  else bump("lines whose trips' landings add up");
  // The printed TAFB counts only time inside the bid period: a trip running past its last day (or in from before its
  // first) counts the part inside. Clipped the same way, the trips should add up to it.
  const zone = timezoneForAirport(pack.base);
  const periodStart = zone && pack.bidPeriodStart ? DateTime.fromISO(pack.bidPeriodStart, { zone }).toMillis() : null;
  const periodEnd = periodStart !== null ? DateTime.fromMillis(periodStart, { zone: zone! }).plus({ days: pack.bidPeriodDays }).toMillis() : null;
  const clipped = line.trips.reduce((a, t) => {
    const at = tripReportUtc(pack, t);
    if (at === null || periodStart === null || periodEnd === null) return a + t.tafbHours;
    const end = at + t.tafbHours * 3_600_000;
    return a + Math.max(0, Math.min(end, periodEnd) - Math.max(at, periodStart)) / 3_600_000;
  }, 0);
  // Measured across all seven October packs: the pack clips at 01:30 the morning after the period's last day (every
  // such line lands within a couple of minutes of it).
  if (close(tripTafb, p.tafb, 0.05)) bump("lines whose trips' time away adds up");
  else if (close(clipped + 1.5, p.tafb, 0.06)) bump("lines whose trips' time away adds up once clipped at the period's end (01:30 next morning)");
  else
    note(
      "lines whose trips' time away doesn't add up to the printed TAFB",
      `${where}: trips ${h(tripTafb)}, clipped to the period ${h(clipped)}, printed ${h(p.tafb)}`
    );
  if (tripDuty !== p.dutyPeriods)
    note("lines whose trips' duty periods don't add up to the printed count", `${where}: trips ${tripDuty}, printed ${p.dutyPeriods}`);
  else bump("lines whose trips' duty periods add up");
  // The standby days the card shows, against the grid's own HSBY days.
  const standby = lineStandbyDays(line);
  if (standby !== p.standbyDays) note("lines whose standby days differ from the grid's HSBY days", `${where}: app ${standby}, grid ${p.standbyDays}`);
  else bump("lines whose standby days match the grid");
  // The departures the card shows are the trips' landings.
  if (line.totalDepartures !== tripLandings)
    note("lines whose shown departures differ from their trips' landings", `${where}: ${line.totalDepartures} vs ${tripLandings}`);

  // The month calendar's own count of days off matches the printed one.
  const month = buildDetailedMonth(line, pack.bidPeriodStart, pack.bidPeriodDays);
  if (month.placementIsReal) {
    if (month.summary.daysOff !== p.daysOff)
      note("month calendars whose days off differ from the printed count", `${where}: calendar ${month.summary.daysOff}, printed ${p.daysOff}`);
    else bump("month calendars whose days off match the printed count");
  }
}

for (const file of readdirSync(".cache/packs")
  .filter((f) => f.endsWith(".json"))
  .sort()) {
  const pack = restoreBidPack(JSON.parse(readFileSync(`.cache/packs/${file}`, "utf8")));
  const raw = readdirSync(".cache/raw").find((f) => f.includes(`${pack.aircraft}_${pack.base}.lines`));
  if (!raw) continue;
  const printed = readLines(`.cache/raw/${raw}`);
  const tag = file.replace(".json", "");
  const seatLines = [...printed.keys()].filter((k) => k.startsWith(`${pack.seat}|`));
  for (const line of pack.lines) {
    const p = printed.get(`${pack.seat}|${line.lineNumber}`);
    if (!p) note("lines the audit couldn't find printed", `${tag} line ${line.lineNumber}`);
    else checkLine(tag, pack, line, p);
  }
  const missing = seatLines.filter((k) => !pack.lines.some((l) => `${pack.seat}|${l.lineNumber}` === k));
  for (const k of missing) note("printed lines missing from the app", `${tag} line ${k.split("|")[1]}`);
  console.log(`${tag.padEnd(20)} ${pack.lines.length} lines in the app, ${seatLines.length} printed`);
}

console.log("\nTotals:");
for (const [k, v] of Object.entries(totals).sort()) console.log(`  ${k}: ${v}`);
for (const [k, xs] of Object.entries(examples)) console.log(`\n${k} — e.g.\n  ${xs.join("\n  ")}`);
