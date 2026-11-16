// Chapter 5: reading your rankings.
import { start, sleep, click, ring, point, showAt, openResults, pointIn } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const rec = await start("ch05", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await openResults(page);
await rec.begin();
const cards = page.locator("[data-line-id]");
const first = cards.first();

// p1: the list, best match first; the score.
rec.para(1);
await sleep(1500);
await point(page, page.getByRole("heading", { name: "Your ranked lines" }), 800);
await sleep(1500);
await showAt(page, first, 110, 1600);
await point(page, first.getByText(/^\d+$/).first(), 900);
await ring(page, first.getByText(/^\d+$/).first(), 2200);
for (const i of [1, 2, 3]) await point(page, cards.nth(i).getByText(/^\d+$/).first(), 500);
// The yellow sign on the top line.
const sign = first.getByText("Top pick", { exact: true });
if (await sign.count()) { await point(page, sign, 700); await ring(page, sign, 1600); }
await rec.hold(-0.5);

// p2: two ways to read a line.
rec.para(2);
const bidPack = page.getByRole("radio", { name: "Bid pack" });
await showAt(page, page.getByRole("radiogroup", { name: "How lines are shown" }), 120, 1200);
await click(page, bidPack, { after: 1800 });
await pointIn(page, first, 0.62, 0.5, 900);
await sleep(2500);
await click(page, page.getByRole("radio", { name: "Timeline" }), { after: 1500 });
await pointIn(page, first, 0.62, 0.5, 900);
await sleep(1500);
await rec.hold(-0.5);

// p3: open a line, its features, its month, a day.
rec.para(3);
await click(page, first.getByRole("button", { name: /^Line \d+, score/ }).first(), { after: 1200 });
await showAt(page, first.getByText("Top pick"), 120, 1200);
await ring(page, first.getByRole("list", { name: "This line's best features for you" }), 2200);
await showAt(page, first.getByText(/calendar days · times/), 70, 1400);
await sleep(800);
const day = first.getByRole("button", { name: /— trip \d+, day 2 of/ }).first();
await click(page, day, { after: 1500 });
await sleep(1200);
const panel = first.getByText(/Trip #\d+, day 2 of/);
if (await panel.count()) { await showAt(page, panel, 300, 1000); await ring(page, panel.locator(".."), 2500); }
await rec.hold(-0.5);

// p4: shortlist and hide.
rec.para(4);
await showAt(page, first, 110, 1200);
const star = first.getByRole("button", { name: "Add to shortlist" });
await click(page, star, { after: 1400 });
// Hide a line further down, so the top of the list stays as it was: it drops out of the list.
const lower = cards.nth(3);
await showAt(page, lower, 200, 1000);
// The ✕ is on an opened line.
await click(page, lower.getByRole("button", { name: /^Line \d+, score/ }).first(), { after: 900 });
await click(page, lower.getByRole("button", { name: "Hide this line" }), { after: 1800 });
await rec.hold(0.3);
await rec.end();
