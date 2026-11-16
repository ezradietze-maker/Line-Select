// Turns one chapter's recorded frames into an MP4 with its narration laid on at the marks, plus WebVTT captions.
// Where a paragraph's voice runs longer than the screen action before the next mark, the picture holds still on
// that moment until the voice catches up, so nothing ever talks over the wrong screen.
//   node assemble.mjs ch05            -> ../out/ch05.mp4, ../out/ch05.vtt
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { WORK, load } from "./work.mjs";

const ffmpeg = load("ffmpeg-static");

const ROOT = WORK;
const name = process.argv[2];
const dir = join(ROOT, "rec", name);
const raw = JSON.parse(readFileSync(join(dir, "frames.json"), "utf8"));
// Times count from the first recorded frame, which is when the video starts.
const t0 = raw.frames[0].t;
const frames = raw.frames.map((f) => ({ ...f, t: f.t - t0 }));
const marks = raw.marks.map((m) => ({ ...m, t: Math.max(0, m.t - t0) }));
const voiceDir = join(ROOT, "voice", name);
const texts = existsSync(join(voiceDir, "paras.json")) ? JSON.parse(readFileSync(join(voiceDir, "paras.json"), "utf8")) : null;
mkdirSync(join(ROOT, "out"), { recursive: true });

const dur = frames.map((f, i) => (i + 1 < frames.length ? frames[i + 1].t - f.t : raw.end ? Math.max(raw.end - t0 - f.t, 0.5) : 1));
const audioLen = (id) => {
  const f = join(voiceDir, `${id}.wav`);
  if (!existsSync(f)) return null;
  return (readFileSync(f).length - 44) / (48000 * 2);
};

// Place each paragraph; push the picture on where the voice needs more room.
const placed = [];
let shift = 0;
const LEAD = 0.25, TAIL = 0.45;
for (let k = 0; k < marks.length; k++) {
  const at = marks[k].t + shift + LEAD;
  const a = audioLen(marks[k].id);
  const endT = raw.end ? raw.end - t0 : frames.at(-1).t + 1;
  const nextT = k + 1 < marks.length ? marks[k + 1].t + shift : endT + shift;
  if (a !== null) {
    const need = at + a + TAIL - nextT;
    if (need > 0) {
      // Hold the frame showing just before the next mark (or the last frame).
      const holdAt = nextT - shift - 0.05;
      let idx = frames.findLastIndex((f) => f.t <= holdAt);
      if (idx < 0) idx = 0;
      dur[idx] += need;
      shift += need;
    }
    placed.push({ id: marks[k].id, at, len: a });
  }
}

const list = frames.map((f, i) => `file '${(f.file.startsWith("/") ? f.file : join(dir, "frames", f.file))}'\nduration ${Math.max(dur[i], 0.001).toFixed(4)}`).join("\n")
  + `\nfile '${(frames.at(-1).file.startsWith("/") ? frames.at(-1).file : join(dir, "frames", frames.at(-1).file))}'\n`;
writeFileSync(join(dir, "concat.txt"), list);
const total = dur.reduce((s, d) => s + d, 0);

const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "concat.txt")];
for (const p of placed) args.push("-i", join(voiceDir, `${p.id}.wav`));
const vf = "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p";
if (placed.length) {
  const chains = placed.map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.at * 1000)}:all=1[a${i}]`).join(";");
  const mix = `${placed.map((_, i) => `[a${i}]`).join("")}amix=inputs=${placed.length}:normalize=0,apad,atrim=0:${total.toFixed(3)}[aout]`;
  args.push("-filter_complex", `[0:v]${vf}[vout];${chains};${mix}`, "-map", "[vout]", "-map", "[aout]", "-c:a", "aac", "-b:a", "128k", "-ar", "48000");
} else {
  args.push("-vf", vf);
}
args.push("-c:v", "libx264", "-preset", "slow", "-crf", "22", "-tune", "animation", "-movflags", "+faststart", "-t", total.toFixed(3), join(ROOT, "out", `${name}.mp4`));
execFileSync(ffmpeg, args, { stdio: "inherit" });

// Captions: each paragraph split into sentences, timed by length across its own voice.
const ts = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = (s % 60).toFixed(3).padStart(6, "0"); return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${x}`; };
let vtt = "WEBVTT\n\n";
if (texts) {
  for (const p of placed) {
    const text = texts[p.id];
    if (!text) continue;
    const parts = text.match(/[^.!?—]+(?:[.!?]+|—|$)\s*/g).map((s) => s.trim()).filter(Boolean);
    // Join short bits so a caption is never a fragment of two words.
    const cues = [];
    for (const s of parts) { if (cues.length && (cues.at(-1).length < 40 || s.length < 20)) cues[cues.length - 1] += " " + s; else cues.push(s); }
    const chars = cues.reduce((n, c) => n + c.length, 0);
    let t = p.at;
    for (const c of cues) {
      const d = (c.length / chars) * p.len;
      vtt += `${ts(t)} --> ${ts(t + d)}\n${c}\n\n`;
      t += d;
    }
  }
}
writeFileSync(join(ROOT, "out", `${name}.vtt`), vtt);
console.log(`${name}.mp4: ${total.toFixed(1)}s, ${placed.length} voice paragraphs, held ${shift.toFixed(1)}s for the voice`);
