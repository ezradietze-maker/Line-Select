// The demo pilot and the moment the recording pretends it is: two days before October's bid closes, so the
// countdown runs and nothing says the bid is over. Only the browser's clock is moved; the server keeps real time.
export const CLOCK = new Date("2026-09-07T14:30:00Z");
// A real bid pack PDF, kept out of git (the recordings used the October 2026 Memphis 767 pack).
export const PDF = process.env.TUT_PDF;
// Bid #48 of 506 first officers: senior enough that the top lines are ones the demo pilot could hold, with a week of
// vacation (Oct 12–19) inside the bid month.
export const SENIORITY = "1908";
export const ACCOUNT = { name: "Demo Pilot", email: "demo.pilot@example.com", password: "tutorial-demo-2026" };
export async function setClock(page, when = CLOCK) {
  await page.clock.install({ time: when });
  await page.clock.resume();
}
