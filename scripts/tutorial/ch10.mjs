// Chapter 10: sending your bid. The dialog is filled in and checked, but "Open VIPS and send" is only pointed at:
// nothing is ever sent to FedEx's site from the recording.
import { start, sleep, click, ring, point, showAt, openResults, glide } from "./lib.mjs";
import { setClock } from "./demo.mjs";
import { at } from "./work.mjs";

const rec = await start("ch10", { storageState: at("state/after-interview.json"), db: "after-interview" });
const { page, context } = rec;
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:3031" });
await setClock(page);
await openResults(page);
const ready = page.getByText("Ready to bid?").first();
await showAt(page, ready, 200, 300);
await rec.begin();

// p1: copy the order.
rec.para(1);
await sleep(1000);
// The button's own words change to say what was copied; ring it while they show.
await click(page, page.getByRole("button", { name: "Copy line order" }), { after: 250 });
await ring(page, page.getByRole("button", { name: /Copied/ }).first(), 2000);
await glide(page, 1240, 660, 600);
await rec.hold(-1.5);

// p2: Send to VIPS — catch-alls and the bid questions.
rec.para(2);
await click(page, page.getByRole("button", { name: "Send to VIPS" }), { after: 1500 });
const dlg = page.getByRole("dialog");
await dlg.waitFor();
await sleep(1500);
const ifNone = dlg.getByText("If none of these are left").first();
await ifNone.scrollIntoViewIfNeeded(); await sleep(600);
for (const n of [/9950/, /9954/]) {
  const cb = dlg.getByRole("checkbox", { name: n }).first();
  if (await cb.count() && !(await cb.isChecked())) await click(page, cb, { ms: 500, after: 400 });
}
const what = dlg.getByRole("button", { name: /What should I answer/ });
await what.scrollIntoViewIfNeeded(); await sleep(500);
await click(page, what, { after: 1500 });
// Answer each question the way the advice says (No where it leaves it to the pilot).
const qs = dlg.getByRole("radiogroup");
for (let i = 0; i < await qs.count(); i++) {
  const q = qs.nth(i);
  const text = await q.evaluate((el) => (el.closest("li, div")?.parentElement?.innerText ?? el.innerText));
  const pick = /We.d say Yes/.test(text) ? "Yes" : "No";
  await q.scrollIntoViewIfNeeded(); await sleep(250);
  await click(page, q.getByRole("radio", { name: pick, exact: true }), { ms: 450, after: 350 });
}
await rec.hold(-0.5);

// p3: the checks before you send.
rec.para(3);
const before = dlg.getByRole("region", { name: "Before you send" }).or(dlg.locator("section[aria-label='Before you send']")).first();
await before.scrollIntoViewIfNeeded(); await sleep(900);
await ring(page, before, 2500);
// Where a check offers a fix, one tap puts it in.
const fix = before.getByRole("button").first();
if (await fix.count()) { console.log("fix:", await fix.textContent()); await click(page, fix, { after: 1500 }); if (await before.count()) await ring(page, before, 1800); }
else console.log("no fix offered");
await rec.hold(-0.5);

// p4: open VIPS and send — FedEx's own site, where you sign in yourself.
rec.para(4);
const send = dlg.getByRole("button", { name: /Open VIPS and send/ });
await send.scrollIntoViewIfNeeded(); await sleep(700);
await point(page, send, 900);
await ring(page, send, 3000);
await rec.hold(0.3);
await page.keyboard.press("Escape");
await sleep(500);
await rec.end();
