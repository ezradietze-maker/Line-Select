import type { KeyboardCoordinateGetter } from "@dnd-kit/core";

/**
 * Swapping lines from the keyboard: after Space picks a line up, Up and Down move it straight onto the line above or
 * below (dnd-kit's default moves 25px a press, less than a card, so a keyboard drag never reached another line and
 * nothing swapped). Space then drops it there, through the same swap a mouse drop makes.
 */
export const swapKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const { collisionRect, droppableRects, droppableContainers, active } = context;
  if (!collisionRect || (event.code !== "ArrowDown" && event.code !== "ArrowUp")) return undefined;
  event.preventDefault();
  const centerY = collisionRect.top + collisionRect.height / 2;
  let best: { top: number; height: number; left: number } | null = null;
  for (const container of droppableContainers.getEnabled()) {
    if (container.id === active?.id) continue;
    const rect = droppableRects.get(container.id);
    if (!rect) continue;
    const mid = rect.top + rect.height / 2;
    // The nearest line in the direction pressed; at least a few pixels away, so the line under it doesn't count.
    const ahead = event.code === "ArrowDown" ? mid > centerY + 4 : mid < centerY - 4;
    if (!ahead) continue;
    if (!best || Math.abs(mid - centerY) < Math.abs(best.top + best.height / 2 - centerY)) best = rect;
  }
  if (!best) return undefined;
  return { x: best.left + 12, y: best.top + best.height / 2 - collisionRect.height / 2 };
};
