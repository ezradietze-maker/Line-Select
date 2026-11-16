// Chapter 9: this month's bid — deadline and checklist, carry-in, vacation, your chances.
import { start, sleep, click, type, ring, point, showAt, openResults } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const rec = await start("ch09", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await openResults(page);
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(600);
await rec.begin();

// p1: the countdown and the checklist.
rec.para(1);
await sleep(1000);
const closes = page.getByText("Bid closes", { exact: true }).first();
await ring(page, closes.locator(".."), 2600);
await point(page, page.getByRole("button", { name: "Remind me in my calendar" }), 800);
await ring(page, page.getByRole("button", { name: "Remind me in my calendar" }), 1600);
// The checklist, shown, not ticked: nothing's been bid yet at this point in the tutorial.
await ring(page, page.getByText(/^This month.s bid$/).first().locator(".."), 2600);
await rec.hold(-0.3);

// p2: carry-in.
rec.para(2);
const carry = page.getByText("Carry-in from last month").first();
await showAt(page, carry, 120, 1000);
await click(page, page.getByRole("button", { name: "Add", exact: true }).first(), { after: 1200 });
const addTrip = page.getByRole("button", { name: "Add a trip" });
await click(page, addTrip, { after: 1000 });
// A made-up September trip that runs three days into October.
const form = page.locator("form", { hasText: "domicile local" }).first();
await type(page, form.getByLabel("Credit hours"), "16.5", { delay: 60, after: 300 });
await click(page, form.getByLabel("Report"), { after: 200 });
await form.getByLabel("Report").fill("2026-09-30T20:00");
await sleep(500);
await click(page, form.getByLabel("Release"), { after: 200 });
await form.getByLabel("Release").fill("2026-10-03T09:00");
await sleep(500);
await click(page, form.getByRole("button", { name: "Add trip" }), { after: 1500 });
const added = page.locator("section[aria-label='Carry-in from last month'] li").first();
if (await added.count()) await ring(page, added, 2000);
const answering = page.getByText("How you're answering on your bid").or(page.getByText("How you’re answering on your bid")).first();
await showAt(page, answering, 200, 900);
await ring(page, answering.locator(".."), 2400);
await rec.hold(-1.2);
// Closed, it says what the trip costs your top lines.
const carryPanel = page.locator("section[aria-label='Carry-in from last month']");
await click(page, carryPanel.getByRole("button", { name: "Close", exact: true }), { after: 800 }).catch(() => {});
const lose = carryPanel.getByText(/of your top \d+ lines lose a trip/);
if (await lose.count()) { await showAt(page, carryPanel, 160, 700); await ring(page, lose, 1800); }

// p3: vacation.
rec.para(3);
const vac = page.getByText("Your vacation", { exact: true }).first();
await showAt(page, vac, 120, 1100);
await point(page, page.getByRole("radio", { name: /Use it\./ }), 700);
await sleep(900);
await point(page, page.getByRole("radio", { name: /Keep my flying\./ }), 700);
await ring(page, page.getByRole("radio", { name: /Keep my flying\./ }).locator(".."), 2200);
await rec.hold(-0.3);

// p4: your chances.
rec.para(4);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await sleep(1000);
const chances = page.getByRole("button", { name: /Your chances/ }).first();
await click(page, chances, { after: 1500 });
await sleep(1200);
const realistic = page.getByRole("button", { name: /Show only lines I could realistically hold/ });
await showAt(page, realistic, 300, 900);
await click(page, realistic, { after: 1500 });
// The Realistic list itself, then the odds on its top line.
const first = page.locator("[data-line-id]").first();
await showAt(page, first, 110, 1200);
await sleep(1200);
await click(page, first.getByRole("button", { name: /^Line \d+, score/ }).first(), { after: 1200 });
const chip = first.getByText(/% open/).first();
await ring(page, chip, 2400);
await rec.hold(0.3);
await rec.end();
