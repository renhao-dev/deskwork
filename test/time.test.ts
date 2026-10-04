import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePosition } from '../shared/time.ts'

test('clock formats', () => {
  assert.deepEqual(parsePosition('42:17'), { seconds: 2537 })
  assert.deepEqual(parsePosition('1:05:00'), { seconds: 3900 })
  assert.deepEqual(parsePosition(' 0:30 '), { seconds: 30 })
})

test('units and bare minutes', () => {
  assert.deepEqual(parsePosition('90m'), { seconds: 5400 })
  assert.deepEqual(parsePosition('1h5m'), { seconds: 3900 })
  assert.deepEqual(parsePosition('1h 5m 30s'), { seconds: 3930 })
  assert.deepEqual(parsePosition('45 min'), { seconds: 2700 })
  assert.deepEqual(parsePosition('90'), { seconds: 5400 })
})

test('YouTube links with timestamps and playlist index', () => {
  assert.deepEqual(parsePosition('https://www.youtube.com/watch?v=abc&t=2537s'), { seconds: 2537 })
  assert.deepEqual(parsePosition('https://youtu.be/abc?t=754'), { seconds: 754 })
  assert.deepEqual(parsePosition('https://www.youtube.com/watch?v=abc&list=PL1&index=3&t=1m5s'), { seconds: 65, videoIndex: 2 })
})

test('empty and nonsense', () => {
  assert.equal(parsePosition('  '), null)
  assert.equal(parsePosition('5:75'), 'invalid')
  assert.equal(parsePosition('soon'), 'invalid')
  assert.equal(parsePosition('1:2:3:4'), 'invalid')
})
