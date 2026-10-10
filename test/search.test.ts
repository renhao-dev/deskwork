import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchQuery } from '../shared/search.ts'
import { plainText } from '../shared/markdown.ts'

test('every word must appear, and the last one matches as a prefix', () => {
  assert.equal(searchQuery('hebrew verb'), '"hebrew" "verb"*')
  assert.equal(searchQuery('  Spaced   Out '), '"spaced" "out"*')
})

test('punctuation cannot break the query', () => {
  assert.equal(searchQuery('c++ "quoted" -dash'), '"c" "quoted" "dash"*')
  assert.equal(searchQuery('AND OR NOT'), '"and" "or" "not"*')
  assert.equal(searchQuery('***'), null)
  assert.equal(searchQuery(''), null)
})

test('other scripts survive', () => {
  assert.equal(searchQuery('פועל חזק'), '"פועל" "חזק"*')
})

test('plain text keeps the words and drops the markup', () => {
  assert.equal(plainText('**bold** and _thin_'), 'bold and thin')
  assert.equal(plainText('[Udemy](https://udemy.com/dynamics-365)'), 'Udemy')
  assert.equal(plainText('# Heading\n- one\n- two'), 'Heading one two')
  assert.equal(plainText('text\n```\ncode here\n```\nmore'), 'text more')
  assert.equal(plainText('![shot](/api/note-images/abc)'), '')
})
