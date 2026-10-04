/**
 * Reorders some items of a list, leaving the rest where they are: the moved items fill the slots
 * they occupied, in their new order. Used when only part of a list (today's goals) is visible.
 */
export function reorderSubset<T>(all: T[], newOrder: T[]): T[] {
  const moving = new Set(newOrder)
  let next = 0
  return all.map((x) => (moving.has(x) ? newOrder[next++] : x))
}

/** Moves one item to a new index in a list (a copy). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const out = list.slice()
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
}
