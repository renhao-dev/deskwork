// Notes: Markdown documents on a goal or task, with pasted images. Deleting moves a note to the
// Trash; it's removed for good after 30 days (or when you empty it), together with its images.
import { all, get, run, tx } from './db.ts'
import { assertItem, fail } from './store.ts'
import type { ItemType, Note, NoteSummary, User } from '../shared/types.ts'

export const TRASH_DAYS = 30
const EDIT_EVENT_GAP = 2 * 60_000 // edits closer together than this count as one

interface NoteRow {
  id: number; user_id: number; item_type: ItemType; item_id: number; title: string; body: string
  created_at: number; updated_at: number; deleted_at: number | null
}

const IMAGE_URL = /\/api\/note-images\/([\w-]+)/g

/** Plain-text start of a note, for lists. */
export function excerpt(body: string, length = 160) {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s+\[[ xX]\]|[-*+]|\d+[.)])\s*/gm, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text
}

function firstImage(body: string) {
  const m = /!\[[^\]]*\]\(([^)\s]+)/.exec(body)
  return m ? m[1] : null
}

const toSummary = (r: NoteRow): NoteSummary => ({
  id: r.id, itemType: r.item_type, itemId: r.item_id, title: r.title, excerpt: excerpt(r.body),
  firstImage: firstImage(r.body), createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at,
})

function noteRow(u: User, id: number) {
  return get<NoteRow>('SELECT * FROM notes WHERE id = ? AND user_id = ?', id, u.id) ?? fail(404, 'This note no longer exists')
}

export function listNotes(u: User, type: ItemType, itemId: number, trash = false): NoteSummary[] {
  assertItem(u, type, itemId)
  return all<NoteRow>(
    `SELECT * FROM notes WHERE user_id = ? AND item_type = ? AND item_id = ? AND deleted_at IS ${trash ? 'NOT NULL' : 'NULL'}
     ORDER BY ${trash ? 'deleted_at' : 'updated_at'} DESC`,
    u.id, type, itemId,
  ).map(toSummary)
}

export function getNote(u: User, id: number): Note {
  const r = noteRow(u, id)
  const { title: itemTitle } = assertItem(u, r.item_type, r.item_id)
  return { ...toSummary(r), body: r.body, itemTitle }
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
  const r = run('INSERT INTO notes (user_id, item_type, item_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    u.id, type, itemId, title, body, now, now)
  const id = Number(r.lastInsertRowid)
  run('INSERT INTO note_events (note_id, user_id, kind, at) VALUES (?, ?, ?, ?)', id, u.id, 'created', now)
  claimImages(u, id, body)
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
    run('UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?', title, body, now, id)
    claimImages(u, id, body)
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
  run('UPDATE notes SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', Date.now(), id)
}

export function restoreNote(u: User, id: number): Note {
  noteRow(u, id)
  run('UPDATE notes SET deleted_at = NULL WHERE id = ?', id)
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

export function emptyTrash(u: User, type: ItemType, itemId: number): string[] {
  const ids = all<{ id: number }>('SELECT id FROM notes WHERE user_id = ? AND item_type = ? AND item_id = ? AND deleted_at IS NOT NULL',
    u.id, type, itemId).map((r) => r.id)
  return purge(ids)
}

/** When a goal or task is deleted, its notes go with it. */
export function deleteNotesOfItem(u: User, type: ItemType, itemId: number): string[] {
  const ids = all<{ id: number }>('SELECT id FROM notes WHERE user_id = ? AND item_type = ? AND item_id = ?', u.id, type, itemId).map((r) => r.id)
  return purge(ids)
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
