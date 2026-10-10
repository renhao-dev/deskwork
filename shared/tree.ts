// Anything that nests through a parentId — resource folders, wiki pages — shares this.
export interface TreeNode { id: number; parentId: number | null }

export interface Tree<T extends TreeNode> {
  byId: Map<number, T>
  children: (parent: number | null) => T[]
  /** Ids from the top level down to (and including) this one. */
  lineage: (id: number) => number[]
  /** The node and everything nested inside it — what a move must never land in. */
  subtree: (id: number) => Set<number>
  /** Every node in tree order, with its depth. */
  ordered: { node: T; depth: number }[]
}

/** `sort` orders siblings; left out, they keep the order they came in. */
export function buildTree<T extends TreeNode>(nodes: T[], sort?: (a: T, b: T) => number): Tree<T> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const kids = new Map<number | null, T[]>()
  for (const n of nodes) {
    // A parent that no longer exists means top level.
    const parent = n.parentId != null && byId.has(n.parentId) ? n.parentId : null
    kids.set(parent, [...(kids.get(parent) ?? []), n])
  }
  if (sort) for (const list of kids.values()) list.sort(sort)
  const children = (parent: number | null) => kids.get(parent) ?? []

  const lineage = (id: number) => {
    const out: number[] = []
    // The guard stops a parent loop from hanging the app, however it got into the data.
    for (let cur = byId.get(id); cur && out.length < 100; cur = cur.parentId != null ? byId.get(cur.parentId) : undefined) out.unshift(cur.id)
    return out
  }
  const subtree = (id: number) => {
    const out = new Set<number>([id])
    const walk = (p: number) => children(p).forEach((c) => (out.add(c.id), walk(c.id)))
    walk(id)
    return out
  }
  const ordered: Tree<T>['ordered'] = []
  const walk = (p: number | null, depth: number) => children(p).forEach((n) => (ordered.push({ node: n, depth }), walk(n.id, depth + 1)))
  walk(null, 0)

  return { byId, children, lineage, subtree, ordered }
}
