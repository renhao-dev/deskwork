import { test } from 'node:test'
import assert from 'node:assert/strict'
import { linkAddress, linksIn, parseLink, refreshLinkText } from '../shared/links.ts'

test('addresses round-trip', () => {
  assert.equal(linkAddress({ kind: 'goal', id: 7 }), 'deskwork:goal/7')
  assert.equal(linkAddress({ kind: 'book', id: 12, page: 137 }), 'deskwork:book/12/137')
  assert.deepEqual(parseLink('deskwork:page/42'), { kind: 'page', id: 42 })
  assert.deepEqual(parseLink('deskwork:book/12/137'), { kind: 'book', id: 12, page: 137 })
  assert.equal(parseLink('https://example.com'), null)
  assert.equal(parseLink('deskwork:nonsense/1'), null)
})

test('links are found in a note, without repeats', () => {
  const body = 'See [Verbs](deskwork:page/42) and [Learn Hebrew](deskwork:goal/7).\nAgain: [Verbs](deskwork:page/42).'
  assert.deepEqual(linksIn(body), [{ kind: 'page', id: 42 }, { kind: 'goal', id: 7 }])
})

test('ordinary links are left alone', () => {
  assert.deepEqual(linksIn('[a](https://example.com) and ![img](/api/note-images/x)'), [])
})

test('link text follows the current name', () => {
  const body = '[Old name](deskwork:goal/7) and [p. 137](deskwork:book/12/137)'
  const out = refreshLinkText(body, (ref) => (ref.kind === 'goal' ? 'Hebrew B1' : 'Some book'))
  assert.equal(out, '[Hebrew B1](deskwork:goal/7) and [p. 137](deskwork:book/12/137)')
})

test('a target that is gone keeps the text that was typed', () => {
  const body = '[Deleted goal](deskwork:goal/9)'
  assert.equal(refreshLinkText(body, () => null), body)
})
