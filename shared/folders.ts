// Resource folders form a tree through parentId. Shared so the tree logic can be unit tested.
import { buildTree } from './tree.ts'
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
  // Folders read as a filing cabinet, so siblings are alphabetical rather than hand-ordered.
  const tree = buildTree(folders, (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  return {
    byId: tree.byId,
    children: tree.children,
    lineage: tree.lineage,
    subtree: tree.subtree,
    ordered: tree.ordered.map(({ node, depth }) => ({ folder: node, depth })),
    path: (id) => tree.lineage(id).map((i) => tree.byId.get(i)!.name).join(' / '),
  }
}
