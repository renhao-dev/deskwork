import { test } from 'node:test'
import assert from 'node:assert/strict'
import { settle, viewTimer, type TimerState } from '../shared/timer.ts'
import { dayKey } from '../shared/day.ts'

const M = 60_000
const base: TimerState = {
  id: 'x', itemType: 'goal', itemId: 1, itemTitle: 't', mode: 'pomodoro', pomodoro: { work: 25, short: 5, long: 15, every: 4 },
  startedAt: 0, status: 'running', phase: 'work', settledAt: 0, phaseElapsed: 0, round: 0, workMs: 0, budgetMs: 60 * M,
}

test('pomodoro moves into a break after a focus round', () => {
  const s = settle(base, 27 * M)
  assert.equal(s.phase, 'short')
  assert.equal(s.workMs, 25 * M)
})

test('breaks do not count toward the budget', () => {
  // 25 work, 5 break, 25 work, 5 break, 10 work = 60 minutes of work after 70 minutes.
  const s = settle(base, 70 * M)
  assert.equal(s.workMs, 60 * M)
  assert.equal(s.status, 'running')
})

test('crossing the budget keeps the timer running, counting overtime', () => {
  const s = settle(base, 80 * M) // ten more minutes of the third focus round
  assert.equal(s.status, 'running')
  assert.equal(s.workMs, 70 * M)
  assert.equal(viewTimer(base, 80 * M).overBudgetSeconds, 10 * 60)
})

test('a regular timer counts up once the budget is crossed', () => {
  const v = viewTimer({ ...base, mode: 'regular' }, 75 * M)
  assert.equal(v.countsDown, false)
  assert.equal(v.phaseLabel, 'Over budget')
  assert.equal(v.clockSeconds, 15 * 60)
  assert.equal(v.workSeconds, 75 * 60)
})

test('a timer started with the budget already spent is over from the start', () => {
  assert.equal(viewTimer({ ...base, mode: 'regular', budgetMs: 0 }, 0).overBudgetSeconds, 0)
})

test('settling in small steps equals one jump', () => {
  let t = base
  for (let x = 1; x <= 70; x++) t = settle(t, x * M)
  assert.deepEqual({ ...t, settledAt: 0 }, { ...settle(base, 70 * M), settledAt: 0 })
})

test('long break after every N rounds', () => {
  assert.equal(settle({ ...base, budgetMs: null }, 116 * M).phase, 'long')
})

test('overtime still takes its pomodoro breaks', () => {
  const s = settle(base, 88 * M) // third round ends at 85, then a break
  assert.equal(s.phase, 'short')
})

test('paused timers do not advance', () => {
  assert.equal(settle({ ...base, status: 'paused' }, 99 * M).workMs, 0)
})

test('regular task timer counts up', () => {
  const v = viewTimer({ ...base, mode: 'regular', budgetMs: null }, 10 * M)
  assert.equal(v.countsDown, false)
  assert.equal(v.clockSeconds, 600)
})

test('work before the day-start hour belongs to the previous day', () => {
  const lateNight = Date.UTC(2026, 8, 22, 1, 30) // 01:30 UTC on the 22nd
  assert.equal(dayKey(lateNight, 'UTC', 4), '2026-09-21')
  assert.equal(dayKey(lateNight, 'UTC', 0), '2026-09-22')
})
