// Makes the narration with Deepgram's voice, one file per paragraph, from the approved script.
//   node tts.mjs <voice> [chapterNumber]     e.g. node tts.mjs orion 5
// Writes $TUT_WORK/voice/chNN/pK.wav, durations.json (seconds) and paras.json (the words, for captions).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chapters } from "./narration.mjs";
import { at, load } from "./work.mjs";

const ffmpeg = load("ffmpeg-static");

const voice = process.argv[2];
const only = process.argv[3] ? Number(process.argv[3]) : null;
const env = readFileSync(new URL("../../.env.local", import.meta.url).pathname, "utf8");
const KEY = env.match(/^DEEPGRAM_API_KEY=(.*)$/m)[1].replace(/^"|"$/g, "").trim();

// How a word should be said, where the voice would otherwise guess wrong. The captions keep the written form.
const SAY = [
  [/\bVIPS\b/g, "Vips"],
  [/Command-K/g, "Command K"],
  [/Control-K/g, "Control K"],
  // Capitalised in a list, "Better" came out wrong; the tier names read naturally in lower case.
  [/Best, Better, Good, Backup and Not bid/g, "best, better, good, backup, and not bid"],
];

// One voice the whole way through: every paragraph is trimmed to the same short pause at each end and levelled to the
// same loudness, and a take spoken noticeably faster or slower than his usual pace is voiced again (keeping the take
// closest to it), so no paragraph stands out from the ones around it.
const PACE_TOLERANCE = 0.06; // within 6% of his usual letters a second
const TAKES = 4;
const VOICE_ROOT = at("voice");
const PACE_FILE = join(VOICE_ROOT, `pace-${voice}.json`);

let chars = 0;
async function speak(text) {
  const res = await fetch(`https://api.deepgram.com/v1/speak?model=aura-2-${voice}-en`, {
    method: "POST",
    headers: { Authorization: `Token ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  chars += text.length;
  return Buffer.from(await res.arrayBuffer());
}
const TRIM = "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12";
function prepare(mp3, wav) {
  execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", mp3, "-af", `${TRIM},areverse,${TRIM},areverse,loudnorm=I=-18:TP=-2:LRA=7`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav]);
  return (readFileSync(wav).length - 44) / 96000;
}
const letters = (t) => t.replace(/[^A-Za-z0-9]/g, "").length;
// A take still off his pace after every retry is brought onto it with a tempo change that keeps the pitch (atempo), so
// his voice sounds the same and only the speed evens out. Returns the new length in seconds.
function onPace(wavIn, wavOut, pace, target) {
  const tempo = Math.min(1.15, Math.max(0.87, target / pace));
  const tmp = `${wavOut}.tmp.wav`;
  execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-i", wavIn, "-af", `atempo=${tempo.toFixed(4)}`, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", tmp]);
  execFileSync("mv", [tmp, wavOut]);
  return (readFileSync(wavOut).length - 44) / 96000;
}

// `tts.mjs <voice> --repace`: no new voice; bring each saved paragraph that's off his pace onto it.
if (process.argv[3] === "--repace") {
  const target = JSON.parse(readFileSync(PACE_FILE, "utf8")).pace;
  for (const c of chapters()) {
    const dir = join(VOICE_ROOT, `ch${String(c.num).padStart(2, "0")}`);
    const durations = JSON.parse(readFileSync(join(dir, "durations.json"), "utf8"));
    for (const [i, text] of c.paras.entries()) {
      const id = `p${i + 1}`, pace = letters(text) / durations[id];
      if (Math.abs(pace / target - 1) <= PACE_TOLERANCE) continue;
      durations[id] = onPace(join(dir, `${id}.wav`), join(dir, `${id}.wav`), pace, target);
      console.log(`ch${String(c.num).padStart(2, "0")} ${id}: ${(100 * (pace / target - 1)).toFixed(0)}% off, now ${(100 * (letters(text) / durations[id] / target - 1)).toFixed(0)}%`);
    }
    writeFileSync(join(dir, "durations.json"), JSON.stringify(durations, null, 1));
  }
  process.exit(0);
}

// Every paragraph to voice.
const jobs = [];
for (const c of chapters()) {
  if (only && c.num !== only) continue;
  const name = `ch${String(c.num).padStart(2, "0")}`;
  c.paras.forEach((text, i) => {
    let said = text;
    for (const [re, sub] of SAY) said = said.replace(re, sub);
    jobs.push({ name, id: `p${i + 1}`, text, said, dir: join(VOICE_ROOT, name) });
  });
}
async function take(job, n) {
  mkdirSync(job.dir, { recursive: true });
  const mp3 = join(job.dir, `${job.id}.take${n}.mp3`), wav = join(job.dir, `${job.id}.take${n}.wav`);
  writeFileSync(mp3, await speak(job.said));
  const secs = prepare(mp3, wav);
  return { mp3, wav, secs, pace: letters(job.said) / secs };
}
for (let k = 0; k < jobs.length; k += 6) await Promise.all(jobs.slice(k, k + 6).map(async (j) => (j.takes = [await take(j, 1)])));

// His usual pace: the middle of this run when it's the whole script, or the last whole run's when it's one chapter.
const paces = jobs.map((j) => j.takes[0].pace).sort((a, b) => a - b);
const target = !only || !existsSync(PACE_FILE) ? paces[Math.floor(paces.length / 2)] : JSON.parse(readFileSync(PACE_FILE, "utf8")).pace;
if (!only) writeFileSync(PACE_FILE, JSON.stringify({ pace: target }));
const off = (t) => Math.abs(t.pace / target - 1);
for (const j of jobs) {
  while (j.takes.length < TAKES && Math.min(...j.takes.map(off)) > PACE_TOLERANCE) j.takes.push(await take(j, j.takes.length + 1));
  j.best = j.takes.reduce((a, b) => (off(b) < off(a) ? b : a));
}

for (const name of [...new Set(jobs.map((j) => j.name))]) {
  const mine = jobs.filter((j) => j.name === name);
  const durations = {}, paras = {};
  for (const j of mine) {
    execFileSync("cp", [j.best.mp3, join(j.dir, `${j.id}.mp3`)]);
    durations[j.id] = off(j.best) > PACE_TOLERANCE ? onPace(j.best.wav, join(j.dir, `${j.id}.wav`), j.best.pace, target) : (execFileSync("cp", [j.best.wav, join(j.dir, `${j.id}.wav`)]), j.best.secs);
    paras[j.id] = j.text;
    const flag = off(j.best) > PACE_TOLERANCE ? `  (${(100 * (j.best.pace / target - 1)).toFixed(0)}% off after ${j.takes.length} takes: tempo evened out)` : j.takes.length > 1 ? `  (${j.takes.length} takes)` : "";
    if (flag) console.log(`${name} ${j.id}${flag}`);
  }
  writeFileSync(join(mine[0].dir, "durations.json"), JSON.stringify(durations, null, 1));
  writeFileSync(join(mine[0].dir, "paras.json"), JSON.stringify(paras, null, 1));
  console.log(name, Object.values(durations).reduce((s, d) => s + d, 0).toFixed(1), "s");
}
console.log(`usual pace ${target.toFixed(1)} letters/s · ${chars} characters ≈ $${((chars / 1000) * 0.03).toFixed(2)}`);
