// The timer is stored as timestamps, never as a ticking counter, so it survives
// closed tabs and server restarts. `settle` replays elapsed time deterministically.

import type { ItemType, PomodoroSettings, TimerMode } from './types.ts'

const MIN = 60_000

export type Phase = 'work' | 'short' | 'long'

export interface TimerState {
  id: string
  itemType: ItemType
  itemId: number
  itemTitle: string
  mode: TimerMode
  pomodoro: PomodoroSettings
  startedAt: number
  status: 'running' | 'paused' | 'finished'
  phase: Phase
  /** Moment `phaseElapsed` and `workMs` were last brought up to date. */
  settledAt: number
  phaseElapsed: number
  round: number // finished work rounds
  workMs: number
  /** Remaining goal budget when the timer started; null counts up without limit (tasks). */
  budgetMs: number | null
  /** Resources used so far in this session, by resource id. */
  used?: Record<string, import('./types.ts').ResourceUse>
}

export function phaseLength(t: Pick<TimerState, 'mode' | 'pomodoro'>, phase: Phase): number {
  if (t.mode === 'regular') return phase === 'work' ? Infinity : 0
  const p = t.pomodoro
  return (phase === 'work' ? p.work : phase === 'short' ? p.short : p.long) * MIN
}

/**
 * Bring the timer up to `now`, advancing pomodoro phases. Crossing a goal's daily budget doesn't
 * stop it: the timer keeps counting overtime until the goal is completed or stopped by hand.
 */
export function settle(t: TimerState, now: number): TimerState {
  // A timer stored as "finished" comes from before overtime existed; it simply keeps running.
  if (t.status === 'paused') return t
  let { phase, phaseElapsed, round, workMs } = t
  let avail = Math.max(0, now - t.settledAt)

  for (let guard = 0; guard < 10_000; guard++) {
    const len = phaseLength(t, phase)
    const step = len - phaseElapsed
    if (avail < step) {
      phaseElapsed += avail
      if (phase === 'work') workMs += avail
      break
    }
    if (phase === 'work') {
      workMs += step
      round += 1
      phase = round % Math.max(1, t.pomodoro.every) === 0 ? 'long' : 'short'
    } else {
      phase = 'work'
    }
    avail -= step
    phaseElapsed = 0
  }
  return { ...t, phase, phaseElapsed, round, workMs, status: 'running', settledAt: now }
}

export interface TimerView {
  state: TimerState
  /** Seconds shown on the clock. Counts down for budgets and pomodoro phases, up otherwise. */
  clockSeconds: number
  countsDown: boolean
  workSeconds: number
  phaseLabel: string
  onBreak: boolean
  /** Seconds worked beyond today's budget, once it's crossed. */
  overBudgetSeconds: number | null
}

export function viewTimer(t: TimerState, now: number): TimerView {
  const s = settle(t, now)
  const workSeconds = s.workMs / 1000
  const onBreak = s.phase !== 'work'
  const over = s.budgetMs != null && s.workMs >= s.budgetMs ? (s.workMs - s.budgetMs) / 1000 : null
  const common = { state: s, workSeconds, onBreak, overBudgetSeconds: over }
  if (s.mode === 'pomodoro') {
    const remaining = phaseLength(s, s.phase) - s.phaseElapsed
    const label = onBreak ? (s.phase === 'long' ? 'Long break' : 'Break') : `Focus ${s.round + 1}`
    return { ...common, clockSeconds: remaining / 1000, countsDown: true, phaseLabel: label }
  }
  if (s.budgetMs != null) {
    if (over != null) return { ...common, clockSeconds: over, countsDown: false, phaseLabel: 'Over budget' }
    return { ...common, clockSeconds: (s.budgetMs - s.workMs) / 1000, countsDown: true, phaseLabel: 'Left today' }
  }
  return { ...common, clockSeconds: workSeconds, countsDown: false, phaseLabel: 'Working' }
}
