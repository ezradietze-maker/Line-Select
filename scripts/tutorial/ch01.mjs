// Chapter 1: what Line Select does. The home page, then the finished rankings and the menu.
import { start, sleep, ring, point, show, showAt } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const rec = await start("ch01", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await page.goto(`${BASE}/?welcome`, { waitUntil: "networkidle" });
await rec.begin();

// p1: the promise, on the home page.
rec.para(1);
await sleep(2500);
await point(page, page.locator("h1"), 1200);
await sleep(1500);
await ring(page, page.locator("h1 + p, h1 ~ p").first(), 3000);
await rec.hold(-0.5);

// p2: the four steps.
rec.para(2);
const steps = page.getByText("From a 260-page PDF to the line that fits you.");
await show(page, steps, { block: "start", wait: 1500 });
const per = Math.max(2500, (rec.len() * 1000 - 3000) / 4);
for (const s of ["01 · Load", "02 · Brief", "03 · Rank", "04 · Check"]) {
  const el = page.getByText(s, { exact: false }).first();
  await show(page, el, { block: "center", wait: 500 });
  await point(page, el, 600);
  await sleep(per - 1100);
}
await rec.hold(0);

// p3: independent, and what the score is.
rec.para(3);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await sleep(1400);
const pill = page.getByText("Independent prototype · not affiliated with FedEx");
await point(page, pill, 800);
await ring(page, pill, 3500);
await rec.hold(0);

// p4: the rest of the video, one part of the site per chapter.
rec.para(4);
// After the long visit to the home page, the faked clock leaves the list's fade-in stuck at invisible: with reduced
// motion the lines are simply drawn.
await page.emulateMedia({ reducedMotion: "reduce" });
await page.goto(`${BASE}/results`, { waitUntil: "load" });
await page.keyboard.press("Escape").catch(() => {});
await page.locator("[data-line-id]").first().waitFor({ timeout: 30000 });
await sleep(800);
// The ranked list itself, best match first, before the tour of the menu.
await showAt(page, page.locator("[data-line-id]").first(), 120, 1400);
await sleep(1200);
const nav = page.locator("nav").first();
for (const label of ["Upload Bid Pack", "Preferences", "My Rankings", "Strategies", "Cities", "Logbook", "Tools", "Pay check", "Ask the Contract", "Trade Board", "Hotel Ratings"]) {
  const item = nav.getByText(label, { exact: true }).first();
  if (await item.count()) await point(page, item, 380);
}
await rec.hold(0.5);
await rec.end();
