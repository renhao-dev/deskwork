// Notes: Markdown documents on a goal or task, with pasted images. Deleting moves a note to the
// Trash; it's removed for good after 30 days (or when you empty it), together with its images.
import { all, get, run, tx } from './db.ts'
import { assertItem, fail } from './store.ts'
import { isSpaceHome, spaceForItem } from './spaces.ts'
import { slugify } from '../shared/slug.ts'
import { searchQuery } from '../shared/search.ts'
import { plainText } from '../shared/markdown.ts'
import { refreshLinkText } from '../shared/links.ts'
import { linkName, syncLinks } from './links.ts'
import type { ItemType, Note, NoteSummary, SearchHit, User } from '../shared/types.ts'

export const TRASH_DAYS = 30
const EDIT_EVENT_GAP = 2 * 60_000 // edits closer together than this count as one

/**
 * item_type/item_id say which goal or task a page was written from. They're NOT NULL in the
 * original schema, so a page whose goal has been deleted carries this pair instead; the API
 * reports it as null. The page itself stays where it is, in its space.
 */
const NO_ORIGIN = { type: '', id: 0 } as const

interface NoteRow {
  id: number; user_id: number; item_type: ItemType | ''; item_id: number; title: string; body: string
  space_id: number | null; parent_id: number | null; slug: string
  created_at: number; updated_at: number; deleted_at: number | null
}

const IMAGE_URL = /\/api\/note-images\/([\w-]+)/g

/** Plain-text start of a note, for lists. */
export function excerpt(body: string, length = 160) {
  const text = plainText(body)
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text
}

function firstImage(body: string) {
  const m = /!\[[^\]]*\]\(([^)\s]+)/.exec(body)
  return m ? m[1] : null
}

const toSummary = (r: NoteRow): NoteSummary => ({
  id: r.id, spaceId: r.space_id, parentId: r.parent_id, slug: r.slug,
  itemType: r.item_type || null, itemId: r.item_id || null, title: r.title, excerpt: excerpt(r.body),
  firstImage: firstImage(r.body), createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
})

/** The goal or task a page was written from, when it's still around. Deleting a goal leaves its
 *  pages in its space, so this can come back empty. */
function origin(u: User, r: NoteRow) {
  if (!r.item_type || !r.item_id) return null // written from a goal that's since been deleted
  const table = r.item_type === 'goal' ? 'goals' : 'tasks'
  return get<{ title: string }>(`SELECT title FROM ${table} WHERE id = ? AND user_id = ?`, r.item_id, u.id) ?? null
}

function noteRow(u: User, id: number) {
  return get<NoteRow>('SELECT * FROM notes WHERE id = ? AND user_id = ?', id, u.id) ?? fail(404, 'This note no longer exists')
}

/**
 * A goal's Notes tab is a view of its space: every page in it, plus any page written from the goal
 * that has since been moved elsewhere in the wiki. A task has no space of its own, so it shows
 * only what was written from it.
 */
export function listNotes(u: User, type: ItemType, itemId: number, trash = false): NoteSummary[] {
  assertItem(u, type, itemId)
  const spaceId = type === 'goal'
    ? get<{ space_id: number | null }>('SELECT space_id FROM goals WHERE id = ? AND user_id = ?', itemId, u.id)?.space_id ?? null
    : null
  return all<NoteRow>(
    `SELECT * FROM notes
     WHERE user_id = ? AND deleted_at IS ${trash ? 'NOT NULL' : 'NULL'}
       AND ((item_type = ? AND item_id = ?) OR (? IS NOT NULL AND space_id = ?))
     ORDER BY ${trash ? 'deleted_at' : 'updated_at'} DESC`,
    u.id, type, itemId, spaceId, spaceId,
  ).map(toSummary)
}

/** Every page in a space, for the wiki's page list. The Trash is listed separately. */
export function listSpacePages(u: User, spaceId: number, trash = false): NoteSummary[] {
  return all<NoteRow>(
    `SELECT * FROM notes WHERE user_id = ? AND space_id = ? AND deleted_at IS ${trash ? 'NOT NULL' : 'NULL'}
     ORDER BY ${trash ? 'deleted_at DESC' : 'sort_order, created_at'}`,
    u.id, spaceId,
  ).map(toSummary)
}

/** A page written in the wiki itself, so it belongs to a space and to no goal. */
/** A space's home page, which new pages are filed under unless they say otherwise. */
function homeOf(spaceId: number) {
  return get<{ home_id: number | null }>('SELECT home_id FROM spaces WHERE id = ?', spaceId)?.home_id ?? null
}

export function createPage(u: User, spaceId: number, input: { title?: string; body?: string; parentId?: number | null }): Note {
  const now = Date.now()
  const title = String(input.title ?? '').trim().slice(0, 200)
  const body = String(input.body ?? '')
  const parentId = input.parentId ? noteRow(u, Number(input.parentId)).id : homeOf(spaceId)
  const r = run(
    `INSERT INTO notes (user_id, item_type, item_id, space_id, parent_id, slug, sort_order, title, body, body_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM notes WHERE space_id = ?), ?, ?, ?, ?, ?)`,
    u.id, NO_ORIGIN.type, NO_ORIGIN.id, spaceId, parentId, slugify(title), spaceId, title, body, plainText(body), now, now)
  const id = Number(r.lastInsertRowid)
  run('INSERT INTO note_events (note_id, user_id, kind, at) VALUES (?, ?, ?, ?)', id, u.id, 'created', now)
  claimImages(u, id, body)
  syncLinks(u, id, body)
  return getNote(u, id)
}

/**
 * Lays out a space's pages: each entry says where a page sits and whose child it is, in the order
 * they appear. A parent has to come before its children, which is also what makes a loop
 * impossible — you can't be your own ancestor if every parent was already placed.
 */
export function reorderPages(u: User, spaceId: number, pages: { id: number; parentId: number | null }[]) {
  // Pages in the Trash are out of the tree, so they're not part of the arrangement being sent.
  const belong = new Set(all<{ id: number }>(
    'SELECT id FROM notes WHERE user_id = ? AND space_id = ? AND deleted_at IS NULL', u.id, spaceId,
  ).map((r) => r.id))
  const placed = new Set<number>()
  const clean = pages.map((p) => ({ id: Number(p.id), parentId: p.parentId == null ? null : Number(p.parentId) }))
  const home = get<{ home_id: number | null }>('SELECT home_id FROM spaces WHERE id = ?', spaceId)?.home_id
  for (const p of clean) {
    if (p.id === home && p.parentId !== null) fail(400, 'A space’s home page stays at the top.')
    if (!belong.has(p.id) || placed.has(p.id)) fail(400, 'This space changed somewhere else. The list has been refreshed — try again.')
    if (p.parentId !== null && !placed.has(p.parentId)) fail(400, 'A page has to be filed under one that comes before it')
    placed.add(p.id)
  }
  if (placed.size !== belong.size) fail(400, 'This space changed somewhere else. The list has been refreshed — try again.')
  tx(() => clean.forEach((p, i) => run('UPDATE notes SET parent_id = ?, sort_order = ? WHERE id = ?', p.parentId, i + 1, p.id)))
}

/** Moves a page to another space, or under another page. */
export function movePage(u: User, id: number, to: { spaceId?: number; parentId?: number | null }): Note {
  const cur = noteRow(u, id)
  if (isSpaceHome(id)) fail(400, 'A space’s home page stays where it is.')
  const spaceId = to.spaceId ? Number(to.spaceId) : cur.space_id
  let parentId: number | null = null
  if (to.parentId) {
    const parent = noteRow(u, Number(to.parentId))
    if (parent.id === id) fail(400, 'A page can’t be filed under itself')
    if (parent.space_id !== spaceId) fail(400, 'That page is in another space')
    parentId = parent.id
  }
  tx(() => {
    run('UPDATE notes SET space_id = ?, parent_id = ? WHERE id = ? AND user_id = ?', spaceId, parentId, id, u.id)
    // Pages filed under it go along, so nothing is left pointing into another space.
    if (spaceId !== cur.space_id) {
      let wave = [id]
      for (let depth = 0; wave.length && depth < 100; depth++) {
        const marks = wave.map(() => '?').join(', ')
        const kids = all<{ id: number }>(`SELECT id FROM notes WHERE parent_id IN (${marks})`, ...wave).map((r) => r.id)
        if (kids.length) run(`UPDATE notes SET space_id = ? WHERE id IN (${kids.map(() => '?').join(', ')})`, spaceId, ...kids)
        wave = kids
      }
    }
  })
  return getNote(u, id)
}

/**
 * Searches every page, or one space. Results are ranked by SQLite's bm25, which favours a match in
 * a short title over one buried in a long page. Pages in the Trash stay out of it.
 */
export function searchNotes(u: User, input: string, spaceId?: number): SearchHit[] {
  const match = searchQuery(input)
  if (!match) return []
  const rows = all<{
    id: number; title: string; slug: string; space_id: number; space_name: string; space_slug: string
    parent_id: number | null; snippet: string; opening: string; updated_at: number
  }>(
    `SELECT n.id, n.title, n.slug, n.space_id, n.parent_id, n.updated_at,
            s.name AS space_name, s.slug AS space_slug,
            snippet(note_search, 1, '«', '»', '…', 14) AS snippet,
            substr(n.body_text, 1, 160) AS opening
     FROM note_search
     JOIN notes n ON n.id = note_search.rowid
     JOIN spaces s ON s.id = n.space_id
     WHERE note_search MATCH ? AND n.user_id = ? AND n.deleted_at IS NULL
       AND (? IS NULL OR n.space_id = ?)
     ORDER BY bm25(note_search, 4.0, 1.0)
     LIMIT 60`,
    match, u.id, spaceId ?? null, spaceId ?? null,
  )
  if (!rows.length) return []

  // The trail of pages above each hit, so a result says where it lives. Only the spaces that
  // turned something up are loaded.
  const spaceIds = [...new Set(rows.map((r) => r.space_id))]
  const titles = new Map(all<{ id: number; title: string; parent_id: number | null }>(
    `SELECT id, title, parent_id FROM notes WHERE user_id = ? AND space_id IN (${spaceIds.map(() => '?').join(', ')})`,
    u.id, ...spaceIds,
  ).map((r) => [r.id, r]))
  // The home page is the space, and the space is already named beside the result, so it is left
  // out of the trail rather than repeated.
  const homes = new Set(all<{ home_id: number }>('SELECT home_id FROM spaces WHERE home_id IS NOT NULL').map((r) => r.home_id))
  const trail = (parentId: number | null) => {
    const names: string[] = []
    for (let cur = parentId != null ? titles.get(parentId) : undefined; cur && names.length < 8;
         cur = cur.parent_id != null ? titles.get(cur.parent_id) : undefined) {
      if (!homes.has(cur.id)) names.unshift(cur.title || 'Untitled page')
    }
    return names.join(' › ')
  }

  return rows.map((r) => ({
    id: r.id, title: r.title, slug: r.slug, spaceId: r.space_id, spaceName: r.space_name, spaceSlug: r.space_slug,
    // A match in the title alone leaves the body snippet empty; show how the page starts instead.
    path: trail(r.parent_id), snippet: r.snippet.trim() || r.opening, updatedAt: r.updated_at,
  }))
}

export function getNote(u: User, id: number): Note {
  const r = noteRow(u, id)
  const space = r.space_id ? get<{ name: string; slug: string }>('SELECT name, slug FROM spaces WHERE id = ?', r.space_id) : null
  return {
    // Links carry an id, so a renamed goal or page reads right here even though the text that was
    // typed said something else. Saving the note writes the current names back.
    ...toSummary(r), body: refreshLinkText(r.body, (ref) => linkName(u, ref)),
    itemTitle: origin(u, r)?.title ?? null,
    spaceName: space?.name ?? null, spaceSlug: space?.slug ?? null,
  }
}

/** Images pasted into a note belong to it once the note is saved with them. */
function claimImages(u: User, noteId: number, body: string) {
  const ids = [...body.matchAll(IMAGE_URL)].map((m) => m[1])
  if (ids.length) {
    run(`UPDATE note_images SET note_id = ? WHERE user_id = ? AND note_id IS NULL AND id IN (${ids.map(() => '?').join(', ')})`,
      noteId, u.id, ...ids)
  }
}

export function createNote(u: User, type: ItemType, itemId: number, input: { title?: string; body?: string }): Note {
  assertItem(u, type, itemId)
  const now = Date.now()
  const title = String(input.title ?? '').trim().slice(0, 200)
  const body = String(input.body ?? '')
  // A new page lands under its space's home page, so writing never asks where to file it.
  const spaceId = spaceForItem(u, type, itemId)
  const parentId = homeOf(spaceId)
  const r = run(
    `INSERT INTO notes (user_id, item_type, item_id, space_id, parent_id, slug, sort_order, title, body, body_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM notes WHERE space_id = ?), ?, ?, ?, ?, ?)`,
    u.id, type, itemId, spaceId, parentId, slugify(title), spaceId, title, body, plainText(body), now, now)
  const id = Number(r.lastInsertRowid)
  run('INSERT INTO note_events (note_id, user_id, kind, at) VALUES (?, ?, ?, ?)', id, u.id, 'created', now)
  claimImages(u, id, body)
  syncLinks(u, id, body)
  return getNote(u, id)
}

export function updateNote(u: User, id: number, input: { title?: string; body?: string }): Note {
  const cur = noteRow(u, id)
  if (cur.deleted_at) fail(409, 'This note is in the Trash. Restore it to edit it.')
  const title = input.title !== undefined ? String(input.title).trim().slice(0, 200) : cur.title
  const body = input.body !== undefined ? String(input.body) : cur.body
  if (title === cur.title && body === cur.body) return getNote(u, id)
  const now = Date.now()
  tx(() => {
    run('UPDATE notes SET title = ?, body = ?, body_text = ?, slug = ?, updated_at = ? WHERE id = ?',
      title, body, plainText(body), slugify(title), now, id)
    claimImages(u, id, body)
    syncLinks(u, id, body)
    // Typing saves every second or so; record one "edited" per stretch of work, not one per save.
    // Writing right after creating is part of creating; the creation time itself never moves.
    const last = get<{ id: number; kind: string; at: number }>('SELECT id, kind, at FROM note_events WHERE note_id = ? ORDER BY at DESC LIMIT 1', id)
    const recent = !!last && now - last.at < EDIT_EVENT_GAP
    if (recent && last.kind === 'edited') run('UPDATE note_events SET at = ? WHERE id = ?', now, last.id)
    else if (!(recent && last.kind === 'created')) run('INSERT INTO note_events (note_id, user_id, kind, at) VALUES (?, ?, ?, ?)', id, u.id, 'edited', now)
  })
  return getNote(u, id)
}

export function trashNote(u: User, id: number) {
  noteRow(u, id)
  if (isSpaceHome(id)) fail(400, 'This is the space’s home page. Rename or delete the space instead.')
  run('UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', Date.now(), id)
}

export function restoreNote(u: User, id: number): Note {
  const r = noteRow(u, id)
  run('UPDATE notes SET deleted_at = NULL WHERE id = ?', id)
  // Its parent may have been deleted in the meantime, which would leave it nowhere you can get to.
  const parentGone = r.parent_id == null
    || !get<{ id: number }>('SELECT id FROM notes WHERE id = ? AND deleted_at IS NULL', r.parent_id)
  if (parentGone && r.space_id) {
    const home = homeOf(r.space_id)
    if (home && home !== id) run('UPDATE notes SET parent_id = ? WHERE id = ?', home, id)
  }
  return getNote(u, id)
}

/** Deletes notes for good. Returns their image files, for the caller to remove from disk. */
function purge(noteIds: number[]): string[] {
  if (!noteIds.length) return []
  const marks = noteIds.map(() => '?').join(', ')
  const files = all<{ file_path: string }>(`SELECT file_path FROM note_images WHERE note_id IN (${marks})`, ...noteIds).map((r) => r.file_path)
  run(`DELETE FROM note_images WHERE note_id IN (${marks})`, ...noteIds)
  run(`DELETE FROM notes WHERE id IN (${marks})`, ...noteIds)
  return files
}

export function deleteNoteForever(u: User, id: number): string[] {
  const r = noteRow(u, id)
  if (!r.deleted_at) fail(409, 'Move the note to the Trash first')
  return purge([id])
}

/** Throws away everything in one space's Trash. Returns the image files for the caller to remove. */
export function emptySpaceTrash(u: User, spaceId: number): string[] {
  return purge(listSpacePages(u, spaceId, true).map((n) => n.id))
}

export function emptyTrash(u: User, type: ItemType, itemId: number): string[] {
  const ids = listNotes(u, type, itemId, true).map((n) => n.id)
  return purge(ids)
}

/**
 * A deleted goal leaves its pages behind: they belong to its space now, which stays. The pages
 * just stop pointing back at a goal that isn't there.
 */
export function detachNotesOfItem(u: User, type: ItemType, itemId: number) {
  run('UPDATE notes SET item_type = ?, item_id = ? WHERE user_id = ? AND item_type = ? AND item_id = ?',
    NO_ORIGIN.type, NO_ORIGIN.id, u.id, type, itemId)
}

/** Notes in the Trash longer than 30 days, plus images pasted but never saved into a note (after a day). */
export function purgeExpired(): string[] {
  const now = Date.now()
  const ids = all<{ id: number }>('SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?', now - TRASH_DAYS * 86_400_000).map((r) => r.id)
  const files = purge(ids)
  const strays = all<{ id: string; file_path: string }>('SELECT id, file_path FROM note_images WHERE note_id IS NULL AND created_at < ?', now - 86_400_000)
  for (const s of strays) run('DELETE FROM note_images WHERE id = ?', s.id)
  return [...files, ...strays.map((s) => s.file_path)]
}

export function addNoteImage(u: User, img: { id: string; path: string; mime: string; size: number }) {
  run('INSERT INTO note_images (id, user_id, file_path, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    img.id, u.id, img.path, img.mime, img.size, Date.now())
}

export function noteImage(u: User, id: string) {
  return get<{ file_path: string; mime: string }>('SELECT file_path, mime FROM note_images WHERE id = ? AND user_id = ?', id, u.id)
    ?? fail(404, 'Image not found')
}
