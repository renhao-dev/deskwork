// The task list as rows: tasks on their own, and folders holding tasks. Kept apart from the
// components so the rules for dragging can be tested.
import type { TaskLayoutEntry } from '../../../shared/types.ts'

export interface LaidTask { id: number; folderId: number | null; scheduledDay: string | null }

/** One row at the top level of the list. */
export type Entry<T extends LaidTask = LaidTask> =
  | { kind: 'task'; task: T }
  | { kind: 'folder'; folderId: number; tasks: T[] }

/** Names a row: a task (wherever it is) or a folder. */
export interface Ref { kind: 'task' | 'folder'; id: number }
export type DropPos = 'before' | 'inside' | 'after'
export type Section = 'due' | 'today' | 'rest'

export const sameRef = (a: Ref, b: Ref) => a.kind === b.kind && a.id === b.id
export const refOf = (e: Entry): Ref => (e.kind === 'task' ? { kind: 'task', id: e.task.id } : { kind: 'folder', id: e.folderId })

/** Every task in the rows, top to bottom, folders opened up. */
export const flatten = <T extends LaidTask>(entries: Entry<T>[]): T[] => entries.flatMap((e) => (e.kind === 'task' ? [e.task] : e.tasks))

/** Groups a flat list of tasks into rows. A folder sits where its first task is. */
export function buildEntries<T extends LaidTask>(tasks: T[]): Entry<T>[] {
  const out: Entry<T>[] = []
  const folders = new Map<number, T[]>()
  for (const t of tasks) {
    if (t.folderId === null) out.push({ kind: 'task', task: t })
    else if (folders.has(t.folderId)) folders.get(t.folderId)!.push(t)
    else {
      const list = [t]
      folders.set(t.folderId, list)
      out.push({ kind: 'folder', folderId: t.folderId, tasks: list })
    }
  }
  return out
}

export const sectionOfTask = (t: LaidTask, day: string): Section =>
  t.scheduledDay === null || t.scheduledDay > day ? 'rest' : t.scheduledDay < day ? 'due' : 'today'

/** A folder goes where its most pressing task would: Due before Today before the rest. */
export function sectionOfEntry(e: Entry, day: string): Section {
  if (e.kind === 'task') return sectionOfTask(e.task, day)
  const sections = e.tasks.map((t) => sectionOfTask(t, day))
  return sections.includes('due') ? 'due' : sections.includes('today') ? 'today' : 'rest'
}

export const toLayout = (entries: Entry[]): TaskLayoutEntry[] =>
  entries.map((e) => (e.kind === 'task' ? { task: e.task.id } : { folder: e.folderId, tasks: e.tasks.map((t) => t.id) }))

/**
 * What dropping `drag` on `target` would do, given how far down the target row the pointer is
 * (`share`, 0 at its top edge to 1 at its bottom), or null when it can't be dropped there.
 *
 * - On a task that stands alone: the middle makes a folder of the two; the edges put it beside.
 * - On a folder: the middle puts the task in it; the edges put it beside.
 * - On a task inside a folder: beside it, in that folder.
 *
 * "Beside" is only offered within one section, because the section a row shows in comes from its
 * day, not from where it was dropped. An open folder has no "after" edge: its tasks are there.
 */
export function dropPos(entries: Entry[], day: string, drag: Ref, target: Ref, share: number, targetOpen = false): DropPos | null {
  if (sameRef(drag, target)) return null
  const half: DropPos = share < 0.5 ? 'before' : 'after'
  const top = entries.find((e) => sameRef(refOf(e), target))
  if (drag.kind === 'folder') {
    // Folders don't nest, so a folder only moves among the top-level rows.
    const self = entries.find((e) => sameRef(refOf(e), drag))
    if (!self || !top || sectionOfEntry(self, day) !== sectionOfEntry(top, day)) return null
    return half === 'after' && top.kind === 'folder' && targetOpen ? null : half
  }
  const task = flatten(entries).find((t) => t.id === drag.id)
  if (!task) return null
  if (!top) return target.kind === 'task' ? half : null
  const beside = sectionOfTask(task, day) === sectionOfEntry(top, day)
  if (beside && share < 0.26) return 'before'
  if (beside && share > 0.74 && !(top.kind === 'folder' && targetOpen)) return 'after'
  return top.kind === 'folder' && task.folderId === top.folderId ? null : 'inside'
}

/**
 * The rows after dropping `drag` at `pos` relative to `target`. Dropping one lone task onto another
 * needs a new folder, which only the server can make, so that case returns the two task ids
 * instead (`group`: the task dropped on, then the dragged one). Returns null when nothing changes.
 */
export function applyDrop<T extends LaidTask>(
  entries: Entry<T>[], drag: Ref, target: Ref, pos: DropPos,
): Entry<T>[] | { group: [number, number] } | null {
  if (sameRef(drag, target)) return null
  const targetIsTop = entries.some((e) => sameRef(refOf(e), target))
  if (pos === 'inside' && target.kind === 'task') {
    return drag.kind === 'task' && targetIsTop ? { group: [target.id, drag.id] } : null
  }
  if (drag.kind === 'folder' && (pos === 'inside' || !targetIsTop)) return null

  // Lift the dragged row out of wherever it is, then put it back in one place.
  let found: Entry<T> | undefined
  const rest: Entry<T>[] = []
  for (const e of entries) {
    if (sameRef(refOf(e), drag)) found = e
    else if (e.kind === 'folder' && drag.kind === 'task' && e.tasks.some((t) => t.id === drag.id)) {
      found = { kind: 'task', task: e.tasks.find((t) => t.id === drag.id)! }
      rest.push({ ...e, tasks: e.tasks.filter((t) => t.id !== drag.id) })
    } else rest.push(e)
  }
  if (!found) return null
  const lifted = found
  const into = (folderId: number | null): T[] => (lifted.kind === 'task' ? [{ ...lifted.task, folderId }] : [])

  let placed = false
  const out = rest.flatMap((e): Entry<T>[] => {
    if (sameRef(refOf(e), target)) {
      placed = true
      if (pos === 'inside') return e.kind === 'folder' ? [{ ...e, tasks: [...e.tasks, ...into(e.folderId)] }] : [e]
      const moved: Entry<T> = lifted.kind === 'task' ? { kind: 'task', task: into(null)[0] } : lifted
      return pos === 'before' ? [moved, e] : [e, moved]
    }
    if (e.kind === 'folder' && target.kind === 'task') {
      const at = e.tasks.findIndex((t) => t.id === target.id)
      if (at >= 0) {
        placed = true
        const tasks = e.tasks.slice()
        tasks.splice(pos === 'before' ? at : at + 1, 0, ...into(e.folderId))
        return [{ ...e, tasks }]
      }
    }
    return [e]
  }).filter((e) => e.kind === 'task' || e.tasks.length > 0) // a folder left with nothing goes away
  if (!placed) return null
  return JSON.stringify(toLayout(out)) === JSON.stringify(toLayout(entries)) ? null : out
}

/**
 * The rows with a new task put just before or after `target`. Beside a task in a folder, it joins
 * that folder; beside a top-level row, it stands alone. Null when the target isn't in the rows.
 */
export function placeNew<T extends LaidTask>(entries: Entry<T>[], task: T, target: Ref, pos: 'before' | 'after'): Entry<T>[] | null {
  const atEnd: Entry<T>[] = [...entries, { kind: 'task', task }]
  const out = applyDrop(atEnd, { kind: 'task', id: task.id }, target, pos)
  if (Array.isArray(out)) return out
  // "Nothing changes" when the spot asked for is the very end, which is where it started.
  const last = entries.at(-1)
  return pos === 'after' && last && sameRef(refOf(last), target) ? atEnd : null
}

/**
 * The rows after moving one a step up (-1) or down (1) with the keyboard: a task in a folder moves
 * among that folder's tasks, anything else among the rows of its section. Null at either end.
 */
export function nudge<T extends LaidTask>(entries: Entry<T>[], day: string, ref: Ref, dir: -1 | 1): Entry<T>[] | null {
  const pos: DropPos = dir < 0 ? 'before' : 'after'
  const self = entries.find((e) => sameRef(refOf(e), ref))
  let neighbour: Ref | undefined
  if (self) {
    const peers = entries.filter((e) => sectionOfEntry(e, day) === sectionOfEntry(self, day))
    const next = peers[peers.indexOf(self) + dir]
    neighbour = next && refOf(next)
  } else {
    const folder = entries.find((e) => e.kind === 'folder' && ref.kind === 'task' && e.tasks.some((t) => t.id === ref.id))
    if (folder?.kind !== 'folder') return null
    const next = folder.tasks[folder.tasks.findIndex((t) => t.id === ref.id) + dir]
    neighbour = next && { kind: 'task', id: next.id }
  }
  const out = neighbour ? applyDrop(entries, ref, neighbour, pos) : null
  return Array.isArray(out) ? out : null
}
