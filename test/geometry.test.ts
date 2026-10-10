import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MIN_H, MIN_W, centred, clamp, escaped } from '../web/src/desk/geometry.ts'

const desk = { width: 1200, height: 800 }

test('a window already inside is left where it is', () => {
  assert.deepEqual(clamp({ x: 100, y: 50, w: 400, h: 300 }, desk), { x: 100, y: 50, w: 400, h: 300 })
})

test('a window above or left of the desk is pulled back in', () => {
  // This is the one that matters: a negative top puts the title bar under the app's top bar.
  assert.deepEqual(clamp({ x: -300, y: -200, w: 400, h: 300 }, desk), { x: 0, y: 0, w: 400, h: 300 })
})

test('a window past the right or bottom edge is pulled back wholly, not just its title bar', () => {
  assert.deepEqual(clamp({ x: 1150, y: 790, w: 400, h: 300 }, desk), { x: 800, y: 500, w: 400, h: 300 })
})

test('a window bigger than the desk is shrunk, and then still fits', () => {
  const r = clamp({ x: 40, y: 40, w: 2000, h: 2000 }, desk)
  assert.deepEqual(r, { x: 0, y: 0, w: 1200, h: 800 })
})

test('a desk smaller than the smallest window still puts it at the origin', () => {
  // The window can't shrink below its minimum, but its top-left must stay reachable.
  const r = clamp({ x: 50, y: 50, w: 400, h: 300 }, { width: 100, height: 90 })
  assert.deepEqual(r, { x: 0, y: 0, w: MIN_W, h: MIN_H })
})

test('whatever goes in, the result never starts above or left of the desk', () => {
  const desks = [{ width: 1200, height: 800 }, { width: 320, height: 200 }, { width: 0, height: 0 }]
  for (const d of desks) {
    for (const r of [
      { x: -9999, y: -9999, w: 10, h: 10 }, { x: 9999, y: 9999, w: 9999, h: 9999 },
      { x: 0, y: -1, w: 800, h: 600 }, { x: -1, y: 0, w: 1, h: 1 },
    ]) {
      const out = clamp(r, d)
      assert.ok(out.x >= 0 && out.y >= 0, `x and y stay positive for ${JSON.stringify(r)}`)
      assert.ok(out.w >= MIN_W && out.h >= MIN_H, 'it keeps a usable size')
    }
  }
})

test('maximized windows keep that flag through a clamp', () => {
  assert.equal(clamp({ x: 0, y: 0, w: 400, h: 300, max: true }, desk).max, true)
})

test('centring puts a window in the middle, inside the desk', () => {
  assert.deepEqual(centred(desk, { x: -500, y: -500, w: 400, h: 300 }), { x: 400, y: 250, w: 400, h: 300 })
})

test('centring a window larger than the desk fills it from the origin', () => {
  assert.deepEqual(centred(desk, { x: 0, y: 0, w: 5000, h: 5000 }), { x: 0, y: 0, w: 1200, h: 800 })
})

const box = (top: number, left: number, w: number, h: number) =>
  ({ top, left, right: left + w, bottom: top + h }) as DOMRect

test('escaping is noticed on every edge, and rounding is forgiven', () => {
  const area = box(64, 0, 1200, 800)
  assert.equal(escaped(box(64, 0, 400, 300), area), false)
  assert.equal(escaped(box(63.5, 0, 400, 300), area), false, 'half a pixel is not an escape')
  assert.equal(escaped(box(10, 0, 400, 300), area), true, 'above the desk, under the top bar')
  assert.equal(escaped(box(64, -40, 400, 300), area), true)
  assert.equal(escaped(box(64, 900, 400, 300), area), true)
  assert.equal(escaped(box(700, 0, 400, 300), area), true)
})
