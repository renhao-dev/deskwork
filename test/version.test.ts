import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewer } from '../server/version.ts'

test('versions compare by number, not as text', () => {
  assert.ok(isNewer('0.2.0', '0.1.9'))
  assert.ok(isNewer('1.2.10', '1.2.9'))
  assert.ok(isNewer('v1.0.0', '0.9.0'))
  assert.ok(!isNewer('0.1.0', '0.1.0'))
  assert.ok(!isNewer('0.1.0', '0.2.0'))
})
