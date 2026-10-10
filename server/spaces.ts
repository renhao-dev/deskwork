// Spaces are the top of the wiki: one tree of pages each. Every goal gets a space when it's
// created, named after it, and keeps it for good — archiving or deleting the goal leaves the
// space and everything written in it alone, which is the point of writing things down.
import { all, get, run, tx } from './db.ts'
import { fail } from './store.ts'
import { slugify, uniqueSlug } from '../shared/slug.ts'
import type { ItemType, Space, SpaceInput, User } from '../shared/types.ts'

interface SpaceRow {
  id: number; name: string; slug: string; icon: string | null; goal_id: number | null; home_id: number | null
  goal_title: string | null; page_count: number; created_at: number; archived_at: number | null
}

const SPACE_SELECT = `
  SELECT s.*, g.title AS goal_title,
    (SELECT COUNT(*) FROM notes n WHERE n.space_id = s.id AND n.deleted_at IS NULL AND n.id IS NOT s.home_id) AS page_count
  FROM spaces s LEFT JOIN goals g ON g.id = s.goal_id`

const toSpace = (r: SpaceRow): Space => ({
  id: r.id, name: r.name, slug: r.slug, icon: r.icon, goalId: r.goal_id, goalTitle: r.goal_title,
  homeId: r.home_id, pageCount: r.page_count, createdAt: r.created_at, archivedAt: r.archived_at,
})

export function listSpaces(u: User): Space[] {
  return all<SpaceRow>(`${SPACE_SELECT} WHERE s.user_id = ? ORDER BY s.archived_at IS NOT NULL, s.sort_order, s.id`, u.id)
    .map(toSpace)
}

export function getSpace(u: User, id: number): Space {
  const r = get<SpaceRow>(`${SPACE_SELECT} WHERE s.user_id = ? AND s.id = ?`, u.id, id)
  return r ? toSpace(r) : fail(404, 'This space no longer exists')
}

/** Space slugs are unique per user, so a space is found by name alone: /wiki/linear-algebra. */
function freeSlug(u: User, name: string, exceptId?: number) {
  const taken = all<{ slug: string }>('SELECT slug FROM spaces WHERE user_id = ? AND id IS NOT ?', u.id, exceptId ?? null)
    .map((r) => r.slug)
  return uniqueSlug(name, taken, 'space')
}

function cleanName(name: unknown) {
  const out = String(name ?? '').trim().slice(0, 100)
  return out || fail(400, 'Give the space a name')
}

export function createSpace(u: User, input: SpaceInput & { goalId?: number | null }): Space {
  const name = cleanName(input.name)
  return tx(() => {
    const r = run(
      `INSERT INTO spaces (user_id, name, slug, icon, goal_id, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM spaces WHERE user_id = ?), ?)`,
      u.id, name, freeSlug(u, name), input.icon?.slice(0, 8) ?? null, input.goalId ?? null, u.id, Date.now(),
    )
    const id = Number(r.lastInsertRowid)
    createHome(u, id, name)
    return getSpace(u, id)
  })
}

/**
 * The home page is made with the space and named after it. It is written in the same INSERT the
 * rest of the app uses, rather than through notes.ts, to keep these two modules from importing
 * each other in a circle.
 */
function createHome(u: User, spaceId: number, name: string) {
  const now = Date.now()
  const r = run(
    `INSERT INTO notes (user_id, item_type, item_id, space_id, parent_id, slug, sort_order, title, body, body_text, created_at, updated_at)
     VALUES (?, '', 0, ?, NULL, ?, 0, ?, '', '', ?, ?)`,
    u.id, spaceId, slugify(name), name, now, now,
  )
  const noteId = Number(r.lastInsertRowid)
  run('UPDATE spaces SET home_id = ? WHERE id = ?', noteId, spaceId)
  return noteId
}

/**
 * Gives a home page to any space that hasn't got one and files loose pages under it. Spaces made
 * before home pages existed come through here when their vault is first opened.
 */
export function ensureSpaceHomes(u: User) {
  const missing = all<{ id: number; name: string }>(
    'SELECT id, name FROM spaces WHERE user_id = ? AND (home_id IS NULL OR home_id NOT IN (SELECT id FROM notes))', u.id)
  for (const s of missing) {
    tx(() => {
      const homeId = createHome(u, s.id, s.name)
      run('UPDATE notes SET parent_id = ? WHERE space_id = ? AND parent_id IS NULL AND id IS NOT ?', homeId, s.id, homeId)
    })
  }
  return missing.length
}

/** True when this page is a space's home page, which can't be moved, filed or thrown away. */
export function isSpaceHome(noteId: number) {
  return !!get<{ id: number }>('SELECT id FROM spaces WHERE home_id = ?', noteId)
}

export function updateSpace(u: User, id: number, input: SpaceInput): Space {
  getSpace(u, id)
  const sets: string[] = []
  const vals: (string | number | null)[] = []
  if (input.name !== undefined) {
    const name = cleanName(input.name)
    // The slug follows the name: a renamed space should read right in its URL.
    sets.push('name = ?', 'slug = ?'), vals.push(name, freeSlug(u, name, id))
  }
  if (input.icon !== undefined) sets.push('icon = ?'), vals.push(input.icon?.slice(0, 8) || null)
  if (input.archived !== undefined) sets.push('archived_at = ?'), vals.push(input.archived ? Date.now() : null)
  if (sets.length) run(`UPDATE spaces SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, ...vals, id, u.id)
  if (input.name !== undefined) {
    const home = get<{ home_id: number | null }>('SELECT home_id FROM spaces WHERE id = ?', id)?.home_id
    // The home page carries the space's name; an untouched one follows a rename.
    if (home) run(`UPDATE notes SET title = ?, slug = ? WHERE id = ? AND body = ''`, cleanName(input.name), slugify(String(input.name)), home)
  }
  return getSpace(u, id)
}

/** Deleting throws away pages, so it's only allowed once a space is empty. */
export function deleteSpace(u: User, id: number) {
  const s = getSpace(u, id)
  if (s.pageCount > 0) fail(409, 'Move or delete this space’s pages first')
  // The home page belongs to the space itself and goes with it, so it doesn't count as something
  // left behind — only pages waiting in the Trash do.
  if (get<{ id: number }>('SELECT id FROM notes WHERE space_id = ? AND id IS NOT ? LIMIT 1', id, s.homeId)) {
    fail(409, 'This space still has pages in the Trash. Empty it first.')
  }
  tx(() => {
    run('UPDATE goals SET space_id = NULL WHERE space_id = ? AND user_id = ?', id, u.id)
    run('UPDATE spaces SET home_id = NULL WHERE id = ?', id)
    if (s.homeId) run('DELETE FROM notes WHERE id = ? AND user_id = ?', s.homeId, u.id)
    run('DELETE FROM spaces WHERE id = ? AND user_id = ?', id, u.id)
  })
}

/** The space a new goal writes into. Made with the goal, and named after it. */
export function createGoalSpace(u: User, goalId: number, title: string) {
  const space = createSpace(u, { name: title, goalId })
  run('UPDATE goals SET space_id = ? WHERE id = ? AND user_id = ?', space.id, goalId, u.id)
  return space
}

/** Points a goal at another space, so two goals on one subject can share a wiki. */
export function setGoalSpace(u: User, goalId: number, spaceId: number) {
  getSpace(u, spaceId)
  run('UPDATE goals SET space_id = ? WHERE id = ? AND user_id = ?', spaceId, goalId, u.id)
}

/**
 * Where a note written from this goal or task lands. Goals have their own space; everything
 * written on a task goes to one shared "Tasks" space, since tasks are one-offs.
 */
export function spaceForItem(u: User, type: ItemType, itemId: number): number {
  if (type === 'goal') {
    const row = get<{ space_id: number | null; title: string }>('SELECT space_id, title FROM goals WHERE id = ? AND user_id = ?', itemId, u.id)
      ?? fail(404, 'This goal no longer exists')
    return row.space_id ?? createGoalSpace(u, itemId, row.title).id
  }
  const tasks = get<{ id: number }>(`SELECT id FROM spaces WHERE user_id = ? AND goal_id IS NULL AND name = 'Tasks'`, u.id)
  return tasks?.id ?? createSpace(u, { name: 'Tasks' }).id
}
