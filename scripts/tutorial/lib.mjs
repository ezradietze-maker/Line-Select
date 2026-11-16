// Recording harness for the tutorial video: a headless Chromium at 1920x1080, a drawn cursor that glides to what it
// clicks, a highlight ring, and a frame-accurate screencast saved as timed JPEG frames. Marks record when each
// narration paragraph starts, so the voice can be laid on later at exactly those moments.
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { chapters } from "./narration.mjs";
import { at, load } from "./work.mjs";

const { chromium } = load("playwright-core");

export const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
const W = 1280, H = 720, DPR = 1.5; // 1920x1080 frames

const CURSOR_JS = `
(() => {
  if (window.__tut) return;
  window.__tut = true;
  const add = () => {
    if (!document.body) return requestAnimationFrame(add);
    const c = document.createElement('div');
    c.id = '__tutc';
    c.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.6 14.8 L10.6 21.5 L13.4 20.3 L10.4 13.7 L16.6 13.7 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    let p = {x: ${W / 2}, y: ${H / 2}};
    try { const s = sessionStorage.getItem('__tutc'); if (s) p = JSON.parse(s); } catch {}
    Object.assign(c.style, {position:'fixed', left:'0', top:'0', zIndex:'2147483647', pointerEvents:'none',
      transform:'translate(' + p.x + 'px,' + p.y + 'px)', transition:'transform 0ms', filter:'drop-shadow(0 2px 3px rgba(0,0,0,.35))'});
    document.documentElement.appendChild(c);
    const ring = document.createElement('div');
    ring.id = '__tutr';
    Object.assign(ring.style, {position:'fixed', zIndex:'2147483646', pointerEvents:'none', border:'3px solid #f5b301',
      borderRadius:'10px', boxShadow:'0 0 0 4px rgba(245,179,1,.25)', opacity:'0', transition:'opacity 250ms, left 300ms, top 300ms, width 300ms, height 300ms'});
    document.documentElement.appendChild(ring);
  };
  add();
  window.__tutMove = (x, y, ms) => {
    const c = document.getElementById('__tutc'); if (!c) return;
    c.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,.05,.25,1)';
    c.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    try { sessionStorage.setItem('__tutc', JSON.stringify({x, y})); } catch {}
  };
  window.__tutRipple = (x, y) => {
    const r = document.createElement('div');
    Object.assign(r.style, {position:'fixed', left:(x-18)+'px', top:(y-18)+'px', width:'36px', height:'36px', borderRadius:'50%',
      background:'rgba(245,179,1,.45)', zIndex:'2147483646', pointerEvents:'none', transform:'scale(.3)', transition:'transform 380ms ease-out, opacity 380ms ease-out'});
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.4)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 450);
  };
  window.__tutRing = (box) => {
    const ring = document.getElementById('__tutr'); if (!ring) return;
    if (!box) { ring.style.opacity = '0'; return; }
    const pad = 6;
    Object.assign(ring.style, {left:(box.x-pad)+'px', top:(box.y-pad)+'px', width:(box.width+pad*2)+'px', height:(box.height+pad*2)+'px', opacity:'1'});
  };
})();
`;

export async function start(name, { colorScheme = "dark", storageState, tour = false, db } = {}) {
  // Every chapter after the interview starts from the same saved demo account, so nothing one chapter does (a swap that
  // teaches it, an award logged) shows up in the next.
  if (db) execFileSync("node", [new URL("./dbctl.mjs", import.meta.url).pathname, "restore", db], { stdio: "inherit" });
  const outDir = join(process.env.TUT_OUT ?? at("rec"), name);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, "frames"), { recursive: true });
  const browser = await chromium.launch({ args: ["--hide-scrollbars", "--font-render-hinting=none"] });
  const context = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: DPR, colorScheme, reducedMotion: "no-preference",
    // Memphis time, so the bid close reads the same in the pilot's own clock and in CT.
    timezoneId: "America/Chicago",
    ...(storageState ? { storageState } : {}),
  });
  await context.addInitScript(CURSOR_JS);
  // The first-visit tour on My Rankings shows only in the chapter about it.
  if (!tour) await context.addInitScript(() => { try { localStorage.setItem("line-select:tour:results:v1", "done"); } catch {} });
  // Nothing leaves this computer except the local site and the services it calls itself.
  await context.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (/posthog|google-analytics|doubleclick/.test(u.hostname)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  // On a failed take, keep a picture of where it stopped.
  process.on("uncaughtException", async (e) => { console.error("FAILED:", e.message.split("\n")[0]); await page.screenshot({ path: join(outDir, "..", `${name}-fail.png`) }).catch(() => {}); process.exit(1); });
  const cdp = await context.newCDPSession(page);
  const frames = [];
  const marks = [];
  let n = 0;
  let paused = 0; // seconds cut out so far
  let pausedAt = null;
  let recording = false;
  const key = name.slice(0, 4); // ch04a and ch04b are both chapter 4
  const durFile = join(at("voice"), key, "durations.json");
  const durations = existsSync(durFile) ? JSON.parse(readFileSync(durFile, "utf8")) : {};
  const ch = chapters().find((c) => `ch${String(c.num).padStart(2, "0")}` === key);
  const est = Object.fromEntries((ch?.paras ?? []).map((p, i) => [`p${i + 1}`, p.split(/\s+/).length / 2.6]));
  const wall0 = Date.now() / 1000;
  cdp.on("Page.screencastFrame", async (f) => {
    try { await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }); } catch {}
    if (!recording) return;
    const t = f.metadata.timestamp - wall0 - paused;
    if (frames.length && t <= frames.at(-1).t) return;
    const file = `f${String(n++).padStart(6, "0")}.jpg`;
    writeFileSync(join(outDir, "frames", file), Buffer.from(f.data, "base64"));
    frames.push({ file, t });
  });
  const castOpts = { format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 2 };
  const now = () => Date.now() / 1000 - wall0 - paused;
  const rec = {
    page, context, browser, outDir, durations,
    async begin() {
      recording = true;
      await cdp.send("Page.startScreencast", castOpts);
      await page.evaluate(() => window.__tutMove && window.__tutMove(640, 360, 0));
      await sleep(400);
    },
    /** Cut what follows out of the video (a wait the viewer shouldn't sit through). */
    async pause() { recording = false; pausedAt = Date.now() / 1000; },
    async resume() { paused += Date.now() / 1000 - pausedAt; pausedAt = null; recording = true; await sleep(200); },
    /** When a narration paragraph starts, in seconds of video. */
    mark(id) { marks.push({ id, t: now() }); },
    /** Start narration paragraph n: marks it, and remembers when, so hold() can wait out its voice. */
    para(i) { this.cur = `p${i}`; this.mark(this.cur); this.curAt = Date.now(); this.pausedAtPara = paused; },
    /** Seconds this paragraph's voice lasts (estimated from its words until the voice is made). */
    len(i = this.cur) { return durations[i] ?? est[i] ?? 20; },
    /** Wait until the current paragraph's voice is nearly done. Paused time doesn't count. */
    async hold(extra = 0.2) {
      // The voice sits 0.25 s after the mark and wants 0.45 s after it ends; never cut more than a second from that.
      // Time cut out of the video since the paragraph began doesn't count toward it.
      const shown = Date.now() - this.curAt - (paused - this.pausedAtPara) * 1000;
      const left = (this.len() + 0.7 + Math.max(extra, -1)) * 1000 - shown;
      if (left > 0) await sleep(left);
    },
    async end() {
      await sleep(800);
      // The screen sends frames only when it changes; remember when the take really ended, so a still ending isn't cut.
      this.endT = now();
      await cdp.send("Page.stopScreencast");
      await sleep(300);
      writeFileSync(join(outDir, "frames.json"), JSON.stringify({ frames, marks, end: this.endT }, null, 1));
      await browser.close();
      console.log(`${name}: ${frames.length} frames, ${frames.length ? frames.at(-1).t.toFixed(1) : 0}s, marks ${marks.map((m) => `${m.id}@${m.t.toFixed(1)}`).join(" ")}`);
    },
  };
  return rec;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Glide the drawn cursor (and the real mouse, for hover effects) to a point. */
export async function glide(page, x, y, ms = 700) {
  await page.evaluate(([x, y, ms]) => window.__tutMove && window.__tutMove(x, y, ms), [x, y, ms]);
  await page.mouse.move(x, y, { steps: 12 });
  await sleep(ms + 60);
}

async function centre(loc) {
  try { await loc.scrollIntoViewIfNeeded({ timeout: 10000 }); } catch { throw new Error(`can't reach ${loc}`); }
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box for locator");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}

/** Bring an element calmly into the middle of the screen. */
export async function show(page, loc, { block = "center", wait = 700 } = {}) {
  await loc.evaluate((el, block) => el.scrollIntoView({ behavior: "smooth", block }), block);
  await sleep(wait);
}

export async function point(page, loc, ms = 700) {
  const { x, y } = await centre(loc);
  await glide(page, x, y, ms);
}

export async function click(page, loc, { ms = 700, after = 500, force = false } = {}) {
  const { x, y } = await centre(loc);
  await glide(page, x, y, ms);
  await sleep(150);
  await page.evaluate(([x, y]) => window.__tutRipple && window.__tutRipple(x, y), [x, y]);
  await loc.click({ force });
  await sleep(after);
}

export async function type(page, loc, text, { delay = 28, after = 400 } = {}) {
  await click(page, loc, { after: 200 });
  await page.keyboard.type(text, { delay });
  await sleep(after);
}

export async function ring(page, loc, ms = 1800) {
  const b = await loc.boundingBox();
  await page.evaluate((b) => window.__tutRing && window.__tutRing(b), b);
  await sleep(ms);
  await page.evaluate(() => window.__tutRing && window.__tutRing(null));
  await sleep(250);
}

/** Smooth page scroll by a number of pixels. */
export async function scrollBy(page, dy, wait = 900) {
  await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: "smooth" }), dy);
  await sleep(wait);
}


/** Smoothly scroll so an element's top sits `top` pixels below the window's top. */
export async function showAt(page, loc, top = 90, wait = 1000) {
  await loc.evaluate((el, top) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - top, behavior: "smooth" }), top);
  await sleep(wait);
}

/** Open the demo pilot's rankings, with the list drawn. */
export async function openResults(page) {
  await page.goto(`${BASE}/results`, { waitUntil: "load" });
  await page.locator("[data-line-id]").first().waitFor({ timeout: 30000 });
  await sleep(1500);
}

/** Glide to a spot inside an element, as fractions of its width and height. */
export async function pointIn(page, loc, fx = 0.5, fy = 0.5, ms = 700) {
  const b = await loc.boundingBox();
  await glide(page, b.x + b.width * fx, b.y + Math.min(b.height * fy, 60), ms);
}
