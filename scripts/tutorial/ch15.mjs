// Chapter 15: Ask the Contract.
import { start, sleep, click, ring, point, showAt, scrollBy, type } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const rec = await start("ch15", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await page.goto(`${BASE}/contract`, { waitUntil: "load" });
await page.getByRole("heading", { name: "Ask the contract" }).waitFor({ timeout: 30000 });
await sleep(2000);
await rec.begin();
const done = () => page.getByRole("button", { name: /Show working/ }).last().waitFor({ timeout: 120000 });

// p1: ask; watch it search, read and check; the answer with its quote.
rec.para(1);
await sleep(1200);
await click(page, page.getByRole("button", { name: /minimum domestic rest/ }), { after: 4500 });
await rec.pause();
await done();
await sleep(1500);
await rec.resume();
const quote = page.getByText(/p\. \d+/).first();
if (await quote.count()) { await showAt(page, quote, 300, 1200); await ring(page, quote.locator("../.."), 2500); }
await rec.hold(-0.5);

// p2: name a line, and it brings in your pack.
rec.para(2);
const box = page.getByPlaceholder(/Ask a follow-up|Ask about the contract/);
await type(page, box, "How many days off does line 2160 have, and is that enough under the contract?", { delay: 22 });
await page.keyboard.press("Enter");
await sleep(3500);
await rec.pause();
await done().catch(() => {});
await page.waitForFunction(() => document.querySelectorAll("button").length && [...document.querySelectorAll("button")].filter((b) => /Show working/.test(b.textContent)).length >= 2, null, { timeout: 120000 }).catch(() => {});
await sleep(1500);
await rec.resume();
await scrollBy(page, 400, 1500);
await rec.hold(-0.3);

// p3: what it covers; ALPA and the contract are the authority.
rec.para(3);
const foot = page.getByText(/ALPA and the contract itself are the authority/).first();
await point(page, foot, 900);
await ring(page, foot, 3000);
await rec.hold(0.3);
await rec.end();
