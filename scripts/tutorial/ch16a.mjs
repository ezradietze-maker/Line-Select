// Chapter 16, first part (as a guest on the sample pack): the Trade Board (the sample pack's clearly marked example offer), and getting around.
import { start, sleep, ring, showAt } from "./lib.mjs";
import { setClock } from "./demo.mjs";

const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const rec = await start("ch16a");
const { page } = rec;
await setClock(page);
// Off camera: switch to the sample pack, whose board shows an example offer (a real seat's opens at 15 pilots).
await page.goto(`${BASE}/?welcome`, { waitUntil: "load" });
await page.getByRole("button", { name: "Try it with sample data" }).or(page.getByRole("link", { name: "Try it with sample data" })).first().click();
await page.waitForURL(/preferences/, { timeout: 20000 });
await page.goto(`${BASE}/trade-board`, { waitUntil: "load" });
await page.getByRole("heading", { name: "Trade Board" }).waitFor({ timeout: 20000 });
await sleep(3000);
await rec.begin();

// p1: offers, trades found for you, the Inbox.

rec.para(1);
await sleep(1500);
const warn = page.getByText(/This board is not official/).first();
await ring(page, warn.locator(".."), 2200);
const example = page.getByText(/Example — not real/).first();
if (await example.count()) {
  await showAt(page, example, 260, 1200);
  await ring(page, example.locator("xpath=ancestor::*[.//button][1]"), 2500);
}
// Confirming what you hold, which is what lets it suggest trades.
const hold = page.getByText(/what you hold/i).first();
if (await hold.isVisible().catch(() => false)) { await showAt(page, hold, 240, 1100); await ring(page, hold.locator(".."), 2200); }
await rec.hold(-0.3);
await rec.end();

