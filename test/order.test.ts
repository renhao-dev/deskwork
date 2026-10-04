import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moveItem, reorderSubset } from '../shared/order.ts'

test('hidden items keep their places; visible ones fill their own slots', () => {
  // A, B(hidden), C, D(hidden), E: reorder the visible A, C, E to E, A, C
  assert.deepEqual(reorderSubset(['A', 'B', 'C', 'D', 'E'], ['E', 'A', 'C']), ['E', 'B', 'A', 'D', 'C'])
})

test('reordering everything is a plain reorder', () => {
  assert.deepEqual(reorderSubset([1, 2, 3], [3, 1, 2]), [3, 1, 2])
})

test('moveItem moves up and down', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(moveItem(['a', 'b', 'c', 'd'], 0, 2), ['b', 'c', 'a', 'd'])
})
