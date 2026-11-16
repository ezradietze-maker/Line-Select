// Where the tutorial's recordings, voice and finished videos are made: a scratch folder outside git (TUT_WORK, by
// default .tutorial-work at the project root), which also holds the two tools only this needs — playwright-core and
// ffmpeg-static — so the project itself doesn't depend on them. See docs/tutorial/README.md.
import { createRequire } from "node:module";
import { join } from "node:path";

export const WORK = process.env.TUT_WORK ?? new URL("../../.tutorial-work", import.meta.url).pathname;
export const at = (...parts) => join(WORK, ...parts);
const fromWork = createRequire(join(WORK, "package.json"));
export const load = (name) => fromWork(name);
