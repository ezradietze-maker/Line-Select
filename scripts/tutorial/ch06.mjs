// Chapter 6: inside a line — trips, the rest plan, the body clock, the score breakdown, the route.
import { start, sleep, click, ring, showAt, openResults, scrollBy } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const rec = await start("ch06", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await openResults(page);
const first = page.locator("[data-line-id]").first();
await sleep(5000); // let the ranking settle before opening the top line
await first.getByRole("button", { name: /^Line \d+, score/ }).first().click();
await sleep(800);
await showAt(page, first, 110, 300);
await rec.begin();

// p1: trip details, trip by trip, a day opened.
console.log('p1', new Date().toISOString().slice(11,19));
rec.para(1);
await sleep(1000);
await click(page, first.getByRole("button", { name: "Trip details" }), { after: 1200 });
await showAt(page, first.getByText("Report", { exact: true }).first(), 170, 1400);
await ring(page, first.getByText("Report", { exact: true }).first().locator("../.."), 2400);
const dayBtn = first.getByRole("button", { name: /^Tue \d+ — show everything on this day/ }).first();
await click(page, dayBtn, { after: 1500 });
await sleep(1500);
await scrollBy(page, 260, 1200);
await rec.hold(-0.5);

// p2: each trip's own score.
console.log('p2', new Date().toISOString().slice(11,19));
rec.para(2);
const ts = first.getByRole("button", { name: /Trip score for you/ }).first();
await showAt(page, ts, 260, 1200);
await click(page, ts, { after: 1500 });
await sleep(1500);
await rec.hold(-0.5);

// p3: the rest plan.
console.log('p3', new Date().toISOString().slice(11,19));
rec.para(3);
const rest = first.getByText("Rest plan").first();
await showAt(page, rest, 120, 1400);
await ring(page, first.getByText(/Good rest|Short rest|Poor rest/).first().locator("../.."), 3000);
await rec.hold(-0.5);

// p4: the body-clock score and its reasons.
console.log('p4', new Date().toISOString().slice(11,19));
rec.para(4);
const bc = first.getByRole("button", { name: /Body clock\s*\d+/ }).nth(1);
await showAt(page, bc, 200, 1200);
await click(page, bc, { after: 1800 });
await sleep(1500);
await rec.hold(-0.5);

// p5: why it scored what it did, and where it goes.
console.log('p5', new Date().toISOString().slice(11,19));
rec.para(5);
const sb = first.getByRole("tab", { name: "Score Breakdown" }).or(first.getByRole("button", { name: "Score Breakdown" })).first();
await showAt(page, sb, 160, 1000);
await click(page, sb, { after: 1500 });
await ring(page, first.getByText(/What.s working/).first().locator(".."), 2500);
const route = first.getByRole("tab", { name: "Route" }).or(first.getByRole("button", { name: "Route" })).first();
await showAt(page, route, 160, 800);
await click(page, route, { after: 2500 });
await rec.hold(0.3);
await rec.end();
