// Chapter 4, first part: quick start, filmed as a guest so the demo account keeps its full interview.
import { start, sleep, click, type, ring, point, showAt, glide } from "./lib.mjs";
import { PDF, setClock } from "./demo.mjs";

const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const rec = await start("ch04a");
const { page } = rec;
await setClock(page);
// Off camera: load the pack as a guest.
await page.goto(`${BASE}/upload`, { waitUntil: "load" });
const chooser = page.waitForEvent("filechooser");
await page.getByRole("button", { name: "Choose a file" }).click();
await (await chooser).setFiles(PDF);
await page.getByRole("heading", { name: "Does this look right?" }).waitFor({ timeout: 60000 });
await page.getByRole("button", { name: /First Officer/ }).first().click();
await page.getByRole("button", { name: /Looks right/ }).click();
await page.waitForURL(/preferences/);
await sleep(1500);
await rec.begin();

// p1: quick start.
rec.para(1);
await sleep(800);
await click(page, page.getByRole("link", { name: /Quick start/ }).or(page.getByRole("button", { name: /Quick start/ })).first(), { after: 1500 });
await page.getByText("What matters most to you this month?").waitFor({ timeout: 15000 });
await sleep(800);
// The six priorities the owner chose for the demo, tapped in order.
for (const chip of ["Short trips", "Layovers worth having", "Little standby", "Easy to commute", "Protect my sleep", "Fewer legs a day"]) {
  await click(page, page.getByRole("button", { name: chip, exact: true }), { ms: 550, after: 450 });
}
const list = page.getByRole("list").filter({ hasText: "Fewer legs a day" }).last();
if (await list.count()) { await showAt(page, list, 200, 900); await ring(page, list, 1600); }
// Put them in order: drag "Protect my sleep" to the top, then nudge "Easy to commute" up with its arrow.
const item = (name) => list.locator("li").filter({ hasText: name }).first();
const from = await item("Protect my sleep").boundingBox();
const to = await item("Short trips").boundingBox();
await glide(page, from.x + 40, from.y + from.height / 2, 600);
await sleep(300);
await page.evaluate(([x, y]) => window.__tutMove && window.__tutMove(x, y, 900), [to.x + 40, to.y + 4]);
await item("Protect my sleep").dragTo(item("Short trips"), { targetPosition: { x: 40, y: 4 } });
await sleep(1300);
await click(page, page.getByRole("button", { name: "Move Easy to commute up" }), { after: 1200 });
await point(page, page.getByText("Start from a pilot like you"), 800);
await sleep(1200);
const commute = page.getByRole("button", { name: "I commute", exact: true }).or(page.getByRole("radio", { name: "I commute", exact: true })).first();
if (await commute.count()) {
  await showAt(page, commute, 300, 800);
  await click(page, commute, { after: 600 });
  const home = page.getByPlaceholder("e.g. SAN");
  if (await home.count()) await type(page, home, "CLT", { delay: 90 });
}
await rec.hold(-2.5);
const rank = page.getByRole("button", { name: "Rank my lines" });
await showAt(page, rank, 400, 700);
await click(page, rank, { after: 500 });
await rec.pause();
await page.waitForURL(/results/, { timeout: 120000 });
await page.getByText("Quick start.").first().waitFor({ timeout: 60000 });
await page.getByText("Wheels down").first().waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
await sleep(4500);
await page.getByText("Quick start.").first().evaluate((el) => el.scrollIntoView({ block: "center" }));
await sleep(1200);
await rec.resume();
await ring(page, page.getByText("Quick start.").first().locator(".."), 2500);
await rec.end();
