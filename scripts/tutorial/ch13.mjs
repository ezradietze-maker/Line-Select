// Chapter 13: Logbook and the calendar link.
import { start, sleep, click, ring, point, showAt } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const rec = await start("ch13", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page } = rec;
// Late October: the award is out and the month is nearly flown, so logging it and saying how it flew both make sense.
await setClock(page, new Date("2026-10-27T15:00:00Z"));
// The calendar link is private (anyone with it sees the trips): blurred on screen.
await page.addInitScript(() => {
  const css = 'input[aria-label="Your calendar link"]{filter:blur(6px)!important}';
  const add = () => { const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); };
  if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
});
await page.goto(`${BASE}/logbook`, { waitUntil: "load" });
await page.getByRole("heading", { name: "Logbook" }).waitFor({ timeout: 30000 });
await sleep(2500);
// Off camera: clear what an earlier take logged, so the month can be logged again.
for (let i = 0; i < 3; i++) {
  const del = page.getByRole("button", { name: "Delete", exact: true }).first();
  if (!(await del.count())) break;
  await del.click(); await sleep(500);
  await page.getByRole("button", { name: "Yes, delete" }).click(); await sleep(1200);
}
const wd = page.getByRole("button", { name: "Withdraw all my shares" });
if (await wd.count()) { await wd.click(); await sleep(400); await page.getByRole("button", { name: "Yes, withdraw" }).click().catch(() => {}); await sleep(1000); }
const subOpen = page.getByRole("button", { name: "Subscribe in your calendar" });
if (await subOpen.count()) {
  await subOpen.click(); await sleep(800);
  const off = page.getByRole("button", { name: "Turn off" });
  if (await off.count()) { await off.click(); await sleep(400); await page.getByRole("button", { name: "Yes, turn off" }).click(); await sleep(1200); }
  await page.getByRole("button", { name: "Hide calendar link" }).click().catch(() => {});
}
await page.reload({ waitUntil: "load" });
await page.getByRole("heading", { name: "Logbook" }).waitFor({ timeout: 30000 });
await sleep(2500);
await rec.begin();

// p1: log the award, then how it flew.
rec.para(1);
await sleep(1200);
const regular = page.getByRole("radio", { name: "A regular line" }).or(page.getByRole("button", { name: "A regular line" })).first();
await showAt(page, regular, 260, 900);
await click(page, regular, { after: 800 });
const which = page.getByLabel("Which line?");
await point(page, which, 700);
const opts = await which.locator("option").allTextContents();
await which.selectOption({ index: opts.length > 2 ? 2 : 1 });
await sleep(1200);
await rec.hold(-1);
const share = page.getByRole("checkbox", { name: /Share it with other pilots/ });

// p2: sharing, optional and anonymous.
rec.para(2);
await showAt(page, share, 300, 800);
await click(page, share, { after: 1200 });
await ring(page, share.locator("../.."), 3000);
await click(page, page.getByRole("button", { name: "Log it" }), { after: 2200 });
const fly = page.getByRole("button", { name: /How did it fly\?/ }).first();
if (await fly.count()) {
  await showAt(page, fly, 300, 900);
  await click(page, fly, { after: 1000 });
  await click(page, page.getByRole("radio", { name: "Better than I expected" }).or(page.getByRole("button", { name: "Better than I expected" })).first(), { after: 800 });
  await click(page, page.getByRole("button", { name: "Save" }).first(), { after: 1500 });
}
await rec.hold(-0.5);

// p3: the calendar link.
rec.para(3);
const sub = page.getByRole("button", { name: "Subscribe in your calendar" });
await showAt(page, sub, 220, 900);
await click(page, sub, { after: 1200 });
await click(page, page.getByRole("button", { name: "Make my link" }), { after: 2200 });
const apple = page.getByRole("link", { name: "Apple Calendar" }).or(page.getByRole("button", { name: "Apple Calendar" })).first();
if (await apple.count()) { await showAt(page, apple, 300, 900); await ring(page, apple.locator(".."), 3000); }
await rec.hold(0.3);
await rec.end();
