/**
 * A star lifting off a line's shortlist button and arcing up to the Shortlist tab (marked `data-shortlist-tab`),
 * which gives a small bump as it lands. Only when the tab is on screen to land on, and never under reduced motion.
 */

const STAR = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5z"/></svg>';
const FLIGHT_MS = 650;

export function flyStarToShortlist(from: Element): void {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const target = document.querySelector<HTMLElement>("[data-shortlist-tab]");
  if (!target) return;
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (b.width === 0 || b.bottom < 0 || b.top > window.innerHeight) return;

  const star = document.createElement("span");
  star.setAttribute("aria-hidden", "true");
  star.innerHTML = STAR;
  Object.assign(star.style, {
    position: "fixed",
    left: `${a.left + a.width / 2 - 10}px`,
    top: `${a.top + a.height / 2 - 10}px`,
    zIndex: "60",
    pointerEvents: "none",
    color: "var(--color-warn)",
    filter: "drop-shadow(0 0 6px var(--glow-strong))",
  });
  document.body.append(star);

  // Along a curve that rises above both ends, sampled finely enough to read as one smooth arc.
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const lift = Math.min(dy, 0) - 70;
  const frames: Keyframe[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const x = dx * t;
    const y = 2 * (1 - t) * t * lift + t * t * dy;
    frames.push({ transform: `translate(${x}px, ${y}px) scale(${1 + 0.35 * Math.sin(Math.PI * t) - 0.45 * t}) rotate(${t * 216}deg)`, opacity: t < 0.9 ? 1 : 0.4 });
  }
  star.animate(frames, { duration: FLIGHT_MS, easing: "cubic-bezier(0.45, 0, 0.55, 1)" }).finished.then(
    () => {
      star.remove();
      target.animate([{ transform: "scale(1)" }, { transform: "scale(1.1)" }, { transform: "scale(1)" }], { duration: 280, easing: "ease-out" });
    },
    () => star.remove(),
  );
}
