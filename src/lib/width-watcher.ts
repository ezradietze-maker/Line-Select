/**
 * Follows the width one element is drawn at (`useMeasuredWidth`). Told which element is there after every render, it
 * starts over only when that changes: an element that isn't there on the first render — the rankings list, behind its
 * loading screen — is measured from the moment it appears, rather than never, which left a phone's list laid out for
 * the 768px it was guessed at.
 */
export function widthWatcher(onWidth: (width: number) => void, fallback: number) {
  let current: Element | null = null;
  let observer: ResizeObserver | null = null;
  return {
    follow(el: Element | null) {
      if (el === current) return;
      observer?.disconnect();
      observer = null;
      current = el;
      if (!el) return;
      const read = () => onWidth(el.getBoundingClientRect().width || fallback);
      read();
      observer = new ResizeObserver(read);
      observer.observe(el);
    },
    stop() {
      observer?.disconnect();
      observer = null;
      current = null;
    },
  };
}
