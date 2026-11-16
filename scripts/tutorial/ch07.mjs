// Chapter 7: finding the lines you want — ask your pack, sort, filters, compare, jump to a line.
import { start, sleep, click, type, ring, point, showAt, openResults } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const rec = await start("ch07", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await openResults(page);
const ask = page.getByPlaceholder(/^Lines with /);
await showAt(page, ask, 200, 300);
await rec.begin();

// p1: ask your pack.
rec.para(1);
await sleep(800);
await type(page, ask, "Lines with Paris and at least 14 days off", { delay: 40 });
await click(page, page.getByRole("button", { name: "Ask", exact: true }), { after: 500 });
await page.getByText("in your order").first().waitFor({ timeout: 60000 });
await sleep(1200);
await ring(page, page.getByText("in your order").first().locator("../.."), 3000);
await rec.hold(-0.5);

// p2: sort by almost anything.
rec.para(2);
const sortBtn = page.getByRole("button", { name: /^Sort:/ });
await showAt(page, sortBtn, 200, 1000);
await click(page, sortBtn, { after: 1200 });
const dlg = page.getByRole("dialog");
await type(page, dlg.getByLabel("Search measures"), "body clock", { delay: 60, after: 1200 });
// Typing previews the first match; point at it, then sort.
await click(page, dlg.getByRole("option", { name: /^Body-clock score/ }).first(), { after: 1400 });
const sortThis = dlg.getByRole("button", { name: "Sort by this" });
if (await sortThis.isVisible().catch(() => false)) await click(page, sortThis, { after: 1200 });
// The lines in that order, before going back to the ranking.
const sorted = page.locator("[data-line-id]");
await showAt(page, sorted.first(), 140, 1200);
await page.mouse.move(1240, 680);
await page.evaluate(() => window.__tutMove && window.__tutMove(1240, 680, 500));
await sleep(1000);
await rec.hold(-1);
await click(page, page.locator("button:visible, a:visible", { hasText: "Back to your ranking" }).first(), { after: 1000 });

// p3: filters.
rec.para(3);
const filters = page.getByRole("button", { name: /^Filters/ });
await showAt(page, filters, 160, 900);
await click(page, filters, { after: 1200 });
const daysOff = page.getByRole("button", { name: /^1[45]\+$/ }).first();
await click(page, daysOff, { after: 900 });
const noNight = page.getByRole("button", { name: "No night legs" }).or(page.getByRole("checkbox", { name: "No night legs" })).first();
if (await noNight.count()) await click(page, noNight, { after: 900 });
await ring(page, page.getByText(/Showing \d+ of \d+ lines/).first(), 1800);
// The commute filter, switched on, and what it leaves.
const commute = page.getByRole("button", { name: /Only lines I can commute/ }).or(page.getByRole("checkbox", { name: /Only lines I can commute/ })).first();
if (await commute.count()) {
  await showAt(page, commute, 300, 800);
  await click(page, commute, { after: 1200 });
  // The real-flight check takes a while: cut it, then show what it found.
  const status = page.locator("p[role=status]", { hasText: /lines work|Checking flights|isn't available|already flown|Enter the airport/ }).first();
  await rec.pause();
  await page.waitForFunction(() => { const p = [...document.querySelectorAll("p[role=status]")].find((e) => /lines work|isn't available|already flown|Enter the airport/.test(e.textContent)); return !!p; }, null, { timeout: 420000 }).catch(() => {});
  await sleep(600);
  await rec.resume();
  const found = await status.textContent().catch(() => "?");
  console.log("commute status:", found);
  // The flight route allows 20 lookups an hour: a take run too soon after another gets "paused". Don't keep that take.
  if (/paused|^0 lines work/.test(found)) console.log("WARNING: the commute check didn't finish; record ch07 again in an hour.");
  await point(page, status, 700);
  await ring(page, status, 2400);
  const count = page.getByText(/Showing \d+ of \d+ lines/).first();
  if (await count.isVisible().catch(() => false)) await ring(page, count, 1600);
}
await rec.hold(-0.5);
await click(page, page.getByRole("button", { name: "Clear filters" }).first(), { after: 600 });
await click(page, filters, { after: 600 });

// p4: compare two lines.
rec.para(4);
const cards = page.locator("[data-line-id]");
await showAt(page, cards.first(), 110, 900);
await click(page, cards.first().getByRole("button", { name: /^Line \d+, score/ }).first(), { after: 900 });
await click(page, cards.first().getByRole("button", { name: "Compare" }), { after: 900 });
await showAt(page, cards.nth(1), 110, 900);
await click(page, cards.nth(1).getByRole("button", { name: /^Line \d+, score/ }).first(), { after: 900 });
await click(page, cards.nth(1).getByRole("button", { name: "Compare" }), { after: 1800 });
const cmp = page.getByRole("dialog", { name: /Compare lines/ });
await cmp.waitFor({ timeout: 10000 });
await sleep(2500);
await cmp.evaluate((el) => (el.querySelector("[class*=overflow-y-auto]") ?? el).scrollBy({ top: 450, behavior: "smooth" }));
await sleep(2200);
await rec.hold(-1.5);
await page.keyboard.press("Escape");
await sleep(600);

// p5: jump to a line by number.
rec.para(5);
await page.keyboard.press("Meta+k");
await sleep(900);
await page.keyboard.type("2096", { delay: 140 });
await sleep(1500);
await page.keyboard.press("Enter");
await sleep(2500);
await rec.hold(0.3);
await rec.end();
