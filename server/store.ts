import { randomUUID } from 'node:crypto'
import { HTTPException } from 'hono/http-exception'
import { all, get, run, tx } from './db.ts'
import { dayKey } from '../shared/day.ts'
import { settle, type TimerState } from '../shared/timer.ts'
import { reorderSubset } from '../shared/order.ts'
import { createGoalSpace } from './spaces.ts'
import type {
  AttachedResource, BookmarkInput, Comment, ResourceUse, CompleteInput, CompleteResult, Completion, Dashboard, Goal,
  ItemDetail, ItemType, Resource, ResourceFolder, Task, TimerMode, User, WorkSession,
} from '../shared/types.ts'

export const fail = (status: 400 | 403 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message })
}

export const today = (u: User, now = Date.now()) => dayKey(now, u.settings.timezone, u.settings.dayStartHour)
const dayOf = (u: User, ts: number) => dayKey(ts, u.settings.timezone, u.settings.dayStartHour)

// ---------- goals ----------

interface GoalRow {
  id: number; title: string; description: string; budget_minutes: number; points_target: number | null
  points_done: number; space_id: number | null; archived_at: number | null; created_at: number; updated_at: number
  today_seconds: number; completed_today: number
}

const toGoal = (r: GoalRow): Goal => ({
  id: r.id, title: r.title, description: r.description, budgetMinutes: r.budget_minutes, pointsTarget: r.points_target,
  pointsDone: r.points_done, spaceId: r.space_id, archivedAt: r.archived_at, createdAt: r.created_at, updatedAt: r.updated_at,
  todaySeconds: r.today_seconds, completedToday: !!r.completed_today,
})

const GOAL_SELECT = `
  SELECT g.*,
    COALESCE((SELECT SUM(seconds) FROM work_sessions w WHERE w.item_type = 'goal' AND w.item_id = g.id AND w.day = ?), 0) AS today_seconds,
    EXISTS (SELECT 1 FROM completions c WHERE c.item_type = 'goal' AND c.item_id = g.id AND c.day = ?) AS completed_today
  FROM goals g`

export function listGoals(u: User): Goal[] {
  const d = today(u)
  return all<GoalRow>(`${GOAL_SELECT} WHERE g.user_id = ? ORDER BY g.archived_at IS NOT NULL, g.sort_order, g.created_at`, d, d, u.id).map(toGoal)
}

export function getGoal(u: User, id: number): Goal {
  const d = today(u)
  const row = get<GoalRow>(`${GOAL_SELECT} WHERE g.user_id = ? AND g.id = ?`, d, d, u.id, id)
  return row ? toGoal(row) : fail(404, 'This goal no longer exists')
}

export interface GoalInput { title?: string; description?: string; budgetMinutes?: number; pointsTarget?: number | null }

function cleanGoal(input: GoalInput, partial: boolean) {
  const out: GoalInput = {}
  if (input.title !== undefined || !partial) {
    out.title = String(input.title ?? '').trim()
    if (!out.title) fail(400, 'Give the goal a title')
  }
  if (input.description !== undefined) out.description = String(input.description)
  if (input.budgetMinutes !== undefined || !partial) {
    const b = Math.round(Number(input.budgetMinutes))
    if (!Number.isFinite(b) || b < 1 || b > 24 * 60) fail(400, 'Daily budget must be between 1 minute and 24 hours')
    out.budgetMinutes = b
  }
  if (input.pointsTarget !== undefined) {
    const p = input.pointsTarget == null || (input.pointsTarget as unknown) === '' ? null : Math.round(Number(input.pointsTarget))
    if (p !== null && (!Number.isFinite(p) || p < 1)) fail(400, 'Points target must be a positive number, or empty')
    out.pointsTarget = p
  }
  return out
}

export function createGoal(u: User, input: GoalInput): Goal {
  const g = cleanGoal(input, false)
  const now = Date.now()
  // New goals go to the bottom of the list.
  const r = run(
    `INSERT INTO goals (user_id, title, description, budget_minutes, points_target, created_at, updated_at, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM goals WHERE user_id = ?))`,
    u.id, g.title!, g.description ?? '', g.budgetMinutes!, g.pointsTarget ?? null, now, now, u.id,
  )
  const id = Number(r.lastInsertRowid)
  // Every goal writes into a wiki space of its own, made here so nothing ever has to be filed.
  createGoalSpace(u, id, g.title!)
  return getGoal(u, id)
}

/** Puts the given tasks in this order; the ones left out keep their places. */
export function reorderTasks(u: User, ids: number[]) {
  reorderItems(u, 'tasks', ids)
}

/**
 * Puts the given goals in this order. They're usually just the ones on today's list, so the goals
 * not shown (done today, archived) keep their places and the given ones fill the slots between them.
 */
export function reorderGoals(u: User, ids: number[]) {
  reorderItems(u, 'goals', ids)
}

function reorderItems(u: User, table: 'goals' | 'tasks', ids: number[]) {
  const all_ = all<{ id: number }>(`SELECT id FROM ${table} WHERE user_id = ? ORDER BY sort_order, created_at`, u.id).map((r) => r.id)
  const given = ids.map(Number)
  if (new Set(given).size !== given.length || given.some((id) => !all_.includes(id))) {
    fail(400, `That list of ${table} is out of date. Reload and try again.`)
  }
  const order = reorderSubset(all_, given)
  tx(() => order.forEach((id, i) => run(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, i + 1, id)))
}

export function updateGoal(u: User, id: number, input: GoalInput & { pointsDone?: number; archived?: boolean }): Goal {
  getGoal(u, id)
  const g = cleanGoal(input, true)
  const sets: string[] = []
  const vals: (string | number | null)[] = []
  if (g.title !== undefined) sets.push('title = ?'), vals.push(g.title)
  if (g.description !== undefined) sets.push('description = ?'), vals.push(g.description)
  if (g.budgetMinutes !== undefined) sets.push('budget_minutes = ?'), vals.push(g.budgetMinutes)
  if (g.pointsTarget !== undefined) sets.push('points_target = ?'), vals.push(g.pointsTarget)
  if (input.pointsDone !== undefined) {
    const p = Math.round(Number(input.pointsDone))
    if (!Number.isFinite(p) || p < 0) fail(400, 'Points done cannot be negative')
    sets.push('points_done = ?'), vals.push(p)
  }
  if (input.archived !== undefined) {
    sets.push('archived_at = ?'), vals.push(input.archived ? Date.now() : null)
    if (input.archived) stopTimerIfOn(u, 'goal', id)
  }
  if (sets.length) run(`UPDATE goals SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`, ...vals, Date.now(), id, u.id)
  if (g.title) renameTimerItem(u, 'goal', id, g.title)
  return getGoal(u, id)
}

// ---------- tasks ----------

interface TaskRow {
  id: number; title: string; description: string; scheduled_day: string | null; completed_at: number | null
  created_at: number; updated_at: number; total_seconds: number
}

const toTask = (r: TaskRow): Task => ({
  id: r.id, title: r.title, description: r.description, scheduledDay: r.scheduled_day, completedAt: r.completed_at,
  createdAt: r.created_at, updatedAt: r.updated_at, totalSeconds: r.total_seconds,
})

const TASK_SELECT = `
  SELECT t.*,
    COALESCE((SELECT SUM(seconds) FROM work_sessions w WHERE w.item_type = 'task' AND w.item_id = t.id), 0) AS total_seconds
  FROM tasks t`

export function listTasks(u: User): Task[] {
  return all<TaskRow>(`${TASK_SELECT} WHERE t.user_id = ? ORDER BY t.completed_at IS NOT NULL, t.completed_at DESC, t.sort_order, t.created_at`, u.id).map(toTask)
}

export function getTask(u: User, id: number): Task {
  const row = get<TaskRow>(`${TASK_SELECT} WHERE t.user_id = ? AND t.id = ?`, u.id, id)
  return row ? toTask(row) : fail(404, 'This task no longer exists')
}

export interface TaskInput { title?: string; description?: string; scheduledDay?: string | null; reopen?: boolean }

function cleanDay(v: string | null | undefined) {
  if (v == null || v === '') return null
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fail(400, 'Use a date like 2026-09-21')
}

export function createTask(u: User, input: TaskInput): Task {
  const title = String(input.title ?? '').trim()
  if (!title) fail(400, 'Give the task a title')
  const now = Date.now()
  // A new task goes to the top of the list.
  const r = run(
    `INSERT INTO tasks (user_id, title, description, scheduled_day, created_at, updated_at, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MIN(sort_order), 1) - 1 FROM tasks WHERE user_id = ?))`,
    u.id, title, String(input.description ?? ''), cleanDay(input.scheduledDay), now, now, u.id,
  )
  return getTask(u, Number(r.lastInsertRowid))
}

export function updateTask(u: User, id: number, input: TaskInput): Task {
  getTask(u, id)
  const sets: string[] = []
  const vals: (string | number | null)[] = []
  if (input.title !== undefined) {
    const t = String(input.title).trim()
    if (!t) fail(400, 'Give the task a title')
    sets.push('title = ?'), vals.push(t)
    renameTimerItem(u, 'task', id, t)
  }
  if (input.description !== undefined) sets.push('description = ?'), vals.push(String(input.description))
  if (input.scheduledDay !== undefined) sets.push('scheduled_day = ?'), vals.push(cleanDay(input.scheduledDay))
  if (input.reopen) sets.push('completed_at = NULL')
  if (sets.length) run(`UPDATE tasks SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`, ...vals, Date.now(), id, u.id)
  return getTask(u, id)
}

// ---------- shared item helpers ----------

export function assertItem(u: User, type: ItemType, id: number) {
  const table = type === 'goal' ? 'goals' : 'tasks'
  const row = get<{ title: string }>(`SELECT title FROM ${table} WHERE id = ? AND user_id = ?`, id, u.id)
  return row ?? fail(404, `This ${type} no longer exists`)
}

export function deleteItem(u: User, type: ItemType, id: number) {
  assertItem(u, type, id)
  tx(() => {
    stopTimerIfOn(u, type, id)
    run(`DELETE FROM ${type === 'goal' ? 'goals' : 'tasks'} WHERE id = ? AND user_id = ?`, id, u.id)
    run('DELETE FROM comments WHERE item_type = ? AND item_id = ? AND user_id = ?', type, id, u.id)
    run('DELETE FROM item_resources WHERE item_type = ? AND item_id = ?', type, id)
  })
}

export function itemDetail(u: User, type: ItemType, id: number): ItemDetail<Goal | Task> {
  const item = type === 'goal' ? getGoal(u, id) : getTask(u, id)
  const comments = all<{ id: number; body: string; created_at: number }>(
    'SELECT id, body, created_at FROM comments WHERE item_type = ? AND item_id = ? AND user_id = ? ORDER BY created_at DESC',
    type, id, u.id,
  ).map((c): Comment => ({ id: c.id, body: c.body, createdAt: c.created_at }))
  const last = get<{ resource_id: number }>(
    `SELECT wsr.resource_id FROM work_session_resources wsr JOIN work_sessions ws ON ws.id = wsr.work_session_id
     WHERE ws.user_id = ? AND ws.item_type = ? AND ws.item_id = ? ORDER BY ws.started_at DESC, wsr.rowid LIMIT 1`,
    u.id, type, id,
  )
  return { item, comments, resources: attachedResources(u, type, id), lastResourceId: last?.resource_id ?? null }
}

export function addComment(u: User, type: ItemType, id: number, body: string): Comment {
  assertItem(u, type, id)
  const text = String(body ?? '').trim()
  if (!text) fail(400, 'Write something before adding a comment')
  const now = Date.now()
  const r = run('INSERT INTO comments (user_id, item_type, item_id, body, created_at) VALUES (?, ?, ?, ?, ?)', u.id, type, id, text, now)
  return { id: Number(r.lastInsertRowid), body: text, createdAt: now }
}

export function deleteComment(u: User, commentId: number) {
  run('DELETE FROM comments WHERE id = ? AND user_id = ?', commentId, u.id)
}

// ---------- timer ----------

function readTimer(u: User): TimerState | null {
  const row = get<{ state: string }>('SELECT state FROM timers WHERE user_id = ?', u.id)
  return row ? (JSON.parse(row.state) as TimerState) : null
}

function writeTimer(u: User, t: TimerState | null) {
  if (t) run('INSERT INTO timers (user_id, state) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET state = excluded.state', u.id, JSON.stringify(t))
  else run('DELETE FROM timers WHERE user_id = ?', u.id)
}

export function currentTimer(u: User): TimerState | null {
  const t = readTimer(u)
  return t ? settle(t, Date.now()) : null
}

function renameTimerItem(u: User, type: ItemType, id: number, title: string) {
  const t = readTimer(u)
  if (t && t.itemType === type && t.itemId === id) writeTimer(u, { ...t, itemTitle: title })
}

export function startTimer(u: User, type: ItemType, id: number, mode: TimerMode): TimerState {
  return tx(() => {
    const existing = currentTimer(u)
    if (existing) fail(409, `You're working on “${existing.itemTitle}” right now`)
    let budgetMs: number | null = null
    let title: string
    if (type === 'goal') {
      const g = getGoal(u, id)
      if (g.archivedAt) fail(409, 'This goal is archived')
      if (g.completedToday) fail(409, 'This goal is already done for today')
      // May be zero or less: then the timer starts straight into overtime.
      budgetMs = g.budgetMinutes * 60_000 - g.todaySeconds * 1000
      title = g.title
    } else {
      const t = getTask(u, id)
      if (t.completedAt) fail(409, 'This task is already completed')
      title = t.title
    }
    const now = Date.now()
    const state: TimerState = {
      id: randomUUID(), itemType: type, itemId: id, itemTitle: title, mode: mode === 'pomodoro' ? 'pomodoro' : 'regular',
      pomodoro: u.settings.pomodoro, startedAt: now, status: 'running', phase: 'work', settledAt: now,
      phaseElapsed: 0, round: 0, workMs: 0, budgetMs,
    }
    writeTimer(u, state)
    return state
  })
}

export function pauseTimer(u: User): TimerState {
  const t = currentTimer(u) ?? fail(409, 'No timer is running')
  if (t.status !== 'running') return t
  const next: TimerState = { ...t, status: 'paused' }
  writeTimer(u, next)
  return next
}

export function resumeTimer(u: User): TimerState {
  const t = currentTimer(u) ?? fail(409, 'No timer is running')
  if (t.status !== 'paused') return t
  const next: TimerState = { ...t, status: 'running', settledAt: Date.now() }
  writeTimer(u, next)
  return next
}

/** Ends the timer and logs the work done. */
export function stopTimer(u: User): WorkSession | null {
  return tx(() => {
    const t = currentTimer(u)
    if (!t) return null
    writeTimer(u, null)
    return logWork(u, t)
  })
}

function stopTimerIfOn(u: User, type: ItemType, id: number) {
  const t = currentTimer(u)
  if (t && t.itemType === type && t.itemId === id) {
    writeTimer(u, null)
    logWork(u, t)
  }
}

function logWork(u: User, t: TimerState): WorkSession | null {
  const seconds = Math.round(t.workMs / 1000)
  if (seconds < 1) return null
  const endedAt = Date.now()
  const day = dayOf(u, t.startedAt)
  const r = run(
    'INSERT INTO work_sessions (user_id, item_type, item_id, item_title, mode, started_at, ended_at, seconds, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    u.id, t.itemType, t.itemId, t.itemTitle, t.mode, t.startedAt, endedAt, seconds, day,
  )
  const sessionId = Number(r.lastInsertRowid)
  const resources = Object.values(t.used ?? {})
  for (const x of resources) {
    run(
      `INSERT INTO work_session_resources (work_session_id, resource_id, title, kind, from_seconds, to_seconds, from_index, to_index, from_page, to_page)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sessionId, x.resourceId, x.title, x.kind, x.fromSeconds, x.toSeconds, x.fromIndex, x.toIndex, x.fromPage, x.toPage,
    )
  }
  return {
    id: sessionId, itemType: t.itemType, itemId: t.itemId, itemTitle: t.itemTitle, mode: t.mode,
    startedAt: t.startedAt, endedAt, seconds, day, resources,
  }
}

/**
 * Notes that a resource was used during the running timer on this item. `to` is how far you got;
 * without it the resource only counts as opened. The starting point is the saved position at first use.
 */
export function noteResourceUse(u: User, type: ItemType, id: number, resourceId: number,
  to?: { seconds?: number | null; videoIndex?: number | null; page?: number | null }) {
  const t = readTimer(u)
  if (!t || t.itemType !== type || t.itemId !== id) return
  const row = get<{ title: string; kind: Resource['kind']; bookmark_seconds: number | null; bookmark_index: number | null; bookmark_page: number | null }>(
    `SELECT r.title, r.kind, ir.bookmark_seconds, ir.bookmark_index, ir.bookmark_page
     FROM item_resources ir JOIN resources r ON r.id = ir.resource_id
     WHERE ir.item_type = ? AND ir.item_id = ? AND ir.resource_id = ? AND r.user_id = ?`,
    type, id, resourceId, u.id,
  )
  if (!row) return
  const key = String(resourceId)
  const use: ResourceUse = t.used?.[key] ?? {
    resourceId, title: row.title, kind: row.kind,
    fromSeconds: row.bookmark_seconds, toSeconds: null, fromIndex: row.bookmark_index, toIndex: null,
    fromPage: row.bookmark_page, toPage: null,
  }
  if (to?.seconds !== undefined) use.toSeconds = to.seconds
  if (to?.videoIndex !== undefined) use.toIndex = to.videoIndex
  if (to?.page !== undefined) use.toPage = to.page
  writeTimer(u, { ...t, used: { ...t.used, [key]: use } })
}

/** A start set by hand before anything was watched moves where this session's range begins. */
function moveUseStart(u: User, type: ItemType, id: number, resourceId: number, b: BookmarkInput) {
  const t = readTimer(u)
  const use = t?.used?.[String(resourceId)]
  if (!t || t.itemType !== type || t.itemId !== id || !use || use.toSeconds != null || use.toPage != null) return
  if (b.seconds !== undefined) use.fromSeconds = b.seconds ?? null
  if (b.videoIndex !== undefined) use.fromIndex = b.videoIndex ?? null
  if (b.page !== undefined) use.fromPage = b.page ?? null
  writeTimer(u, { ...t, used: { ...t.used, [String(resourceId)]: use } })
}

interface SessionRow extends WorkRow { user_id: number }

function sessionRow(u: User, id: number) {
  return get<SessionRow>('SELECT * FROM work_sessions WHERE id = ? AND user_id = ?', id, u.id) ?? fail(404, 'This session no longer exists')
}

/** Keeps a day's completion figure in step after its sessions are edited. */
function syncCompletionSeconds(u: User, type: ItemType, itemId: number, day: string) {
  const total = get<{ s: number }>(
    'SELECT COALESCE(SUM(seconds), 0) AS s FROM work_sessions WHERE user_id = ? AND item_type = ? AND item_id = ? AND day = ?',
    u.id, type, itemId, day,
  )!.s
  run('UPDATE completions SET seconds = ? WHERE user_id = ? AND item_type = ? AND item_id = ? AND day = ?', total, u.id, type, itemId, day)
}

const MAX_SESSION = 24 * 3600

/** Time worked away from Deskwork, added by hand. */
export function addWorkSession(u: User, type: ItemType, id: number, seconds: number, day?: string): WorkSession {
  const { title } = assertItem(u, type, id)
  const secs = Math.round(Number(seconds))
  if (!Number.isFinite(secs) || secs < 1 || secs > MAX_SESSION) fail(400, 'Enter between 1 minute and 24 hours')
  const endedAt = Date.now()
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : today(u, endedAt)
  const r = run(
    'INSERT INTO work_sessions (user_id, item_type, item_id, item_title, mode, started_at, ended_at, seconds, day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    u.id, type, id, title, 'manual', endedAt - secs * 1000, endedAt, secs, d,
  )
  syncCompletionSeconds(u, type, id, d)
  return { id: Number(r.lastInsertRowid), itemType: type, itemId: id, itemTitle: title, mode: 'manual', startedAt: endedAt - secs * 1000, endedAt, seconds: secs, day: d, resources: [] }
}

export function updateWorkSession(u: User, id: number, seconds: number) {
  const row = sessionRow(u, id)
  const secs = Math.round(Number(seconds))
  if (!Number.isFinite(secs) || secs < 1 || secs > MAX_SESSION) fail(400, 'Enter between 1 minute and 24 hours')
  run('UPDATE work_sessions SET seconds = ?, ended_at = ? WHERE id = ?', secs, row.started_at + secs * 1000, id)
  syncCompletionSeconds(u, row.item_type, row.item_id, row.day)
}

export function deleteWorkSession(u: User, id: number) {
  const row = sessionRow(u, id)
  run('DELETE FROM work_sessions WHERE id = ?', id)
  syncCompletionSeconds(u, row.item_type, row.item_id, row.day)
}

// ---------- completion ----------

interface CompletionRow {
  id: number; item_type: ItemType; item_id: number; item_title: string; completed_at: number; day: string
  seconds: number; points: number | null; comment: string; via: 'timer' | 'manual'
}

const toCompletion = (r: CompletionRow): Completion => ({
  id: r.id, itemType: r.item_type, itemId: r.item_id, itemTitle: r.item_title, completedAt: r.completed_at, day: r.day,
  seconds: r.seconds, points: r.points, comment: r.comment, via: r.via,
})

/**
 * Makes the logged time add up to `target`: tops it up with time entered by hand, or trims the
 * newest sessions (removing any that reach zero). `day` is null for a task's whole history.
 */
function setLoggedSeconds(u: User, type: ItemType, id: number, day: string | null, target: number) {
  if (!Number.isFinite(target) || target < 0 || target > 24 * 3600) fail(400, 'Time must be between zero and 24 hours')
  const rows = all<{ id: number; seconds: number }>(
    `SELECT id, seconds FROM work_sessions WHERE user_id = ? AND item_type = ? AND item_id = ? ${day ? 'AND day = ?' : ''}
     ORDER BY started_at DESC`,
    u.id, type, id, ...(day ? [day] : []),
  )
  const current = rows.reduce((s, r) => s + r.seconds, 0)
  if (target === current) return
  if (target > current) {
    addWorkSession(u, type, id, target - current, day ?? undefined)
    return
  }
  let excess = current - target
  for (const r of rows) {
    if (excess <= 0) break
    if (r.seconds <= excess) {
      run('DELETE FROM work_sessions WHERE id = ?', r.id)
      excess -= r.seconds
    } else {
      run('UPDATE work_sessions SET seconds = ?, ended_at = started_at + ? WHERE id = ?', r.seconds - excess, (r.seconds - excess) * 1000, r.id)
      excess = 0
    }
  }
}

export function completeItem(u: User, type: ItemType, id: number, input: CompleteInput): CompleteResult {
  return tx(() => {
    const { title } = assertItem(u, type, id)
    // Save "stopped at" first so it's part of the session logged when the timer stops.
    for (const b of input.bookmarks ?? []) saveBookmark(u, type, id, b)
    stopTimerIfOn(u, type, id)
    const now = Date.now()
    const day = today(u, now)
    let points: number | null = null
    let targetReached = false
    let seconds: number

    if (type === 'goal') {
      const g = getGoal(u, id)
      if (g.archivedAt) fail(409, 'This goal is archived')
      if (g.completedToday) fail(409, 'This goal is already done for today')
      seconds = g.todaySeconds
      if (input.seconds != null) {
        setLoggedSeconds(u, type, id, day, Math.round(Number(input.seconds)))
        seconds = Math.round(Number(input.seconds))
      }
      if (g.pointsTarget != null && input.points != null && `${input.points}` !== '') {
        points = Math.round(Number(input.points))
        if (!Number.isFinite(points) || points < 0) fail(400, 'Points must be zero or more')
        const total = g.pointsDone + points
        run('UPDATE goals SET points_done = ?, updated_at = ? WHERE id = ?', total, now, id)
        targetReached = g.pointsDone < g.pointsTarget && total >= g.pointsTarget
      }
    } else {
      const t = getTask(u, id)
      if (t.completedAt) fail(409, 'This task is already completed')
      seconds = t.totalSeconds
      if (input.seconds != null) {
        setLoggedSeconds(u, type, id, null, Math.round(Number(input.seconds)))
        seconds = Math.round(Number(input.seconds))
      }
      run('UPDATE tasks SET completed_at = ?, updated_at = ? WHERE id = ?', now, now, id)
    }

    const comment = String(input.comment ?? '').trim()
    if (comment) addComment(u, type, id, comment)

    const r = run(
      'INSERT INTO completions (user_id, item_type, item_id, item_title, completed_at, day, seconds, points, comment, via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      u.id, type, id, title, now, day, seconds, points, comment, input.via === 'timer' ? 'timer' : 'manual',
    )
    const completion = toCompletion(get<CompletionRow>('SELECT * FROM completions WHERE id = ?', Number(r.lastInsertRowid))!)
    return { completion, targetReached }
  })
}

/**
 * Takes back a completion: the goal returns to today's list and its points are given back, or the
 * task reopens. Time already logged stays.
 */
/** The completion to take back for this item: today's for a goal, the last one for a task. */
export function latestCompletionId(u: User, type: ItemType, id: number): number {
  const row = type === 'goal'
    ? get<{ id: number }>('SELECT id FROM completions WHERE user_id = ? AND item_type = ? AND item_id = ? AND day = ?', u.id, type, id, today(u))
    : get<{ id: number }>('SELECT id FROM completions WHERE user_id = ? AND item_type = ? AND item_id = ? ORDER BY completed_at DESC LIMIT 1', u.id, type, id)
  return row?.id ?? fail(404, 'This one isn’t marked completed')
}

export function undoCompletion(u: User, id: number): { itemType: ItemType; itemId: number; itemTitle: string; stillArchived: boolean } {
  return tx(() => {
    const c = get<CompletionRow>('SELECT * FROM completions WHERE id = ? AND user_id = ?', id, u.id) ?? fail(404, 'That entry no longer exists')
    run('DELETE FROM completions WHERE id = ?', id)
    let stillArchived = false
    if (c.item_type === 'goal') {
      if (c.points) run('UPDATE goals SET points_done = MAX(0, points_done - ?), updated_at = ? WHERE id = ? AND user_id = ?', c.points, Date.now(), c.item_id, u.id)
      stillArchived = !!get<{ archived_at: number | null }>('SELECT archived_at FROM goals WHERE id = ? AND user_id = ?', c.item_id, u.id)?.archived_at
    } else {
      run('UPDATE tasks SET completed_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?', Date.now(), c.item_id, u.id)
    }
    return { itemType: c.item_type, itemId: c.item_id, itemTitle: c.item_title, stillArchived }
  })
}

// ---------- resources ----------

interface ResourceRow {
  id: number; kind: Resource['kind']; title: string; author: string; url: string; note: string; total_pages: number | null
  video_source: Resource['videoSource']; file_path: string | null; file_name: string | null; file_mime: string | null
  file_size: number | null; folder_id: number | null; created_at: number
}

const toResource = (r: ResourceRow): Resource => ({
  id: r.id, kind: r.kind, title: r.title, author: r.author, url: r.url, note: r.note, totalPages: r.total_pages,
  videoSource: r.video_source, fileName: r.file_name, fileSize: r.file_size, hasFile: !!r.file_path, folderId: r.folder_id, createdAt: r.created_at,
})

export function listResources(u: User): Resource[] {
  return all<ResourceRow>('SELECT * FROM resources WHERE user_id = ? ORDER BY created_at DESC', u.id).map(toResource)
}

export function resourceRow(u: User, id: number): ResourceRow {
  return get<ResourceRow>('SELECT * FROM resources WHERE id = ? AND user_id = ?', id, u.id) ?? fail(404, 'This resource no longer exists')
}

export const getResource = (u: User, id: number) => toResource(resourceRow(u, id))

export interface ResourceInput {
  kind?: Resource['kind']; title?: string; author?: string; url?: string; note?: string
  totalPages?: number | null; videoSource?: Resource['videoSource']; folderId?: number | null
}

const KINDS = ['pdf', 'physical', 'link', 'note', 'video'] as const

function cleanResource(u: User, input: ResourceInput) {
  const out: Record<string, string | number | null> = {}
  if (input.kind !== undefined) out.kind = KINDS.includes(input.kind) ? input.kind : fail(400, 'Unknown resource kind')
  if (input.title !== undefined) out.title = String(input.title).trim() || fail(400, 'Give the resource a title')
  if (input.author !== undefined) out.author = String(input.author).trim()
  if (input.url !== undefined) out.url = String(input.url).trim()
  if (input.note !== undefined) out.note = String(input.note)
  if (input.totalPages !== undefined) {
    const p = input.totalPages == null || (input.totalPages as unknown) === '' ? null : Math.round(Number(input.totalPages))
    out.total_pages = p !== null && (!Number.isFinite(p) || p < 1) ? fail(400, 'Page count must be a positive number') : p
  }
  if (input.videoSource !== undefined) out.video_source = input.videoSource
  if (input.folderId !== undefined) {
    const f = input.folderId == null || (input.folderId as unknown) === '' ? null : Number(input.folderId)
    if (f !== null) folderRow(u, f)
    out.folder_id = f
  }
  return out
}

export function createResource(u: User, input: ResourceInput): Resource {
  if (!input.kind) fail(400, 'Choose what kind of resource this is')
  if (!String(input.title ?? '').trim()) fail(400, 'Give the resource a title')
  const r = cleanResource(u, input)
  const cols = Object.keys(r)
  const res = run(
    `INSERT INTO resources (user_id, ${cols.join(', ')}, created_at) VALUES (?, ${cols.map(() => '?').join(', ')}, ?)`,
    u.id, ...Object.values(r), Date.now(),
  )
  return getResource(u, Number(res.lastInsertRowid))
}

export function updateResource(u: User, id: number, input: ResourceInput): Resource {
  resourceRow(u, id)
  const r = cleanResource(u, input)
  const cols = Object.keys(r)
  if (cols.length) run(`UPDATE resources SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ? AND user_id = ?`, ...Object.values(r), id, u.id)
  return getResource(u, id)
}

// ---------- resource folders ----------
// Folders nest: each has an optional parent. Names only need to be unique among siblings.

interface FolderRow { id: number; name: string; parent_id: number | null; created_at: number }

const folderRow = (u: User, id: number) =>
  get<FolderRow>('SELECT * FROM resource_folders WHERE id = ? AND user_id = ?', id, u.id) ?? fail(404, 'This folder no longer exists')

const toFolder = (r: FolderRow): ResourceFolder => ({ id: r.id, name: r.name, parentId: r.parent_id, createdAt: r.created_at })

function cleanFolderName(u: User, name: string, parentId: number | null, exceptId?: number) {
  const n = name.trim()
  if (!n) fail(400, 'Give the folder a name')
  if (n.length > 80) fail(400, 'Folder names can be up to 80 characters')
  const dupe = get<{ id: number }>(
    'SELECT id FROM resource_folders WHERE user_id = ? AND name = ? COLLATE NOCASE AND parent_id IS ?', u.id, n, parentId)
  if (dupe && dupe.id !== exceptId) fail(409, `There's already a folder called “${n}” here`)
  return n
}

function cleanParent(u: User, parentId: unknown): number | null {
  if (parentId == null || parentId === '') return null
  return folderRow(u, Number(parentId)).id
}

export function listFolders(u: User): ResourceFolder[] {
  return all<FolderRow>('SELECT * FROM resource_folders WHERE user_id = ? ORDER BY name COLLATE NOCASE', u.id).map(toFolder)
}

export function createFolder(u: User, input: { name?: string; parentId?: number | null }): ResourceFolder {
  const parent = cleanParent(u, input.parentId)
  const r = run('INSERT INTO resource_folders (user_id, name, parent_id, created_at) VALUES (?, ?, ?, ?)',
    u.id, cleanFolderName(u, String(input.name ?? ''), parent), parent, Date.now())
  return toFolder(folderRow(u, Number(r.lastInsertRowid)))
}

/** Rename and/or move a folder. A folder can't move into itself or anything inside it. */
export function updateFolder(u: User, id: number, input: { name?: string; parentId?: number | null }): ResourceFolder {
  const cur = folderRow(u, id)
  const parent = input.parentId !== undefined ? cleanParent(u, input.parentId) : cur.parent_id
  for (let p = parent; p != null; p = folderRow(u, p).parent_id) {
    if (p === id) fail(400, "A folder can't go inside itself or one of its own subfolders")
  }
  const name = cleanFolderName(u, input.name !== undefined ? String(input.name) : cur.name, parent, id)
  run('UPDATE resource_folders SET name = ?, parent_id = ? WHERE id = ?', name, parent, id)
  return toFolder(folderRow(u, id))
}

/** Deletes only the folder: its subfolders and resources move up one level, so nothing is lost. */
export function deleteFolder(u: User, id: number) {
  const f = folderRow(u, id)
  tx(() => {
    // A subfolder moving up may clash with a sibling's name; keep it distinguishable instead of failing.
    for (const child of all<FolderRow>('SELECT * FROM resource_folders WHERE parent_id = ?', id)) {
      let name = child.name
      for (let n = 2; get('SELECT 1 FROM resource_folders WHERE user_id = ? AND name = ? COLLATE NOCASE AND parent_id IS ? AND id != ?',
        u.id, name, f.parent_id, id); n++) name = `${child.name} (${n})`
      run('UPDATE resource_folders SET parent_id = ?, name = ? WHERE id = ?', f.parent_id, name, child.id)
    }
    run('UPDATE resources SET folder_id = ? WHERE folder_id = ?', f.parent_id, id)
    run('DELETE FROM resource_folders WHERE id = ?', id)
  })
}

export function setResourceFile(u: User, id: number, file: { path: string; name: string; mime: string; size: number } | null) {
  const prev = resourceRow(u, id).file_path
  run('UPDATE resources SET file_path = ?, file_name = ?, file_mime = ?, file_size = ? WHERE id = ?',
    file?.path ?? null, file?.name ?? null, file?.mime ?? null, file?.size ?? null, id)
  return prev
}

/** Returns the stored file path (if any) so the caller can remove it from disk. */
export function deleteResource(u: User, id: number): string | null {
  const row = resourceRow(u, id)
  run('DELETE FROM resources WHERE id = ?', id)
  return row.file_path
}

interface AttachedRow extends ResourceRow {
  bookmark_page: number | null; bookmark_seconds: number | null; bookmark_index: number | null; bookmark_updated_at: number | null
  sync_timer: number | null
}

export function attachedResources(u: User, type: ItemType, id: number): AttachedResource[] {
  return all<AttachedRow>(
    `SELECT r.*, ir.bookmark_page, ir.bookmark_seconds, ir.bookmark_index, ir.bookmark_updated_at, ir.sync_timer
     FROM item_resources ir JOIN resources r ON r.id = ir.resource_id
     WHERE ir.item_type = ? AND ir.item_id = ? AND r.user_id = ? ORDER BY ir.attached_at`,
    type, id, u.id,
  ).map((r) => ({
    ...toResource(r),
    bookmark: { page: r.bookmark_page, seconds: r.bookmark_seconds, videoIndex: r.bookmark_index, updatedAt: r.bookmark_updated_at },
    syncTimer: r.sync_timer == null ? null : !!r.sync_timer,
  }))
}

/** Per goal-and-video preference: whether the video follows the timer. */
export function setResourcePrefs(u: User, type: ItemType, id: number, resourceId: number, prefs: { syncTimer?: boolean | null }) {
  assertItem(u, type, id)
  if (prefs.syncTimer !== undefined) {
    run('UPDATE item_resources SET sync_timer = ? WHERE item_type = ? AND item_id = ? AND resource_id = ?',
      prefs.syncTimer == null ? null : prefs.syncTimer ? 1 : 0, type, id, resourceId)
  }
}

export function attachResource(u: User, type: ItemType, id: number, resourceId: number) {
  assertItem(u, type, id)
  resourceRow(u, resourceId)
  run('INSERT OR IGNORE INTO item_resources (item_type, item_id, resource_id, attached_at) VALUES (?, ?, ?, ?)', type, id, resourceId, Date.now())
}

export function detachResource(u: User, type: ItemType, id: number, resourceId: number) {
  assertItem(u, type, id)
  run('DELETE FROM item_resources WHERE item_type = ? AND item_id = ? AND resource_id = ?', type, id, resourceId)
}

export function saveBookmark(u: User, type: ItemType, id: number, b: BookmarkInput) {
  assertItem(u, type, id)
  const sets: string[] = []
  const vals: (number | null)[] = []
  const num = (v: unknown) => (v == null || v === '' ? null : Math.max(0, Number(v)))
  const rid = Number(b.resourceId)
  // Progress made while the timer runs is logged with the session; a start set by hand is not.
  if (b.manual) moveUseStart(u, type, id, rid, b)
  else {
    noteResourceUse(u, type, id, rid, {
      ...(b.seconds !== undefined ? { seconds: num(b.seconds) } : {}),
      ...(b.videoIndex !== undefined ? { videoIndex: num(b.videoIndex) } : {}),
      ...(b.page !== undefined ? { page: num(b.page) == null ? null : Math.round(num(b.page)!) } : {}),
    })
  }
  if (b.page !== undefined) sets.push('bookmark_page = ?'), vals.push(num(b.page) == null ? null : Math.round(num(b.page)!))
  if (b.seconds !== undefined) sets.push('bookmark_seconds = ?'), vals.push(num(b.seconds))
  if (b.videoIndex !== undefined) sets.push('bookmark_index = ?'), vals.push(num(b.videoIndex))
  if (!sets.length) return
  run(
    `UPDATE item_resources SET ${sets.join(', ')}, bookmark_updated_at = ? WHERE item_type = ? AND item_id = ? AND resource_id = ?`,
    ...vals, Date.now(), type, id, Number(b.resourceId),
  )
}

// ---------- dashboard & history ----------

export function dashboard(u: User): Dashboard {
  const d = today(u)
  const goals = listGoals(u).filter((g) => !g.archivedAt && !g.completedToday)
  const tasks = listTasks(u).filter((t) => !t.completedAt && (!t.scheduledDay || t.scheduledDay <= d))
  const completions = all<CompletionRow>('SELECT * FROM completions WHERE user_id = ? AND day = ? ORDER BY completed_at DESC', u.id, d).map(toCompletion)
  const todaySeconds = get<{ s: number }>('SELECT COALESCE(SUM(seconds), 0) AS s FROM work_sessions WHERE user_id = ? AND day = ?', u.id, d)!.s
  return { today: d, goals, tasks, completions, todaySeconds, timer: currentTimer(u) }
}

interface WorkRow {
  id: number; item_type: ItemType; item_id: number; item_title: string; mode: TimerMode
  started_at: number; ended_at: number; seconds: number; day: string
}

export function workHistory(u: User, before: string | undefined, days = 14, type?: ItemType, itemId?: number) {
  const typeSql = type ? `AND item_type = ?${itemId != null ? ' AND item_id = ?' : ''}` : ''
  const typeArg: (string | number)[] = type ? (itemId != null ? [type, itemId] : [type]) : []
  const dayList = all<{ day: string }>(
    `SELECT DISTINCT day FROM work_sessions WHERE user_id = ? AND day < ? ${typeSql} ORDER BY day DESC LIMIT ?`,
    u.id, before ?? '9999-99-99', ...typeArg, days + 1,
  ).map((r) => r.day)
  const hasMore = dayList.length > days
  const shown = dayList.slice(0, days)
  if (!shown.length) return { days: [], nextBefore: null }
  const rows = all<WorkRow>(
    `SELECT * FROM work_sessions WHERE user_id = ? AND day >= ? AND day <= ? ${typeSql} ORDER BY started_at DESC`,
    u.id, shown[shown.length - 1], shown[0], ...typeArg,
  )
  const used = new Map<number, ResourceUse[]>()
  if (rows.length) {
    const uses = all<{
      work_session_id: number; resource_id: number; title: string; kind: Resource['kind']
      from_seconds: number | null; to_seconds: number | null; from_index: number | null; to_index: number | null
      from_page: number | null; to_page: number | null
    }>(`SELECT * FROM work_session_resources WHERE work_session_id IN (${rows.map(() => '?').join(', ')}) ORDER BY rowid`, ...rows.map((r) => r.id))
    for (const x of uses) {
      used.set(x.work_session_id, [...(used.get(x.work_session_id) ?? []), {
        resourceId: x.resource_id, title: x.title, kind: x.kind, fromSeconds: x.from_seconds, toSeconds: x.to_seconds,
        fromIndex: x.from_index, toIndex: x.to_index, fromPage: x.from_page, toPage: x.to_page,
      }])
    }
  }
  const byDay = new Map<string, WorkSession[]>(shown.map((d) => [d, []]))
  for (const r of rows) {
    byDay.get(r.day)?.push({
      id: r.id, itemType: r.item_type, itemId: r.item_id, itemTitle: r.item_title, mode: r.mode,
      startedAt: r.started_at, endedAt: r.ended_at, seconds: r.seconds, day: r.day, resources: used.get(r.id) ?? [],
    })
  }
  // For one item, each day also shows its completion (points and comment).
  const completionsByDay = new Map<string, Completion[]>()
  if (type && itemId != null) {
    const done = all<CompletionRow>(
      'SELECT * FROM completions WHERE user_id = ? AND item_type = ? AND item_id = ? AND day >= ? AND day <= ? ORDER BY completed_at DESC',
      u.id, type, itemId, shown[shown.length - 1], shown[0],
    )
    for (const c of done) completionsByDay.set(c.day, [...(completionsByDay.get(c.day) ?? []), toCompletion(c)])
  }
  return {
    days: shown.map((day) => {
      const sessions = byDay.get(day)!
      return { day, seconds: sessions.reduce((s, x) => s + x.seconds, 0), sessions, completions: completionsByDay.get(day) ?? [] }
    }),
    nextBefore: hasMore ? shown[shown.length - 1] : null,
  }
}

/** Sessions of one goal or task, with totals for the top of its Sessions tab. */
export function itemSessions(u: User, type: ItemType, id: number, before?: string) {
  assertItem(u, type, id)
  const totals = get<{ seconds: number; count: number }>(
    'SELECT COALESCE(SUM(seconds), 0) AS seconds, COUNT(*) AS count FROM work_sessions WHERE user_id = ? AND item_type = ? AND item_id = ?',
    u.id, type, id,
  )!
  // "Last 7 days" rather than "this week": no need to guess where your week starts.
  const weekAgo = today(u, Date.now() - 6 * 86_400_000)
  const week = get<{ seconds: number }>(
    'SELECT COALESCE(SUM(seconds), 0) AS seconds FROM work_sessions WHERE user_id = ? AND item_type = ? AND item_id = ? AND day >= ?',
    u.id, type, id, weekAgo,
  )!
  return { totals: { seconds: totals.seconds, count: totals.count, last7Seconds: week.seconds }, ...workHistory(u, before, 14, type, id) }
}

export function completionHistory(u: User, opts: { type?: ItemType; order: 'asc' | 'desc'; offset: number; limit: number }) {
  const typeSql = opts.type ? 'AND item_type = ?' : ''
  const rows = all<CompletionRow>(
    `SELECT * FROM completions WHERE user_id = ? ${typeSql} ORDER BY completed_at ${opts.order === 'asc' ? 'ASC' : 'DESC'}, id ${opts.order === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`,
    u.id, ...(opts.type ? [opts.type] : []), opts.limit + 1, opts.offset,
  )
  return {
    items: rows.slice(0, opts.limit).map(toCompletion),
    nextOffset: rows.length > opts.limit ? opts.offset + opts.limit : null,
  }
}
