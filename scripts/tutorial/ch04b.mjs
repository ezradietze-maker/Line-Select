// Chapter 4, second part: the demo account's preferences page.
import { start, sleep, click, type, ring, point, showAt } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const rec = await start("ch04b", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await page.goto(`${BASE}/preferences`, { waitUntil: "load" });
await page.getByText("Your priorities").first().waitFor({ timeout: 20000 });
await sleep(1200);
await rec.begin();

// p2: each priority, what you said, how much it counts.
rec.para(2);
const pr = page.getByText("Your priorities").first();
await showAt(page, pr, 100, 1400);
const second = page.getByRole("button", { name: "High", exact: true }).nth(1);
await showAt(page, second, 380, 900);
await ring(page, page.getByText(/You said:/).nth(1), 1800);
await click(page, second, { after: 1500 });
const dm = page.getByRole("button", { name: /Doesn.t matter/ }).nth(3);
await showAt(page, dm, 380, 900);
await click(page, dm, { after: 1500 });
const back = page.getByRole("button", { name: "Put it back" }).first();
if (await back.count()) await click(page, back, { after: 1000 });
await rec.hold(-0.5);

// p3: tell us something new.
rec.para(3);
const box = page.getByPlaceholder(/Something we missed/);
await showAt(page, box, 260, 1200);
await type(page, box, "My daughter's birthday is October 14th, and I need that day off.", { delay: 26 });
await click(page, page.getByRole("button", { name: "Add it" }), { after: 1200 });
await rec.pause();
await page.getByText(/Reading it into your priorities/).waitFor({ state: "detached", timeout: 90000 }).catch(() => {});
await sleep(1500);
await rec.resume();
await showAt(page, pr, 100, 1200);
await sleep(1500);
await rec.hold(-0.3);

// p4: next month.
rec.para(4);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await sleep(1000);
await point(page, page.locator("nav").getByText("Upload Bid Pack").first(), 900);
await ring(page, page.locator("nav").getByText("Upload Bid Pack").first(), 1800);
await point(page, page.getByRole("button", { name: "Retake the interview" }), 900);
await rec.hold(0.3);
await rec.end();
