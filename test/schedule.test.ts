import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysBetween, scheduleLabel } from '../shared/day.ts'

const today = '2026-10-03'

test('a task scheduled for today says so', () => {
  assert.deepEqual(scheduleLabel(today, today), { text: 'Today', tone: 'today' })
})

test('days that have passed read as late', () => {
  assert.deepEqual(scheduleLabel('2026-10-02', today), { text: 'Yesterday', tone: 'late' })
  assert.deepEqual(scheduleLabel('2026-09-30', today), { text: '3 days late', tone: 'late' })
})

test('days ahead read as a date, and tomorrow by name', () => {
  assert.deepEqual(scheduleLabel('2026-10-04', today), { text: 'Tomorrow', tone: 'future' })
  assert.equal(scheduleLabel('2026-10-12', today)?.tone, 'future')
})

test('a task with no day has no label', () => {
  assert.equal(scheduleLabel(null, today), null)
})

test('day differences cross months and years', () => {
  assert.equal(daysBetween('2026-09-30', '2026-10-03'), 3)
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1)
})
