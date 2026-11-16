// The throwaway local database's state, saved and put back, so every chapter starts from the same demo account.
//   node dbctl.mjs fresh            a new empty database (migrated)
//   node dbctl.mjs save <name>      keep the database as it is now
//   node dbctl.mjs restore <name>   put a kept one back
// Only the local PGlite on 127.0.0.1:55433 is touched; the site's pool reconnects on its own.
import { execFileSync, execSync, spawn } from "node:child_process";
import { cpSync, existsSync, renameSync, rmSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { at } from "./work.mjs";
const PGL = at("pgl");
const DATA = join(PGL, "data");
const SNAPS = at("state/db");
const PORT = 55433;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = () => { try { execSync(`nc -z 127.0.0.1 ${PORT}`, { stdio: "ignore" }); return true; } catch { return false; } };
async function stop() {
  const pids = execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN || true`).toString().trim().split("\n").filter(Boolean);
  for (const pid of pids) process.kill(Number(pid), "SIGTERM");
  for (let i = 0; i < 40 && up(); i++) await sleep(250);
  await sleep(500);
}
async function start() {
  const log = openSync(join(PGL, "..", "pgl.log"), "a");
  spawn("node", ["server.mjs"], { cwd: PGL, detached: true, stdio: ["ignore", log, log] }).unref();
  for (let i = 0; i < 80 && !up(); i++) await sleep(250);
  if (!up()) throw new Error("PGlite didn't come up");
}
const [cmd, name] = process.argv.slice(2);
mkdirSync(SNAPS, { recursive: true });
if (cmd === "fresh") {
  await stop();
  if (existsSync(DATA)) renameSync(DATA, `${DATA}.old-${Date.now()}`);
  await start();
  execFileSync("npx", ["tsx", "../pgl/migrate-local.mts"], { cwd: join(PGL, "..", "site"), stdio: "inherit" });
} else if (cmd === "save") {
  await stop();
  rmSync(join(SNAPS, name), { recursive: true, force: true });
  cpSync(DATA, join(SNAPS, name), { recursive: true });
  await start();
} else if (cmd === "restore") {
  if (!existsSync(join(SNAPS, name))) throw new Error(`no saved database "${name}"`);
  await stop();
  rmSync(DATA, { recursive: true, force: true });
  cpSync(join(SNAPS, name), DATA, { recursive: true });
  await start();
} else throw new Error("fresh | save <name> | restore <name>");
console.log(`database ${cmd}${name ? ` ${name}` : ""}: ok`);
