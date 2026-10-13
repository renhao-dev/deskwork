import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyDrop, buildEntries, dropPos, flatten, nudge, placeNew, sectionOfEntry, toLayout, type Entry } from '../web/src/items/taskLayout.ts'

const DAY = '2026-10-12'
const task = (id: number, folderId: number | null = null, scheduledDay: string | null = null) => ({ id, folderId, scheduledDay })
const T = (id: number) => ({ kind: 'task' as const, id })
const F = (id: number) => ({ kind: 'folder' as const, id })

//  1
//  folder 7: 2, 3
//  4
const rows = () => buildEntries([task(1), task(2, 7), task(3, 7), task(4)])
/** "1 7[2 3] 4": the rows in a line. */
const show = (entries: Entry[] | { group: [number, number] } | null) =>
  Array.isArray(entries)
    ? toLayout(entries).map((e) => ('folder' in e ? `${e.folder}[${e.tasks.join(' ')}]` : String(e.task))).join(' ')
    : entries

test('a flat list of tasks becomes rows, with each folder where its first task is', () => {
  assert.equal(show(rows()), '1 7[2 3] 4')
  // Tasks of one folder are gathered even if something got between them.
  assert.equal(show(buildEntries([task(2, 7), task(1), task(3, 7)])), '7[2 3] 1')
})

test('dropping a task on the middle of another makes a folder of the two', () => {
  assert.equal(dropPos(rows(), DAY, T(4), T(1), 0.5), 'inside')
  assert.deepEqual(applyDrop(rows(), T(4), T(1), 'inside'), { group: [1, 4] })
  // A task taken from a folder can start a new one too.
  assert.deepEqual(applyDrop(rows(), T(2), T(4), 'inside'), { group: [4, 2] })
})

test('dropping on the edge of a row puts the task beside it instead', () => {
  assert.equal(dropPos(rows(), DAY, T(4), T(1), 0.1), 'before')
  assert.equal(dropPos(rows(), DAY, T(4), T(1), 0.9), 'after')
  assert.equal(show(applyDrop(rows(), T(4), T(1), 'before')), '4 1 7[2 3]')
  assert.equal(applyDrop(rows(), T(1), T(4), 'before') && show(applyDrop(rows(), T(1), T(4), 'before')), '7[2 3] 1 4')
})

test('dropping on a folder puts the task in it, at the end', () => {
  assert.equal(dropPos(rows(), DAY, T(1), F(7), 0.5), 'inside')
  const out = applyDrop(rows(), T(1), F(7), 'inside') as Entry[]
  assert.equal(show(out), '7[2 3 1] 4')
  assert.equal(flatten(out).find((t) => t.id === 1)!.folderId, 7, 'the task now knows its folder')
  // A task that is already in the folder has nowhere to go by dropping on it.
  assert.equal(dropPos(rows(), DAY, T(2), F(7), 0.5, true), null)
})

test('dropping beside a task in a folder puts it in that folder, at that spot', () => {
  assert.equal(dropPos(rows(), DAY, T(4), T(3), 0.2), 'before')
  assert.equal(show(applyDrop(rows(), T(4), T(3), 'before')), '1 7[2 4 3]')
  assert.equal(show(applyDrop(rows(), T(3), T(2), 'before')), '1 7[3 2] 4')
  // There is no middle: tasks in a folder can't hold other tasks.
  assert.equal(dropPos(rows(), DAY, T(4), T(3), 0.5), 'after')
})

test('dragging a task out of a folder frees it, and the last one out removes the folder', () => {
  const one = applyDrop(rows(), T(2), T(4), 'after') as Entry[]
  assert.equal(show(one), '1 7[3] 4 2')
  assert.equal(flatten(one).find((t) => t.id === 2)!.folderId, null)
  assert.equal(show(applyDrop(one, T(3), T(1), 'before')), '3 1 4 2')
})

test('a folder moves as one row, and never into anything', () => {
  assert.equal(show(applyDrop(rows(), F(7), T(1), 'before')), '7[2 3] 1 4')
  assert.equal(show(applyDrop(rows(), F(7), T(4), 'after')), '1 4 7[2 3]')
  assert.equal(dropPos(rows(), DAY, F(7), T(1), 0.5), 'after', 'no "inside" for a folder')
  const two = buildEntries([task(1, 8), task(2, 7), task(3, 7), task(4, 8)])
  assert.equal(dropPos(two, DAY, F(7), T(1), 0.5), null, 'not among the tasks of another folder')
  assert.equal(applyDrop(two, F(7), F(8), 'inside'), null)
})

test('an open folder takes rows before it or in it, not after its heading', () => {
  assert.equal(dropPos(rows(), DAY, T(4), F(7), 0.9, false), 'after')
  assert.equal(dropPos(rows(), DAY, T(4), F(7), 0.9, true), 'inside')
  assert.equal(dropPos(rows(), DAY, T(4), F(7), 0.1, true), 'before')
})

test('a drop that would change nothing is not a drop', () => {
  assert.equal(applyDrop(rows(), T(1), F(7), 'before'), null)
  assert.equal(applyDrop(rows(), T(2), T(3), 'before'), null)
  assert.equal(applyDrop(rows(), T(1), T(1), 'inside'), null)
  assert.equal(dropPos(rows(), DAY, T(1), T(1), 0.5), null)
})

test('a folder shows in the section of its most pressing task', () => {
  const late = buildEntries([task(1, 7), task(2, 7, '2026-10-01'), task(3, 7, DAY)])[0]
  assert.equal(sectionOfEntry(late, DAY), 'due')
  assert.equal(sectionOfEntry(buildEntries([task(1, 7), task(3, 7, DAY)])[0], DAY), 'today')
  assert.equal(sectionOfEntry(buildEntries([task(1, 7)])[0], DAY), 'rest')
})

test('across sections a task can join a folder or start one, but not be put beside a row', () => {
  // 1 is for today, 2 has no day: they show in different sections.
  const mixed = buildEntries([task(1, null, DAY), task(2), task(3, 7, DAY), task(4, 7, DAY)])
  assert.equal(dropPos(mixed, DAY, T(2), T(1), 0.05), 'inside')
  assert.equal(dropPos(mixed, DAY, T(2), F(7), 0.05), 'inside')
  assert.equal(dropPos(mixed, DAY, T(2), T(3), 0.05), 'before', 'beside a task in a folder is still fine')
  assert.equal(dropPos(mixed, DAY, F(7), T(2), 0.3), null, 'a folder stays in its section')
})

test('the keyboard moves a row one step within its section, or a task within its folder', () => {
  assert.equal(show(nudge(rows(), DAY, T(1), 1)), '7[2 3] 1 4')
  assert.equal(show(nudge(rows(), DAY, F(7), -1)), '7[2 3] 1 4')
  assert.equal(show(nudge(rows(), DAY, T(3), -1)), '1 7[3 2] 4')
  assert.equal(nudge(rows(), DAY, T(1), -1), null)
  assert.equal(nudge(rows(), DAY, T(3), 1), null, 'the keyboard does not carry a task out of its folder')
  // A row in another section is not a neighbour.
  const mixed = buildEntries([task(1, null, DAY), task(2), task(3)])
  assert.equal(nudge(mixed, DAY, T(1), 1), null)
  assert.equal(show(nudge(mixed, DAY, T(2), 1)), '1 3 2')
})

test('a new task is put on the line that was clicked: on its own, or in the folder', () => {
  // 0 is the task being made.
  assert.equal(show(placeNew(rows(), task(0), T(1), 'before')), '0 1 7[2 3] 4')
  assert.equal(show(placeNew(rows(), task(0), F(7), 'before')), '1 0 7[2 3] 4')
  assert.equal(show(placeNew(rows(), task(0), F(7), 'after')), '1 7[2 3] 0 4')
  assert.equal(show(placeNew(rows(), task(0), T(4), 'after')), '1 7[2 3] 4 0')
  // Beside a task of a folder it joins that folder.
  assert.equal(show(placeNew(rows(), task(0), T(2), 'before')), '1 7[0 2 3] 4')
  assert.equal(show(placeNew(rows(), task(0), T(3), 'before')), '1 7[2 0 3] 4')
  assert.equal(show(placeNew(rows(), task(0), T(3), 'after')), '1 7[2 3 0] 4')
  assert.equal(flatten(placeNew(rows(), task(0), T(3), 'after')!).find((t) => t.id === 0)!.folderId, 7)
  // A row that is gone by now.
  assert.equal(placeNew(rows(), task(0), T(99), 'before'), null)
})
