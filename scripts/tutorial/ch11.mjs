// Chapter 11: Strategies.
import { start, sleep, click, ring, point, showAt, scrollBy } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const rec = await start("ch11", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await page.goto(`${BASE}/strategies`, { waitUntil: "load" });
await page.getByText("Your real place").waitFor({ timeout: 30000 });
await sleep(2500);
await rec.begin();

// p1: your real place.
rec.para(1);
await sleep(1500);
await ring(page, page.getByText("On the printed list").locator(".."), 2000);
await ring(page, page.getByText("Your real place").locator(".."), 2600);
await ring(page, page.getByText(/your place lands on/).first(), 2600);
await rec.hold(-0.5);

// p2: a move that fits you, with its lines.
rec.para(2);
const picker = page.getByLabel("Pick a strategy to see");
await showAt(page, picker, 160, 1000);
await point(page, picker, 700);
// Matched by its start: the count after it ("(6 lines)") depends on the pilot's seniority.
const leftBehind = (await picker.locator("option").allTextContents()).find((o) => o.startsWith("Bid the lines senior pilots leave behind"));
await picker.selectOption({ label: leftBehind });
await sleep(1500);
await scrollBy(page, 260, 1200);
const move = page.getByText("Your move").first();
if (await move.count()) { await showAt(page, move, 200, 1000); await ring(page, move.locator(".."), 2500); }
const likely = page.getByText(/Likely open|Maybe open|Long shot/).first();
if (await likely.count()) { await showAt(page, likely, 300, 900); await ring(page, likely.locator("../.."), 2200); }
await rec.hold(-0.5);

// p3: the vacation slide finder.
rec.para(3);
await showAt(page, picker, 160, 900);
await picker.selectOption({ index: 0 });
await sleep(1200);
const firstDay = page.getByLabel("First vacation day");
if (await firstDay.count()) {
  await showAt(page, firstDay, 300, 800);
  await click(page, firstDay, { after: 200 });
  await firstDay.fill("2026-10-03");
  await click(page, page.getByRole("button", { name: "Add a vacation" }), { after: 900 });
}
await click(page, page.getByRole("button", { name: "Find my best slide" }), { after: 500 });
await page.getByText(/Looking at every slide/).waitFor({ state: "detached", timeout: 60000 }).catch(() => {});
await sleep(1200);
const slider = page.getByRole("slider").first();
if (await slider.count()) {
  await showAt(page, slider, 420, 1000);
  await point(page, slider, 700);
  await slider.focus();
  for (let i = 0; i < 3; i++) { await page.keyboard.press("ArrowRight"); await sleep(600); }
  await sleep(800);
  for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowLeft"); await sleep(600); }
}
await rec.hold(-0.5);

// p4: what pilots near you held.
rec.para(4);
const held = page.getByText("What pilots near you actually held");
await showAt(page, held, 150, 1200);
await ring(page, held.locator(".."), 3000);
await rec.hold(-0.3);

// p5: not FedEx's rules — check with your bid rep.
rec.para(5);
const notam = page.getByText(/Not FedEx.s rules, and not a sure thing/).first();
await showAt(page, notam, 250, 1200);
await ring(page, notam.locator(".."), 3000);
await rec.hold(0.3);
await rec.end();
