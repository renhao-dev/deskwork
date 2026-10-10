import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildTree } from '../shared/tree.ts'

const nodes = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
  { id: 4, parentId: null },
]

test('children, lineage and subtree', () => {
  const t = buildTree(nodes)
  assert.deepEqual(t.children(null).map((n) => n.id), [1, 4])
  assert.deepEqual(t.children(1).map((n) => n.id), [2])
  assert.deepEqual(t.lineage(3), [1, 2, 3])
  assert.deepEqual([...t.subtree(1)], [1, 2, 3])
  assert.deepEqual([...t.subtree(3)], [3])
})

test('siblings keep their order unless sorted', () => {
  const t = buildTree([{ id: 9, parentId: null }, { id: 5, parentId: null }])
  assert.deepEqual(t.children(null).map((n) => n.id), [9, 5])
  const sorted = buildTree([{ id: 9, parentId: null }, { id: 5, parentId: null }], (a, b) => a.id - b.id)
  assert.deepEqual(sorted.children(null).map((n) => n.id), [5, 9])
})

test('ordered walks depth first, with depths', () => {
  assert.deepEqual(buildTree(nodes).ordered.map((o) => [o.node.id, o.depth]), [[1, 0], [2, 1], [3, 2], [4, 0]])
})

test('a parent that is gone means top level', () => {
  const t = buildTree([{ id: 1, parentId: 99 }])
  assert.deepEqual(t.children(null).map((n) => n.id), [1])
  assert.deepEqual(t.lineage(1), [1])
})

test('a parent loop does not hang', () => {
  const t = buildTree([{ id: 1, parentId: 2 }, { id: 2, parentId: 1 }])
  assert.equal(t.lineage(1).length <= 100, true)
})
