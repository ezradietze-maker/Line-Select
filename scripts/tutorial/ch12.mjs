// Chapter 12: Cities and Hotel Ratings.
import { start, sleep, click, ring, point, showAt, scrollBy } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const rec = await start("ch12", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await page.goto(`${BASE}/cities`, { waitUntil: "load" });
await page.getByRole("heading", { name: "Layover cities" }).waitFor({ timeout: 30000 });
await sleep(3500);
await rec.begin();

// p1: every layover city; one opened.
rec.para(1);
await sleep(1500);
const cardBtn = page.locator("main button").filter({ hasText: /\d+ lines · \d+ trips/ });
await point(page, cardBtn.nth(0), 800);
await point(page, cardBtn.nth(1), 600);
await point(page, cardBtn.nth(2), 600);
await sleep(800);
// Los Angeles: a city the demo pilot rated in the interview, so "Your take" has something to show.
const lax = cardBtn.filter({ hasText: "LAX" }).first();
await click(page, (await lax.count()) ? lax : cardBtn.nth(1), { after: 2500 });
const dlg = page.getByRole("dialog");
await dlg.waitFor({ timeout: 10000 });
await sleep(1500);
const scroll = async (dy) => { await dlg.evaluate((el, dy) => { const s = [el, ...el.querySelectorAll("*")].find((n) => n.scrollHeight > n.clientHeight + 20 && getComputedStyle(n).overflowY !== "visible"); (s ?? el).scrollBy({ top: dy, behavior: "smooth" }); }, dy); await sleep(1400); };
for (let i = 0; i < 3; i++) { await scroll(300); await sleep(900); }
const take = dlg.getByText("Your take", { exact: true }).locator("..");
await take.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" }));
await sleep(1100);
await ring(page, take, 2400);
await rec.hold(-0.8);
await page.keyboard.press("Escape");
await sleep(500);

// p2: Hotel Ratings.
// The hotel lookups take a while the first time: wait them out off camera.
await rec.pause();
await page.goto(`${BASE}/hotel-ratings`, { waitUntil: "load" });
await page.getByText(/\d+ rated/).first().waitFor({ timeout: 180000 });
await page.getByRole("button", { name: /What.s nearby & what reviewers say/ }).first().waitFor({ timeout: 60000 });
await sleep(2500);
await rec.resume();
rec.para(2);
await sleep(1500);
const more = page.getByRole("button", { name: /What.s nearby & what reviewers say/ }).first();
await showAt(page, more, 380, 1200);
await ring(page, more.locator("xpath=ancestor::li[1]").or(more.locator("../..")).first(), 2000);
await click(page, more, { after: 4000 });
await scrollBy(page, 330, 1500);
await sleep(1800);
await scrollBy(page, 300, 1500);
await rec.hold(0.3);
await rec.end();
