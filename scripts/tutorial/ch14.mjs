// Chapter 14: Tools (world clock, commute planner) and Pay check.
import { start, sleep, click, ring, point, showAt, scrollBy, type } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const rec = await start("ch14", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
// Before the bid closes for the tools (the commute planner only looks up trips still to come); late October, as in
// chapter 13, for Pay check, so a pay claim on a trip already flown makes sense.
await setClock(page);
await page.goto(`${BASE}/tools`, { waitUntil: "load" });
await page.getByRole("heading", { name: "World clock" }).waitFor({ timeout: 30000 });
await sleep(2500);
await rec.begin();

// p1: the world clock.
rec.para(1);
await sleep(1500);
const map = page.getByText(/in daylight · the shaded side is night/).first();
if (await map.count()) { await showAt(page, map, 420, 1200); await ring(page, map.locator(".."), 2200); }
const time = page.getByLabel("Time to convert");
await showAt(page, time, 220, 900);
await click(page, time, { after: 300 });
await page.keyboard.type("0700", { delay: 160 });
// The field's AM/PM part (on a 12-hour system) isn't filled by typing the digits: set the value outright.
await time.fill("07:00");
await sleep(500);
await point(page, page.getByLabel("Whose clock"), 600);
await page.getByLabel("Whose clock").selectOption({ label: "CDG · Paris" });
await sleep(1000);
// The answer: every clock moves to that moment.
await ring(page, page.getByText("At the time you picked.").first(), 1500);
const tiles = page.locator("section", { has: page.getByRole("heading", { name: "World clock" }) }).locator("ul").first();
await showAt(page, tiles, 200, 1200);
await ring(page, tiles, 2600);
await rec.hold(-0.5);

// p2: the commute planner.
rec.para(2);
const planner = page.getByRole("heading", { name: "Commute planner" });
await showAt(page, planner, 110, 1300);
await sleep(1500);
await page.getByText(/Checking the airline schedules/).first().waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
await scrollBy(page, 320, 1500);
await sleep(1500);
await rec.hold(-0.5);

// p3: Pay check.
rec.para(3);
await page.clock.setSystemTime(new Date("2026-10-27T15:00:00Z"));
await page.goto(`${BASE}/pay`, { waitUntil: "load" });
await page.getByText("Bid Line Guarantee").first().waitFor({ timeout: 20000 });
await sleep(1200);
// The demo pilot's top line: the one they'd expect to hold.
const holdPick = page.locator("label", { hasText: "Line you hold" }).locator("select");
if (await holdPick.locator("option", { hasText: "Line 2186" }).count()) {
  await click(page, holdPick, { after: 300 });
  await holdPick.selectOption({ label: "Line 2186" });
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(900);
}
await ring(page, page.getByText("Bid Line Guarantee").first().locator(".."), 2200);
const each = page.getByText("Each trip's guarantee").or(page.getByText("Each trip’s guarantee")).first();
await showAt(page, each, 140, 1300);
await sleep(1500);
// A trip early in the month, already flown by late October, paid about four hours under its guarantee.
const tripPick = page.locator("label", { hasText: /^Trip/ }).locator("select");
await showAt(page, tripPick, 320, 1200);
const opts = await tripPick.locator("option").allTextContents();
// The biggest trip that starts in October and is flown by the 27th.
const hrs = (o) => { const m = o.match(/\((\d+):(\d{2})/); return m ? Number(m[1]) + Number(m[2]) / 60 : 0; };
let at = -1;
opts.forEach((o, i) => { const d = o.match(/on Oct (\d+)/); if (d && Number(d[1]) <= 22 && (at < 0 || hrs(o) > hrs(opts[at]))) at = i; });
if (at < 0) at = 0;
await click(page, tripPick, { after: 300 });
await tripPick.selectOption({ index: at });
await page.keyboard.press("Escape").catch(() => {});
await sleep(800);
const g = opts[at].match(/\((\d+):(\d{2})/) ?? opts[at].match(/\((\d+(?:\.\d+)?)/);
const guarantee = g ? (g[2] !== undefined ? Number(g[1]) + Number(g[2]) / 60 : Number(g[1])) : 14;
const short = Math.max(1, guarantee - 4);
const shortText = `${Math.floor(short)}:${String(Math.round((short % 1) * 60)).padStart(2, "0")}`;
console.log("claim trip:", opts[at], "paid", shortText);
const paid = page.getByPlaceholder("e.g. 14:30");
await type(page, paid, shortText, { delay: 140, after: 1500 });
const draft = page.getByText(/You may be owed/).first();
if (await draft.count()) { await showAt(page, draft, 200, 1000); await ring(page, draft.locator(".."), 2500); }
await rec.hold(0.3);
await rec.end();
