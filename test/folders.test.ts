import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildFolderTree } from '../shared/folders.ts'

const f = (id: number, name: string, parentId: number | null = null) => ({ id, name, parentId, createdAt: 0 })
const tree = buildFolderTree([f(1, 'Rust course'), f(2, 'Part 2', 1), f(3, 'part 1', 1), f(4, 'Ownership', 3), f(5, 'Hebrew'), f(6, 'Orphan', 99)])

test('children are sorted by name, ignoring case', () => {
  assert.deepEqual(tree.children(1).map((x) => x.name), ['part 1', 'Part 2'])
})

test('paths and lineage run from the top level down', () => {
  assert.equal(tree.path(4), 'Rust course / part 1 / Ownership')
  assert.deepEqual(tree.lineage(4), [1, 3, 4])
})

test('subtree holds the folder and everything nested in it', () => {
  assert.deepEqual([...tree.subtree(1)].sort(), [1, 2, 3, 4])
  assert.deepEqual([...tree.subtree(5)], [5])
})

test('a folder whose parent is gone shows at the top level', () => {
  assert.ok(tree.children(null).some((x) => x.name === 'Orphan'))
})

test('ordered lists folders depth-first with depths, for pickers', () => {
  assert.deepEqual(tree.ordered.map(({ folder, depth }) => `${depth}:${folder.name}`),
    ['0:Hebrew', '0:Orphan', '0:Rust course', '1:part 1', '2:Ownership', '1:Part 2'])
})
