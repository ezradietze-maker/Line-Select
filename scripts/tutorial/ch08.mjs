// Chapter 8: putting your order right — swap by dragging, what it learns, tiers, selecting, set aside, undo.
import { start, sleep, click, ring, point, glide, showAt, openResults } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const rec = await start("ch08", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await openResults(page);
const cards = page.locator("[data-line-id]");
await showAt(page, cards.first(), 110, 300);
await rec.begin();

async function drag(fromCard, toCard) {
  const grip = fromCard.getByRole("button", { name: /^Drag line/ });
  const g = await grip.boundingBox();
  await glide(page, g.x + g.width / 2, g.y + g.height / 2, 700);
  await sleep(250);
  await page.mouse.down();
  const t = await toCard.boundingBox();
  const tx = t.x + t.width * 0.35, ty = t.y + t.height / 2;
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    const x = g.x + (tx - g.x) * (i / steps), y = g.y + (ty - g.y) * (i / steps);
    await page.mouse.move(x, y);
    await page.evaluate(([x, y]) => window.__tutMove && window.__tutMove(x, y, 30), [x, y]);
    await sleep(35);
  }
  await sleep(400);
  await page.mouse.up();
}

// p1: drag a line onto another; they swap and stay.
rec.para(1);
await sleep(1200);
await drag(cards.nth(2), cards.nth(1));
await sleep(2500);
await rec.hold(-0.5);

// p2: what the swap taught it; it may ask why.
rec.para(2);
const banner = page.getByText(/Swapped \d+ and \d+/).first();
if (await banner.count()) { await showAt(page, banner, 200, 900); await ring(page, banner.locator(".."), 3000); }
const q = page.getByText(/Why does line \d+ beat \d+ for you\?/).first();
if (await q.isVisible().catch(() => false)) {
  await showAt(page, q, 200, 900);
  await sleep(1500);
  const chip = q.locator("xpath=ancestor::*[.//button][1]").getByRole("button").first();
  await click(page, chip, { after: 1500 });
} else {
  await sleep(2500);
}
await rec.hold(-0.5);

// p3: tiers — on an open line, by number key, and for a whole run with the right-click menu.
rec.para(3);
await showAt(page, cards.first(), 110, 900);
await click(page, cards.first().getByRole("button", { name: /^Line \d+, score/ }).first(), { after: 900 });
await click(page, cards.first().getByRole("button", { name: "Best", exact: true }), { after: 1200 });
await click(page, cards.first().getByRole("button", { name: /^Line \d+, score/ }).first(), { after: 900 });
await showAt(page, cards.nth(3), 160, 900);
await point(page, cards.nth(3), 500);
await page.keyboard.down("Shift");
await click(page, cards.nth(3).getByRole("button", { name: /^Line \d+, score/ }).first(), { after: 300 });
await click(page, cards.nth(5).getByRole("button", { name: /^Line \d+, score/ }).first(), { after: 900 });
await page.keyboard.up("Shift");
const b5 = await cards.nth(5).boundingBox();
await glide(page, b5.x + b5.width * 0.3, b5.y + b5.height / 2, 500);
await page.mouse.click(b5.x + b5.width * 0.3, b5.y + b5.height / 2, { button: "right" });
await sleep(1200);
const menu = page.getByRole("menu");
await click(page, menu.getByRole("menuitem", { name: /Good/ }).first(), { after: 1500 });
await rec.hold(-0.5);

// p4: set aside, and undo.
rec.para(4);
await showAt(page, cards.nth(6), 260, 900);
const b6 = await cards.nth(6).boundingBox();
await glide(page, b6.x + b6.width * 0.3, b6.y + b6.height / 2, 600);
await page.mouse.click(b6.x + b6.width * 0.3, b6.y + b6.height / 2, { button: "right" });
await sleep(1000);
await click(page, page.getByRole("menu").getByRole("menuitem", { name: /Set aside/ }).first(), { after: 1500 });
const undo = page.getByRole("button", { name: "Undo", exact: true }).first();
await showAt(page, undo, 200, 900);
await click(page, undo, { after: 1600 });
await rec.hold(0.3);
await rec.end();
