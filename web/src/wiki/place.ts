// Where a dragged page ends up. Kept apart from the component so the rules can be tested.
import { buildTree } from '../../../shared/tree.ts'

export type DropPos = 'before' | 'inside' | 'after'
export interface Placed { id: number; parentId: number | null }

/**
 * The space's pages as they'd be after dropping `dragId` at `pos` relative to `targetId`,
 * depth first — the order the server stores. Returns null when the drop would change nothing or
 * would file a page inside itself.
 */
export function place(pages: Placed[], dragId: number, targetId: number, pos: DropPos): Placed[] | null {
  const tree = buildTree(pages.map((p) => ({ id: p.id, parentId: p.parentId })))
  const target = tree.byId.get(targetId)
  if (!target || dragId === targetId || tree.subtree(dragId).has(targetId)) return null

  const order = new Map<number | null, number[]>()
  for (const p of pages) {
    const parent = p.parentId != null && tree.byId.has(p.parentId) ? p.parentId : null
    order.set(parent, [...(order.get(parent) ?? []), p.id])
  }
  // Lift the page out of wherever it is now, then put it back in one place.
  for (const [parent, ids] of order) order.set(parent, ids.filter((id) => id !== dragId))

  if (pos === 'inside') {
    order.set(targetId, [...(order.get(targetId) ?? []), dragId])
  } else {
    const parent = target.parentId != null && tree.byId.has(target.parentId) ? target.parentId : null
    const siblings = [...(order.get(parent) ?? [])]
    const at = siblings.indexOf(targetId)
    siblings.splice(pos === 'before' ? at : at + 1, 0, dragId)
    order.set(parent, siblings)
  }

  const out: Placed[] = []
  const walk = (parent: number | null) => {
    for (const id of order.get(parent) ?? []) {
      out.push({ id, parentId: parent })
      walk(id)
    }
  }
  walk(null)
  return out
}
