import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MarkdownManager } from '@tiptap/markdown'
import { noteExtensions } from '../web/src/notes/extensions.ts'
import { delimiterColumns, hasMarkdownTable, rowCells, tableFor } from '../web/src/notes/tableShortcut.ts'

const markdown = new MarkdownManager({ extensions: noteExtensions })
const roundTrip = (text: string) => markdown.serialize(markdown.parse(text))

test('a table is read as a table', () => {
  const doc = markdown.parse('| Verb | Past |\n| --- | --- |\n| go | went |\n| see | saw |')
  assert.equal(doc.content?.[0]?.type, 'table')
  assert.equal(doc.content?.[0]?.content?.length, 3)
})

test('a table survives being loaded and saved', () => {
  const once = roundTrip('| Verb | Past |\n| --- | --- |\n| go | went |\n| see | saw |')
  assert.match(once, /\|\s*Verb\s*\|\s*Past\s*\|/)
  assert.match(once, /\|\s*see\s*\|\s*saw\s*\|/)
  assert.doesNotMatch(once, /\\\|/)
  assert.equal(roundTrip(once), once)
})

test('typed table lines are recognised', () => {
  assert.deepEqual(rowCells('| Term | Definition |'), ['Term', 'Definition'])
  assert.deepEqual(rowCells('Term | Definition'), ['Term', 'Definition'])
  assert.equal(rowCells('just words'), null)
  assert.equal(delimiterColumns('| --- | :---: |'), 2)
  assert.equal(delimiterColumns('|---|---|---|'), 3)
  assert.equal(delimiterColumns('| -- | --- |'), null)
  assert.equal(delimiterColumns('| Term | Definition |'), null)
})

test('pasted text with a table is noticed, other text is not', () => {
  assert.ok(hasMarkdownTable('Notes\n\n| a | b |\n| --- | --- |\n| 1 | 2 |'))
  assert.ok(!hasMarkdownTable('| a | b |\n| --- |'))
  assert.ok(!hasMarkdownTable('a | b\nno table here'))
})

test('a table made from typed lines saves as Markdown', () => {
  const saved = markdown.serialize({ type: 'doc', content: [tableFor(['Term', 'Definition'])] })
  assert.match(saved, /\|\s*Term\s*\|\s*Definition\s*\|/)
  assert.equal(markdown.parse(saved).content?.[0]?.type, 'table')
})
