// Chapter 2: signing in and loading your bid pack.
import { start, sleep, click, type, ring, point, show, glide } from "./lib.mjs";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PDF, ACCOUNT, setClock } from "./demo.mjs";
import { at } from "./work.mjs";

// A brand-new database: the demo account is created here, on camera.
execFileSync("node", [new URL("./dbctl.mjs", import.meta.url).pathname, "fresh"], { stdio: "inherit" });
const rec = await start("ch02");
const { page, context } = rec;
await setClock(page);
await page.goto(`${process.env.TUT_BASE ?? "http://localhost:3031"}/auth`, { waitUntil: "networkidle" });
await rec.begin();

// p1: create an account, save the recovery code.
rec.para(1);
await click(page, page.getByRole("tab", { name: "Create account" }).or(page.getByRole("button", { name: "Create account", exact: true })).first());
await type(page, page.getByLabel("Display name"), ACCOUNT.name, { delay: 45 });
await type(page, page.getByLabel("Email"), ACCOUNT.email, { delay: 30 });
await type(page, page.getByLabel("Password", { exact: true }), ACCOUNT.password, { delay: 30 });
await type(page, page.getByLabel("Confirm password"), ACCOUNT.password, { delay: 20 });
await click(page, page.getByRole("checkbox"));
await click(page, page.locator("form").getByRole("button", { name: "Create account" }), { after: 1500 });
const code = page.getByText("Save your recovery code");
await code.waitFor({ timeout: 15000 });
execFileSync("node", [new URL("./db.mjs", import.meta.url).pathname, "confirm"]);
await sleep(800);
await point(page, page.getByRole("button", { name: /Copy code/ }));
await ring(page, page.getByRole("button", { name: /Copy code/ }), 1200);
await click(page, page.getByRole("checkbox", { name: /saved this/ }));
await rec.hold(-1.5);
await click(page, page.getByRole("button", { name: "Continue to Line Select" }), { after: 300 });
// The account is confirmed in the local database: a reload, cut from the video, picks that up.
await rec.pause();
await page.getByRole("heading", { name: "Load your bid pack" }).waitFor({ timeout: 15000 });
await page.reload({ waitUntil: "networkidle" });
await rec.resume();

// p2: load the pack.
rec.para(2);
await page.getByRole("heading", { name: "Load your bid pack" }).waitFor({ timeout: 15000 });
await sleep(1200);
await point(page, page.getByText("Drop your bid pack PDF here"), 900);
await sleep(1200);
const chooser = page.waitForEvent("filechooser");
await click(page, page.getByRole("button", { name: "Choose a file" }), { after: 300 });
await (await chooser).setFiles(PDF);
await glide(page, 1300, 700, 900);
await page.getByRole("heading", { name: "Does this look right?" }).waitFor({ timeout: 60000 });
await rec.hold(0);

// p3: check what it found, pick the seat, continue.
rec.para(3);
await sleep(1200);
const fo = page.getByRole("button", { name: /First Officer/ }).or(page.getByRole("radio", { name: /First Officer/ })).first();
if (await fo.count()) {
  await show(page, fo);
  await click(page, fo, { after: 900 });
}
// The stats, ringed as they're named: lines, credit, days off.
const stats = page.locator(".panel-glass .grid").last().locator(":scope > *");
await show(page, stats.first(), { block: "center" });
for (let i = 0; i < 3; i++) { await point(page, stats.nth(i), 500); await ring(page, stats.nth(i), 1100); }
await rec.hold(-1.5);
await click(page, page.getByRole("button", { name: /Looks right/ }), { after: 1800 });
await page.waitForURL(/preferences/, { timeout: 20000 });
mkdirSync(at("state"), { recursive: true });
await context.storageState({ path: at("state/after-upload.json") });
await rec.hold(0.3);

// p4: the sample pack, from the home page, as a guest: signed in, the sample would be saved over the account's pack.
// The account's cookies are already in after-upload.json; the switch to a guest is cut from the video.
await rec.pause();
await context.clearCookies();
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.evaluate(() => new Promise((r) => { const q = indexedDB.databases ? indexedDB.databases() : Promise.resolve([]); q.then((dbs) => Promise.all(dbs.map((d) => new Promise((ok) => { const x = indexedDB.deleteDatabase(d.name); x.onsuccess = x.onerror = x.onblocked = ok; })))).then(r); }));
await page.goto(`${process.env.TUT_BASE ?? "http://localhost:3031"}/?welcome`, { waitUntil: "networkidle" });
await sleep(800);
await rec.resume();
rec.para(4);
const sample = page.getByRole("button", { name: "Try it with sample data" }).or(page.getByRole("link", { name: "Try it with sample data" })).first();
await point(page, sample, 900);
await ring(page, sample, 1500);
await click(page, sample, { after: 600 });
await page.waitForURL((u) => !u.pathname.match(/^\/?$/), { timeout: 20000 });
await sleep(1500);
// The pack badge says SAMPLE.
const marked = page.getByText("SAMPLE", { exact: true }).first();
if (await marked.isVisible().catch(() => false)) { await point(page, marked, 700); await ring(page, marked.locator(".."), 2000); }
await rec.hold(0.4);
await rec.end();

