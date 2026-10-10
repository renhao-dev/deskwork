// Where a window is allowed to be. Kept apart from the component so the rules can be tested:
// a window that strays above the desk hides its own title bar under the top bar, where it can
// neither be moved nor closed.
import type { WindowRect } from '../../../shared/types.ts'

export const MIN_W = 260
export const MIN_H = 180

export interface Area { width: number; height: number }

/** Pulls a window wholly inside the desk, shrinking it first if the desk is smaller than it is. */
export function clamp(r: WindowRect, desk: Area): WindowRect {
  const w = Math.min(Math.max(MIN_W, r.w), Math.max(MIN_W, desk.width))
  const h = Math.min(Math.max(MIN_H, r.h), Math.max(MIN_H, desk.height))
  return {
    ...(r.max ? { max: r.max } : {}),
    w,
    h,
    x: Math.min(Math.max(0, r.x), Math.max(0, desk.width - w)),
    y: Math.min(Math.max(0, r.y), Math.max(0, desk.height - h)),
  }
}

/** The middle of the desk: where a window goes when it has ended up somewhere it shouldn't be. */
export function centred(desk: Area, want: WindowRect): WindowRect {
  const w = Math.min(Math.max(MIN_W, want.w), Math.max(MIN_W, desk.width))
  const h = Math.min(Math.max(MIN_H, want.h), Math.max(MIN_H, desk.height))
  return clamp({ ...want, w, h, x: (desk.width - w) / 2, y: (desk.height - h) / 2 }, desk)
}

/** True when any edge of the window lies outside the desk, give or take a rounding pixel. */
export function escaped(box: DOMRect, area: DOMRect) {
  return box.top < area.top - 1 || box.left < area.left - 1
    || box.right > area.right + 1 || box.bottom > area.bottom + 1
}
