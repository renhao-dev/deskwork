import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slugify, uniqueSlug } from '../shared/slug.ts'

test('slugify makes a readable url piece', () => {
  assert.equal(slugify('Romanian grammar(Ru book)'), 'romanian-grammar-ru-book')
  assert.equal(slugify('  Spaced  out  '), 'spaced-out')
  assert.equal(slugify('Café résumé'), 'cafe-resume')
})

test('slugify keeps other scripts', () => {
  assert.equal(slugify('עברית מדוברת'), 'עברית-מדוברת')
})

test('slugify falls back when nothing survives', () => {
  assert.equal(slugify('***'), 'untitled')
  assert.equal(slugify('', 'note-7'), 'note-7')
})

test('slugify never ends in a dash after trimming to length', () => {
  const s = slugify(`${'a'.repeat(59)} bbb`)
  assert.equal(s.length <= 60, true)
  assert.equal(s.endsWith('-'), false)
})

test('uniqueSlug counts up past what is taken', () => {
  assert.equal(uniqueSlug('Work', []), 'work')
  assert.equal(uniqueSlug('Work', ['work']), 'work-2')
  assert.equal(uniqueSlug('Work', ['work', 'work-2']), 'work-3')
})
