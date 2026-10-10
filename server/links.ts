// What points at what. The links themselves live in the Markdown; this table is the reverse
// index, so a page can show what mentions it without reading every other page.
import { all, get, run, tx } from './db.ts'
import { linksIn, type LinkRef } from '../shared/links.ts'
import type { Backlink, LinkTarget, User } from '../shared/types.ts'

/** 'page' is a note; 'book' is a resource. The table stores what the row actually is. */
const TO_TYPE = { page: 'note', goal: 'goal', task: 'task', book: 'resource' } as const

export function syncLinks(u: User, noteId: number, body: string) {
  const refs = linksIn(body)
  tx(() => {
    run(`DELETE FROM links WHERE user_id = ? AND from_type = 'note' AND from_id = ?`, u.id, noteId)
    const now = Date.now()
    for (const r of refs) {
      if (r.kind === 'page' && r.id === noteId) continue // a page linking to itself says nothing
      run(
        `INSERT OR IGNORE INTO links (user_id, from_type, from_id, to_type, to_id, created_at)
         VALUES (?, 'note', ?, ?, ?, ?)`,
        u.id, noteId, TO_TYPE[r.kind], r.id, now,
      )
    }
  })
}

/** The current name of whatever a link points at, or null once it's gone. */
export function linkName(u: User, ref: LinkRef): string | null {
  const table = ref.kind === 'page' ? 'notes' : ref.kind === 'goal' ? 'goals' : ref.kind === 'task' ? 'tasks' : 'resources'
  const row = get<{ title: string; deleted_at?: number | null }>(
    `SELECT title${ref.kind === 'page' ? ', deleted_at' : ''} FROM ${table} WHERE id = ? AND user_id = ?`, ref.id, u.id)
  if (!row || row.deleted_at) return null
  return row.title || (ref.kind === 'page' ? 'Untitled page' : null)
}

/** The pages that mention this goal, task, book or page. */
export function backlinks(u: User, kind: keyof typeof TO_TYPE, id: number): Backlink[] {
  return all<{
    id: number; title: string; slug: string; space_id: number; space_name: string; space_slug: string
    parent_id: number | null; updated_at: number
  }>(
    `SELECT n.id, n.title, n.slug, n.space_id, n.parent_id, n.updated_at, s.name AS space_name, s.slug AS space_slug
     FROM links l
     JOIN notes n ON n.id = l.from_id AND l.from_type = 'note'
     JOIN spaces s ON s.id = n.space_id
     WHERE l.user_id = ? AND l.to_type = ? AND l.to_id = ? AND n.deleted_at IS NULL
     ORDER BY n.updated_at DESC`,
    u.id, TO_TYPE[kind], id,
  ).map((r) => ({
    id: r.id, title: r.title || 'Untitled page', slug: r.slug, spaceId: r.space_id,
    spaceName: r.space_name, spaceSlug: r.space_slug, path: trail(u, r.parent_id), updatedAt: r.updated_at,
  }))
}

function trail(u: User, parentId: number | null) {
  const names: string[] = []
  let id = parentId
  for (let i = 0; id != null && i < 8; i++) {
    const row = get<{ title: string; parent_id: number | null }>('SELECT title, parent_id FROM notes WHERE id = ? AND user_id = ?', id, u.id)
    if (!row) break
    // A space's home page is the space itself, named alongside already.
    if (!get<{ id: number }>('SELECT id FROM spaces WHERE home_id = ?', id)) names.unshift(row.title || 'Untitled page')
    id = row.parent_id
  }
  return names.join(' › ')
}

/** What the [[ picker offers: pages, goals, tasks and books whose name contains what you typed. */
export function linkTargets(u: User, query: string): LinkTarget[] {
  // % and _ are wildcards in LIKE, so what you typed is escaped before it goes in.
  const q = `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const out: LinkTarget[] = []
  const take = <T>(rows: T[], make: (r: T) => LinkTarget) => rows.forEach((r) => out.push(make(r)))

  take(all<{ id: number; title: string; space_name: string }>(
    `SELECT n.id, n.title, s.name AS space_name FROM notes n JOIN spaces s ON s.id = n.space_id
     WHERE n.user_id = ? AND n.deleted_at IS NULL AND n.title LIKE ? ESCAPE '\\' COLLATE NOCASE
     ORDER BY n.updated_at DESC LIMIT 8`, u.id, q),
    (r) => ({ kind: 'page', id: r.id, title: r.title || 'Untitled page', hint: r.space_name, address: `deskwork:page/${r.id}` }))

  take(all<{ id: number; title: string }>(
    `SELECT id, title FROM goals WHERE user_id = ? AND title LIKE ? ESCAPE '\\' COLLATE NOCASE
     ORDER BY archived_at IS NOT NULL, sort_order LIMIT 5`, u.id, q),
    (r) => ({ kind: 'goal', id: r.id, title: r.title, hint: 'Goal', address: `deskwork:goal/${r.id}` }))

  take(all<{ id: number; title: string }>(
    `SELECT id, title FROM tasks WHERE user_id = ? AND title LIKE ? ESCAPE '\\' COLLATE NOCASE
     ORDER BY completed_at IS NOT NULL, sort_order LIMIT 5`, u.id, q),
    (r) => ({ kind: 'task', id: r.id, title: r.title, hint: 'Task', address: `deskwork:task/${r.id}` }))

  take(all<{ id: number; title: string; author: string }>(
    `SELECT id, title, author FROM resources WHERE user_id = ? AND title LIKE ? ESCAPE '\\' COLLATE NOCASE
     ORDER BY title LIMIT 5`, u.id, q),
    (r) => ({ kind: 'book', id: r.id, title: r.title, hint: r.author || 'Resource', address: `deskwork:book/${r.id}/1` }))

  return out
}
