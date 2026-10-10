import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keyHex, newDataKey, newSalt, sameKey, unwrap, wipe, wrap, wrappingKey } from '../server/keys.ts'

test('a wrapped key comes back only with the right password', () => {
  const salt = newSalt()
  const dataKey = newDataKey()
  const blob = wrap(dataKey, wrappingKey('correct horse', salt))

  assert.equal(sameKey(unwrap(blob, wrappingKey('correct horse', salt))!, dataKey), true)
  assert.equal(unwrap(blob, wrappingKey('wrong horse', salt)), null)
  assert.equal(unwrap(blob, wrappingKey('correct horse', newSalt())), null)
})

test('the wrapped blob is detectably tampered with', () => {
  const salt = newSalt()
  const wrapping = wrappingKey('pw', salt)
  const blob = wrap(newDataKey(), wrapping)
  const raw = Buffer.from(blob, 'base64')
  raw[raw.length - 1] ^= 0xff
  assert.equal(unwrap(raw.toString('base64'), wrapping), null)
})

test('the same key wrapped twice looks different', () => {
  const wrapping = wrappingKey('pw', newSalt())
  const dataKey = newDataKey()
  assert.notEqual(wrap(dataKey, wrapping), wrap(dataKey, wrapping))
})

test('a key is 32 bytes, and 64 hex characters for SQLCipher', () => {
  const k = newDataKey()
  assert.equal(k.length, 32)
  assert.match(keyHex(k), /^[0-9a-f]{64}$/)
})

test('wiping leaves nothing behind', () => {
  const k = newDataKey()
  wipe(k)
  assert.equal(k.every((b) => b === 0), true)
})

test('rubbish never throws', () => {
  const wrapping = wrappingKey('pw', newSalt())
  for (const junk of ['', 'not base64 at all!!', Buffer.alloc(4).toString('base64')]) {
    assert.equal(unwrap(junk, wrapping), null)
  }
})
