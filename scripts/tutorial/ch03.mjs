// Chapter 3: the interview. A real run against the live interviewer; the waits for the AI are cut out, and only the
// moments the narration talks about are kept on screen (one question of each kind, the trip grades, the review).
import { start, sleep, click, type, ring, point, show, scrollBy } from "./lib.mjs";
import { SENIORITY, setClock } from "./demo.mjs";
import { at } from "./work.mjs";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const STATE = at("state/after-upload.json");
const rec = await start("ch03", { storageState: STATE });
const { page, context } = rec;
await setClock(page);
const BASE = process.env.TUT_BASE ?? "http://localhost:3031";
await page.goto(`${BASE}/preferences`, { waitUntil: "networkidle" });
const main = page.locator("main");
const log = [];
process.on('unhandledRejectionX', async (e) => { console.error('FAILED', e?.message); await page.screenshot({ path: new URL('../rec/ch03-fail.png', import.meta.url).pathname }).catch(() => {}); process.exit(1); });
await rec.begin();

const STORY = "First thing I look at is days off, and how they fall. I commute in from Charlotte, so I want my days off in big blocks and as few trips as I can get, ideally three or four. I'd rather do a longer trip than two short ones. I don't mind some night flying, but back-to-back all-nighters wreck me, and I hate an early report on the first day because I have to commute in the night before. Long layovers in good cities are a plus. Los Angeles I love, Indianapolis is fine, and I'd skip Newark and Miami if I can. Credit matters less than time at home, but I don't want a line way under guarantee.";

// p1: intro, start the interview.
rec.para(1);
await sleep(1500);
await point(page, main.getByRole("button", { name: "Start the interview" }));
await sleep(rec.len() * 1000 - 4500);
await click(page, main.getByRole("button", { name: "Start the interview" }), { after: 1500 });

// p2: seniority.
rec.para(2);
const sen = main.getByRole("textbox", { name: "Seniority number" });
// A draft left by an earlier take: start fresh, off camera.
const fresh = main.getByRole("button", { name: "Start fresh" });
if (await Promise.race([fresh.waitFor({ timeout: 20000 }).then(() => true), sen.waitFor({ timeout: 20000 }).then(() => false)])) {
  await rec.pause(); await fresh.click(); await sen.waitFor({ timeout: 20000 }); await rec.resume();
}
await type(page, sen, SENIORITY, { delay: 120, after: 1500 });
await ring(page, main.getByText(/Found you/), 1600);
await rec.hold(-1);
await click(page, main.getByRole("button", { name: "Next" }), { after: 800 });

// p3: the story.
rec.para(3);
const story = main.getByRole("textbox").first();
await story.waitFor({ timeout: 15000 });
await type(page, story, STORY, { delay: 7, after: 800 });
// The count is also written out for screen readers: the visible one is ringed.
const areas = main.getByText(/of 15 areas/).filter({ visible: true }).first();
await show(page, areas, { wait: 900 });
await ring(page, areas.locator(".."), 1800);
await rec.hold(-1.2);
await click(page, main.getByRole("button", { name: "Continue", exact: true }), { after: 1200 });

// p4: commute and cities.
rec.para(4);
await click(page, main.getByRole("radio", { name: /I commute in/ }).or(main.getByRole("button", { name: /I commute in/ })).first(), { after: 600 });
const from = main.getByPlaceholder("e.g. CLT");
await type(page, from, "CLT", { delay: 90 });
await click(page, main.getByRole("button", { name: /No crash pad/ }).or(main.getByRole("radio", { name: /No crash pad/ })).first());
await sleep(600);
await click(page, main.getByRole("button", { name: "Next" }), { after: 1500 });
// Cities: grade the first few, most-flown first.
await main.getByText("How do you feel about each layover city?").waitFor({ timeout: 15000 });
// Matching the story: IND fine, LAX loved, MIA and EWR skipped (the pack lists them most-flown first).
const plan = { IND: "Like", LAX: "Love", OAK: "Neutral", MIA: "Dislike", ONT: "Neutral", EWR: "Avoid" };
for (const [code, grade] of Object.entries(plan)) {
  const card = main.locator("[role=group]").filter({ has: page.getByRole("button", { name: "Love", exact: true }) }).filter({ hasText: code }).first();
  if (!(await card.count())) continue;
  await click(page, card.getByRole("button", { name: grade, exact: true }), { ms: 500, after: 350 });
}
await rec.hold(-1);
await click(page, main.getByRole("button", { name: "Continue", exact: true }).last(), { after: 1000 });
await rec.pause();

// The questions. Recording stays off except for the moments the narration shows.
// Answers to the interviewer's own questions, picked by what the question is about, so each one fits what was asked.
const ANSWERS = [
  [/nights? in a row|real break|days off|stretch(es)? at home/i, "Four nights at home is when it feels like a real break. Three is just getting over the last trip."],
  [/all-night|back-to-back|overnight duty/i, "I'd give up a bit of credit to stay off back-to-back all-nighters."],
  [/layover|hotel|city|cities/i, "A long layover in a good city makes up for a longer trip, honestly."],
  [/report|dawn|early|morning|show/i, "I'd rather start a trip mid-morning than at dawn, because of the commute."],
  [/credit|guarantee|pay|money/i, "I'll give up a few hours of credit for more time at home, but not much below guarantee."],
  [/departure|trips? a month|how many trips/i, "Three or four departures a month. Every extra one is another commute."],
  [/leg|landing/i, "Two or three legs a day is fine. Four starts to wear on me."],
];
// Headings can hold no-break spaces (so a line doesn't end on one short word): spaces are made plain before matching.
const answerFor = (q) => (ANSWERS.find(([re]) => re.test(q.replace(/\s+/g, " "))) ?? [null, "It matters some, but big blocks of days at home come first for me."])[1];
let answered = 0, shownFree = false, shownLine = false, shownTrip = false, shownGrades = false, p5 = false;
const want = () => !shownFree || !shownLine || !shownTrip;
async function showing(kind) {
  if (!p5) { await rec.resume(); rec.para(5); p5 = true; } else await rec.resume();
  log.push(kind);
}

// Which screen is up, read from its controls rather than text that can linger from the last one.
async function classify() {
  const vis = async (l) => (await l.count()) > 0 && (await l.first().isVisible().catch(() => false));
  for (let t = 0; t < 480; t++) {
    if (await vis(main.getByRole("button", { name: /Looks right — rank my lines/ }))) return "review";
    if (await vis(main.getByRole("button", { name: /Nothing else/ }))) return "sweep";
    if (await vis(main.getByRole("radio", { name: "Love it" }))) return "grades";
    const pick = main.getByRole("group", { name: "Your pick" });
    if (await vis(pick)) return (await vis(main.getByText("Which would you bid higher?"))) ? "line" : "trip";
    if (await vis(main.getByRole("radiogroup"))) return "choice";
    if (await vis(main.getByPlaceholder("In your own words…"))) return "free";
    await sleep(500);
  }
  return "none";
}
for (let guard = 0; guard < 60; guard++) {
  // Wait for a screen that wants an answer.
  const screen = await classify();
  if (screen === "none") throw new Error("no screen came up in 4 minutes");
  await sleep(600);
  const before = (await main.innerText()).slice(0, 600);
  const prompt = (await main.locator("h2").first().textContent().catch(() => ""))?.trim();
  console.log("screen", screen, "|", prompt?.slice(0, 120));
  if (screen === "review") break;
  if (screen === "free") {
    // The fixed questions, told apart by their words on screen (the first h2 isn't always the question).
    // Matched by the heading's accessible name: its words can be split over lines, which a text search misses.
    const heading = async (re) => (await main.getByRole("heading", { name: re }).count()) > 0;
    const commuteQ = (await heading(/leave before your report/i)) || /leave before your report/i.test(prompt ?? "");
    const bottomQ = (await heading(/bottom of your list/i)) || /bottom of your list/i.test(prompt ?? "");
    const question = (await main.getByRole("heading").filter({ visible: true }).allTextContents()).join(" ") + " " + (prompt ?? "");
    const isAi = answered >= 2 && !commuteQ && !bottomQ;
    const show1 = isAi && !shownFree;
    if (show1) { await showing("free"); await sleep(2500); }
    const text = bottomQ ? "More than three commutes in a month, or back-to-back all-nighters." :
      commuteQ ? "I like to land about three hours before report. For an early show I go in the night before." : answerFor(question);
    console.log("  answered:", text);
    if (show1) await type(page, main.getByPlaceholder("In your own words…"), text, { delay: 14 });
    else await main.getByPlaceholder("In your own words…").fill(text);
    if (show1) await click(page, main.getByRole("button", { name: "Send" }), { after: 600 });
    else await main.getByRole("button", { name: "Send" }).click();
    if (show1) { shownFree = true; await rec.pause(); }
  } else if (screen === "choice") {
    const radios = main.getByRole("radiogroup").first().getByRole("radio");
    const n = await radios.count();
    await radios.nth(n > 2 ? 1 : 0).click();
    await main.getByRole("button", { name: "Next" }).click();
  } else if (screen === "line") {
    const show1 = !shownLine;
    if (show1) { await showing("line"); await sleep(1500); await show(page, main.getByText("Which would you bid higher?"), { wait: 1200 }); }
    const pick = main.getByRole("group", { name: "Your pick" }).getByRole("button").nth(1);
    if (show1) await click(page, pick); else await pick.click();
    if (show1) await click(page, main.getByRole("button", { name: "Continue" }), { after: 500 }); else await main.getByRole("button", { name: "Continue" }).click();
    if (show1) { shownLine = true; await rec.pause(); }
  } else if (screen === "trip") {
    const show1 = !shownTrip;
    if (show1) {
      await showing("trip");
      await sleep(1200);
      // Each trip is a row; one tapped open to read it day by day at full size.
      const optA = main.getByRole("button", { name: /^Option A, .* show it day by day/ });
      await show(page, optA, { wait: 900 });
      await click(page, optA, { after: 1600 });
      await scrollBy(page, 260, 1400);
      await sleep(900);
      await show(page, main.getByText("Which would you rather fly?"), { wait: 1000 });
    }
    const pick = main.getByRole("group", { name: "Your pick" }).getByRole("button").nth(3);
    if (show1) await click(page, pick); else await pick.click();
    if (show1) await click(page, main.getByRole("button", { name: "Continue" }), { after: 500 }); else await main.getByRole("button", { name: "Continue" }).click();
    if (show1) { shownTrip = true; await rec.pause(); }
  } else if (screen === "grades") {
    const show1 = !shownGrades;
    await sleep(1500);
    if (show1) { await showing("grades"); await sleep(1200); }
    const groups = main.getByRole("radiogroup");
    const g = await groups.count();
    const grades = ["Good", "Love it", "Fine", "Poor", "Good", "Trade it away", "Fine", "Good"];
    for (let i = 0; i < g; i++) {
      const b = groups.nth(i).getByRole("radio", { name: grades[i % grades.length] });
      if (show1 && i < 4) await click(page, b, { ms: 450, after: 250 }); else await b.click();
    }
    // Make sure enough are graded (the screen can still be settling when the first clicks land).
    const cont = main.getByRole("button", { name: "Continue", exact: true });
    for (let t = 0; t < 10 && !(await cont.isEnabled()); t++) {
      await sleep(700);
      const gg = await groups.count();
      for (let i = 0; i < gg; i++) {
        const checked = await groups.nth(i).locator("[aria-checked=true]").count();
        if (!checked) await groups.nth(i).getByRole("radio", { name: "Good" }).click().catch(() => {});
      }
    }
    if (show1) { await sleep(800); shownGrades = true; await rec.pause(); }
    await cont.click();
  } else if (screen === "sweep") {
    await main.getByRole("button", { name: /Nothing else/ }).click();
  }
  // Wait for this screen to give way to the next, so a screen still saying "Sending…" isn't read again.
  for (let t = 0; t < 400; t++) {
    const now = (await main.innerText().catch(() => "")).slice(0, 600);
    if (now !== before && !/Sending…/.test(now)) break;
    await sleep(500);
  }
  answered++;
  // Enough questions once the line and trip pairs have been seen; the trip grades and review follow.
  if (answered >= 14 || (!want() && answered >= 8)) {
    const enough = page.getByRole("button", { name: /That.s enough/ });
    if (await enough.count()) { await sleep(1500); await enough.click().catch(() => {}); }
  }
  await sleep(800);
}

// p6: the review.
await rec.resume();
rec.para(6);
await sleep(1500);
await scrollBy(page, 350, 1600);
await sleep(1500);
await scrollBy(page, 350, 1600);
await rec.hold(-4);
const go = main.getByRole("button", { name: /Looks right/ });
await show(page, go);
await click(page, go, { after: 500 });
await page.waitForURL(/results/, { timeout: 120000 });
await sleep(4500);
await context.storageState({ path: at("state/after-interview.json") });
await rec.end();
// The demo account as every later chapter starts it.
execFileSync("node", [new URL("./dbctl.mjs", import.meta.url).pathname, "save", "after-interview"], { stdio: "inherit" });
writeFileSync(new URL("../rec/ch03/log.json", import.meta.url).pathname, JSON.stringify(log));
