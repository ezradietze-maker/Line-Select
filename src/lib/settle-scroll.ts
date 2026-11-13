/**
 * Brings the element with this id to the top of the screen (less its `scroll-margin-top`) and keeps it there while the
 * page settles around it. My Rankings draws only the cards near the screen (`use-windowed-rows.ts`): a jump far down the
 * list lands among stand-ins whose heights are guesses, the cards drawn in around it then take their real heights, and
 * the panels above the list finish loading — each moving the line away from where the scroll put it. So the place is
 * read again every frame, and put right, until nothing has moved for a while.
 *
 * The scroll is smooth only when asked and the line is close (a short glide past cards already drawn); a jump from
 * another screen, or from far away, is instant. Anything the pilot does to scroll (wheel, touch, a key, a press) stops
 * it straight away, so it never fights them. Returns a stop function.
 */

/** Frames in a row with the line in place before it counts as settled. */
const STILL_FRAMES = 18;
/** Kept at for at least this long: a page loading behind it moves late. */
const MIN_MS = 700;
/** And never longer than this. */
const MAX_MS = 4000;

export function settleScrollTo(id: string, { smooth = false }: { smooth?: boolean } = {}): () => void {
  if (typeof window === "undefined") return () => {};
  let frame = 0;
  let stopped = false;
  const started = performance.now();
  const find = () => document.getElementById(id);
  const marginOf = (el: HTMLElement) => parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  /** Where the page should be scrolled to for the line to sit at the top, as far as the page's length allows. */
  const wanted = (el: HTMLElement) => {
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return Math.min(max, Math.max(0, Math.round(window.scrollY + el.getBoundingClientRect().top - marginOf(el))));
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"] as const) window.removeEventListener(type, stop, true);
  };
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"] as const) window.addEventListener(type, stop, { capture: true, passive: true });

  const first = find();
  if (!first) {
    stop();
    return stop;
  }
  // Smooth only for a short way: past a screen or two, the glide crosses stand-ins that change height under it.
  const glide = smooth && Math.abs(first.getBoundingClientRect().top) < window.innerHeight * 1.5;
  if (glide) first.scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: wanted(first), behavior: "instant" });

  let still = 0;
  let lastY = window.scrollY;
  let gliding = glide;
  const tick = () => {
    if (stopped) return;
    const el = find();
    const elapsed = performance.now() - started;
    if (!el || elapsed > MAX_MS) return stop();
    const y = window.scrollY;
    if (gliding) {
      // Left to finish its glide: corrected once it has come to rest.
      if (Math.abs(y - lastY) > 0.5) still = 0;
      else if (++still >= 3) {
        gliding = false;
        still = 0;
      }
      lastY = y;
      frame = requestAnimationFrame(tick);
      return;
    }
    const target = wanted(el);
    if (Math.abs(target - y) > 1) {
      window.scrollTo({ top: target, behavior: "instant" });
      still = 0;
    } else if (++still >= STILL_FRAMES && elapsed >= MIN_MS) return stop();
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return stop;
}
