import { test } from 'node:test'
import assert from 'node:assert/strict'
import { place } from '../web/src/wiki/place.ts'

//  1
//    2
//      3
//  4
const pages = [
  { id: 1, parentId: null },
  { id: 2, parentId: 1 },
  { id: 3, parentId: 2 },
  { id: 4, parentId: null },
]

test('dropping onto a page files it inside, at the end', () => {
  assert.deepEqual(place(pages, 4, 1, 'inside'), [
    { id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 }, { id: 4, parentId: 1 },
  ])
})

test('dropping between two pages makes it their sibling', () => {
  assert.deepEqual(place(pages, 4, 2, 'before'), [
    { id: 1, parentId: null }, { id: 4, parentId: 1 }, { id: 2, parentId: 1 }, { id: 3, parentId: 2 },
  ])
})

test('a page dragged out to the top level loses its parent', () => {
  assert.deepEqual(place(pages, 3, 1, 'after'), [
    { id: 1, parentId: null }, { id: 2, parentId: 1 }, { id: 3, parentId: null }, { id: 4, parentId: null },
  ])
})

test('children come along with their parent', () => {
  const out = place(pages, 2, 4, 'inside')!
  assert.deepEqual(out, [
    { id: 1, parentId: null }, { id: 4, parentId: null }, { id: 2, parentId: 4 }, { id: 3, parentId: 2 },
  ])
})

test('a page cannot be filed inside itself or its own children', () => {
  assert.equal(place(pages, 1, 1, 'inside'), null)
  assert.equal(place(pages, 1, 3, 'inside'), null)
  assert.equal(place(pages, 1, 2, 'after'), null)
})

test('a parent appears before its children, which is what the server requires', () => {
  const out = place(pages, 4, 3, 'inside')!
  const seen = new Set<number>()
  for (const p of out) {
    if (p.parentId !== null) assert.equal(seen.has(p.parentId), true, `parent of ${p.id} comes first`)
    seen.add(p.id)
  }
  assert.equal(out.length, pages.length)
})
