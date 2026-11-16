// Chapter 16, second part: the Inbox and the menu, Night mode, What's new, feedback, and the close.
import { start, sleep, click, ring, point } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const rec = await start("ch16b", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
await setClock(page);
await page.goto(`${BASE}/inbox`, { waitUntil: "load" });
await page.getByRole("heading", { name: "Inbox" }).waitFor({ timeout: 20000 });
await sleep(2500);
await rec.begin();

// p2: the Inbox, then: the board opens for your seat once enough pilots use it.
rec.para(2);
await sleep(600);
await ring(page, page.getByRole("heading", { name: "Inbox" }).locator(".."), 2600);
await point(page, page.locator("a:visible, button:visible", { hasText: "Trade Board" }).first(), 900);
await ring(page, page.locator("[role=group]:visible", { hasText: "Hotel Ratings" }).first(), 2500);
await rec.hold(-0.3);

// p3: Night mode, What's new, Send feedback.
rec.para(3);
const look = page.getByRole("button", { name: "Appearance" }).first();
await click(page, look, { after: 900 });
await click(page, page.getByRole("radiogroup", { name: "Color theme" }).getByRole("radio", { name: /Light/ }), { after: 2600 });
await click(page, page.getByRole("radiogroup", { name: "Color theme" }).getByRole("radio", { name: /Night/ }), { after: 2600 });
await click(page, page.getByRole("radiogroup", { name: "Color theme" }).getByRole("radio", { name: /Dark/ }), { after: 800 });
await page.keyboard.press("Escape");
await sleep(500);
await click(page, page.getByRole("link", { name: /What.s new/ }).or(page.getByRole("button", { name: /What.s new/ })).first(), { after: 2200 });
await click(page, page.getByRole("button", { name: "Send feedback" }).first(), { after: 2200 });
await rec.hold(-0.6);
await page.keyboard.press("Escape");
await sleep(400);

// p4: the close.
rec.para(4);
await page.goto(`${BASE}/?welcome`, { waitUntil: "load" });
await sleep(1500);
await point(page, page.locator("h1"), 1000);
await rec.hold(0.8);
await rec.end();
