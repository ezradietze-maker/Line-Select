// Redesign baseline: visits every page with the sample pack loaded and records two things —
//   1. the "words lock": every piece of text on each page (textContent, so CSS case changes don't count), and
//   2. a first-screen screenshot of each page,
// for each appearance mode, desktop and phone, in Chromium and WebKit. Run it before the redesign and again after;
// `words-lock.mjs` then fails if any page's words changed. Needs the dev server on :3000 (preview `line-select-dev`).
//
//   node scripts/redesign/capture.mjs --label before [--browsers chromium,webkit] [--modes light,dark,night] [--no-shots]
//     [--pages /results,/cities --merge]
import { chromium, webkit } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
    return acc;
  }, []),
);
const BASE = args.base ?? "http://localhost:3000";
const LABEL = args.label ?? "before";
const OUT = path.resolve(args.out ?? `.cache/redesign/${LABEL}`);
const BROWSERS = String(args.browsers ?? "chromium,webkit").split(",");
const MODES = String(args.modes ?? "light,dark,night").split(",");
const SHOTS = !args["no-shots"];
// --pages /results,/cities limits a run to those pages; --merge adds its words into an existing words.json.
const ONLY = args.pages ? String(args.pages).split(",") : null;
const MERGE = Boolean(args.merge);
// Fixed clock so countdowns and "today" read the same on every run.
const NOW = new Date("2026-11-11T15:00:00Z");

// Pages as a first-time visitor sees them: a fresh browser, nothing loaded (the seeded pages above redirect "/" to
// the rankings). Keyed "<route> (first visit)".
export const FIRST_VISIT_PAGES = ["/"];
const FIRST_VISIT = " (first visit)";

export const PAGES = [
  "/", "/how-it-works", "/pricing", "/whats-new", "/privacy", "/terms", "/auth", "/reset-password",
  "/upload", "/preview", "/interview", "/preferences", "/preferences/quick", "/confirm-preferences",
  "/results", "/strategies", "/view-add", "/open-time",
  "/cities", "/logbook", "/tools", "/contract",
  "/trade-board", "/inbox", "/hotel-ratings", "/membership",
  "/no-such-page",
];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844, isMobile: true, hasTouch: true } };
const PROFILE_KEY = "line-select:preference-profile:guest:v1";
const THEME_KEY = "line-select:theme:v1";

/** Every text node under <body>, outside scripts/styles and Next's dev overlay, whitespace-collapsed. */
function pageWords() {
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      for (let el = n.parentElement; el; el = el.parentElement) {
        if (skip.has(el.tagName) || el.tagName.startsWith("NEXTJS-")) return NodeFilter.FILTER_REJECT;
      }
      return n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walk.nextNode()) out.push(walk.currentNode.textContent.replace(/\s+/g, " ").trim());
  return out.join(" | ");
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function seed(context) {
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  await page.goto(BASE + "/");
  await settle(page);
  await page.getByRole("button", { name: "Try it with sample data" }).first().click();
  await page.waitForURL(/preferences|upload|preview/, { timeout: 30000 });
  await settle(page);
  // A finished profile so My Rankings and its neighbours open. Missing fields are filled in by the app itself.
  // The rankings tour is dismissed so screenshots show the page itself.
  await page.evaluate(([k]) => {
    localStorage.setItem(k, JSON.stringify({ weights: {}, completedAt: "2026-11-01T00:00:00.000Z" }));
    localStorage.setItem("line-select:tour:results:v1", "done");
  }, [PROFILE_KEY]);
  await page.close();
}

const words = {};
for (const name of BROWSERS) {
  const engine = name === "webkit" ? webkit : chromium;
  const browser = await engine.launch();
  for (const [vpName, vp] of Object.entries(VIEWPORTS)) {
    const { isMobile, hasTouch, ...viewport } = vp;
    // WebKit has no isMobile emulation; size alone gives the phone layout.
    const contextOptions = {
      viewport, reducedMotion: "reduce", deviceScaleFactor: 1,
      ...(name === "chromium" && isMobile ? { isMobile, hasTouch } : {}),
    };
    const seeded = await browser.newContext(contextOptions);
    await seed(seeded);
    const runs = [
      [seeded, (ONLY ?? PAGES).filter((r) => !r.endsWith(FIRST_VISIT)), ""],
      // A fresh context for each first-visit run, so nothing one page stores reaches the next.
      [null, (ONLY ?? FIRST_VISIT_PAGES.map((r) => r + FIRST_VISIT)).filter((r) => r.endsWith(FIRST_VISIT)).map((r) => r.slice(0, -FIRST_VISIT.length)), FIRST_VISIT],
    ];
    for (const mode of MODES) {
      for (const [shared, routes, suffix] of runs) {
        if (routes.length === 0) continue;
        const context = shared ?? (await browser.newContext(contextOptions));
        const page = await context.newPage();
        await page.clock.setFixedTime(NOW);
        await page.addInitScript(([k, m]) => localStorage.setItem(k, m), [THEME_KEY, mode]);
        // Seeded Math.random, so the Trade Board's made-up example offers come out the same on every run.
        await page.addInitScript(() => {
          let s = 20261111;
          Math.random = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
        });
        for (const route of routes) {
          const key = `${route}${suffix}|${vpName}|${mode}|${name}`;
          try {
            await page.goto(BASE + route);
            await settle(page);
            words[key] = await page.evaluate(pageWords);
            if (SHOTS) {
              const dir = path.join(OUT, name, vpName, mode);
              mkdirSync(dir, { recursive: true });
              const file = (route === "/" ? "home" : route.slice(1).replace(/\//g, "_")) + (suffix ? "-first-visit" : "") + ".png";
              await page.screenshot({ path: path.join(dir, file) });
            }
            process.stdout.write(".");
          } catch (e) {
            words[key] = `CAPTURE FAILED: ${e.message.split("\n")[0]}`;
            process.stdout.write("x");
          }
        }
        await page.close();
        if (!shared) await context.close();
      }
    }
    await seeded.close();
  }
  await browser.close();
}
mkdirSync(OUT, { recursive: true });
const wordsFile = path.join(OUT, "words.json");
const all = MERGE && existsSync(wordsFile) ? { ...JSON.parse(readFileSync(wordsFile, "utf8")), ...words } : words;
writeFileSync(wordsFile, JSON.stringify(all, null, 1));
console.log(`\n${Object.keys(words).length} page captures → ${OUT}`);
