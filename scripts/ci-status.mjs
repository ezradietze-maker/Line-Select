// What GitHub's checks said about a pushed commit (default: this checkout's HEAD), waiting while they run.
//   npm run ci-status            — HEAD
//   npm run ci-status -- <sha>   — a given commit
// Exits 0 when every check passed, 1 when one failed, 2 when nothing ran or it couldn't tell. Reads the public
// repository's check runs with no token (GitHub allows 60 such reads an hour).
import { execSync } from "node:child_process";

const REPO = "ezradietze-maker/Line-Select";
const sha = process.argv[2] ?? execSync("git rev-parse HEAD").toString().trim();
const WAIT_MS = 10 * 60 * 1000;
const POLL_MS = 20 * 1000;

async function runs() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${sha}/check-runs`, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  return (await res.json()).check_runs ?? [];
}

const started = Date.now();
for (;;) {
  let list;
  try {
    list = await runs();
  } catch (e) {
    console.log(`Couldn't read the checks for ${sha.slice(0, 7)}: ${e.message}`);
    process.exit(2);
  }
  const pending = list.filter((r) => r.status !== "completed");
  if (list.length && !pending.length) {
    const failed = list.filter((r) => !["success", "skipped", "neutral"].includes(r.conclusion));
    for (const r of list) console.log(`${r.conclusion === "success" ? "✓" : "✗"} ${r.name}: ${r.conclusion}`);
    if (failed.length) {
      console.log(`\nRED: ${sha.slice(0, 7)} failed ${failed.map((r) => r.name).join(", ")}. Details: ${failed[0].html_url}`);
      process.exit(1);
    }
    console.log(`\nGREEN: every check passed on ${sha.slice(0, 7)}.`);
    process.exit(0);
  }
  if (Date.now() - started > WAIT_MS) {
    console.log(list.length ? `Still running after 10 minutes: ${pending.map((r) => r.name).join(", ")}` : `No checks found for ${sha.slice(0, 7)} — was it pushed?`);
    process.exit(2);
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
