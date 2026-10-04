// Resource folders form a tree through parentId. Shared so the tree logic can be unit tested.
import type { ResourceFolder } from './types.ts'

export interface FolderTree {
  byId: Map<number, ResourceFolder>
  children: (parent: number | null) => ResourceFolder[]
  /** Folder ids from the top level down to (and including) this folder. */
  lineage: (id: number) => number[]
  path: (id: number) => string
  /** The folder and everything nested inside it. */
  subtree: (id: number) => Set<number>
  /** Every folder in tree order, with its depth — for pickers. */
  ordered: { folder: ResourceFolder; depth: number }[]
}

export function buildFolderTree(folders: ResourceFolder[]): FolderTree {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const kids = new Map<number | null, ResourceFolder[]>()
  for (const f of folders) {
    // A parent that no longer exists means top level.
    const parent = f.parentId != null && byId.has(f.parentId) ? f.parentId : null
    kids.set(parent, [...(kids.get(parent) ?? []), f])
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  const children = (parent: number | null) => kids.get(parent) ?? []

  const lineage = (id: number) => {
    const out: number[] = []
    for (let cur = byId.get(id); cur && out.length < 100; cur = cur.parentId != null ? byId.get(cur.parentId) : undefined) out.unshift(cur.id)
    return out
  }
  const subtree = (id: number) => {
    const out = new Set<number>([id])
    const walk = (p: number) => children(p).forEach((c) => (out.add(c.id), walk(c.id)))
    walk(id)
    return out
  }
  const ordered: FolderTree['ordered'] = []
  const walk = (p: number | null, depth: number) => children(p).forEach((f) => (ordered.push({ folder: f, depth }), walk(f.id, depth + 1)))
  walk(null, 0)

  return {
    byId, children, lineage, subtree, ordered,
    path: (id) => lineage(id).map((i) => byId.get(i)!.name).join(' / '),
  }
}
