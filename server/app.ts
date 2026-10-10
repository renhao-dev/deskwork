import { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'
import { HTTPException } from 'hono/http-exception'
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { basename, dirname, extname, join, relative } from 'node:path'
import { randomUUID } from 'node:crypto'
import { all, get, run, useConnection, UPLOAD_DIR } from './db.ts'
import * as vault from './vault.ts'
import {
  ensureDefaultAdmin, rewrapKey, findUser, hashPassword, login, logout, parseSettings, requireAdmin, requireUser, toUser,
  verifyPassword, type Env,
} from './auth.ts'
import * as store from './store.ts'
import * as notes from './notes.ts'
import * as spaces from './spaces.ts'
import * as links from './links.ts'
import type { ItemType, UserSettings } from '../shared/types.ts'

ensureDefaultAdmin()

export const app = new Hono<Env>()
const api = new Hono<Env>()

api.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
  console.error(err)
  return c.json({ error: 'Something went wrong on the server. Check the server log.' }, 500)
})

const body = async <T = Record<string, unknown>>(c: { req: { json: () => Promise<unknown> } }) => {
  try {
    return ((await c.req.json()) ?? {}) as T
  } catch {
    return {} as T
  }
}
const idParam = (v: string | undefined) => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : store.fail(404, 'Not found')
}
const typeParam = (v: string | undefined): ItemType =>
  v === 'goals' || v === 'goal' ? 'goal' : v === 'tasks' || v === 'task' ? 'task' : store.fail(404, 'Not found')

api.get('/health', (c) => c.json({ ok: true, build: BUILD }))

// ---------- auth ----------

api.post('/auth/login', async (c) => {
  const { username, password } = await body<{ username?: string; password?: string }>(c)
  const user = login(c, String(username ?? ''), String(password ?? ''))
  if (!user) return c.json({ error: 'Wrong username or password' }, 401)
  return c.json(user)
})

api.post('/auth/logout', (c) => {
  logout(c)
  return c.json({ ok: true })
})

api.use('/*', async (c, next) => {
  if (c.req.path.endsWith('/health') || c.req.path.includes('/auth/')) return next()
  return requireUser(c, next)
})

api.get('/me', (c) => c.json(c.get('user')))

api.put('/me/settings', async (c) => {
  const u = c.get('user')
  const patch = await body<Partial<UserSettings>>(c)
  const next: UserSettings = { ...u.settings }
  if (patch.dayStartHour !== undefined) {
    const h = Math.round(Number(patch.dayStartHour))
    if (!(h >= 0 && h <= 12)) store.fail(400, 'Day start must be between 0:00 and 12:00')
    next.dayStartHour = h
  }
  if (patch.theme !== undefined) {
    if (!['system', 'light', 'dark'].includes(patch.theme)) store.fail(400, 'Theme must be system, light or dark')
    next.theme = patch.theme
  }
  if (patch.timezone) next.timezone = String(patch.timezone)
  if (patch.pomodoro) {
    const p = { ...u.settings.pomodoro, ...patch.pomodoro }
    for (const k of ['work', 'short', 'long', 'every'] as const) {
      p[k] = Math.round(Number(p[k]))
      if (!(p[k] >= 1 && p[k] <= 240)) store.fail(400, 'Pomodoro lengths must be between 1 and 240')
    }
    next.pomodoro = p
  }
  if (patch.notifications) {
    next.notifications = {
      enabled: patch.notifications.enabled ?? u.settings.notifications.enabled,
      pomodoro: patch.notifications.pomodoro ?? u.settings.notifications.pomodoro,
    }
    next.notifications.enabled = !!next.notifications.enabled
    next.notifications.pomodoro = !!next.notifications.pomodoro
  }
  if (patch.layout === null) next.layout = {} // "Tidy windows"
  else if (patch.layout) next.layout = { ...u.settings.layout, ...patch.layout }
  run('UPDATE users SET settings = ? WHERE id = ?', JSON.stringify(next), u.id)
  return c.json(findUser(u.id))
})

api.put('/me/password', async (c) => {
  const u = c.get('user')
  const { current, next } = await body<{ current?: string; next?: string }>(c)
  const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', u.id)!
  if (!verifyPassword(String(current ?? ''), row.password_hash)) store.fail(400, 'Current password is wrong')
  if (String(next ?? '').length < 4) store.fail(400, 'New password needs at least 4 characters')
  // The data key stays the same; only the lock around it is replaced. Nothing is re-encrypted.
  rewrapKey(u.id, String(current), String(next))
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(next)), u.id)
  return c.json({ ok: true })
})

// ---------- users (admin) ----------

api.get('/users', requireAdmin, (c) => c.json(all<Parameters<typeof toUser>[0]>('SELECT * FROM users ORDER BY created_at').map(toUser)))

api.post('/users', requireAdmin, async (c) => {
  const { username, password, isAdmin } = await body<{ username?: string; password?: string; isAdmin?: boolean }>(c)
  const name = String(username ?? '').trim()
  if (!/^[\w.-]{2,32}$/.test(name)) store.fail(400, 'Username: 2–32 letters, digits, dots, dashes or underscores')
  if (String(password ?? '').length < 4) store.fail(400, 'Password needs at least 4 characters')
  if (get('SELECT 1 FROM users WHERE username = ?', name)) store.fail(409, `“${name}” is already taken`)
  const settings = { ...parseSettings('{}'), timezone: c.get('user').settings.timezone }
  const r = run('INSERT INTO users (username, password_hash, is_admin, settings, created_at) VALUES (?, ?, ?, ?, ?)',
    name, hashPassword(String(password)), isAdmin ? 1 : 0, JSON.stringify(settings), Date.now())
  return c.json(findUser(Number(r.lastInsertRowid)))
})

api.put('/users/:id', requireAdmin, async (c) => {
  const id = idParam(c.req.param('id'))
  if (!findUser(id)) store.fail(404, 'User not found')
  const { password, isAdmin } = await body<{ password?: string; isAdmin?: boolean }>(c)
  if (password !== undefined) {
    // Each vault is locked by its owner's password, and an admin cannot open one. Setting a new
    // password here would leave the key wrapped under the old one and the data unreadable for
    // good, so it isn't allowed — people change their own password in Settings.
    if (id !== c.get('user').id) {
      store.fail(400, "Only the account's owner can change its password: their data is encrypted with it, and a reset would destroy it.")
    }
    store.fail(400, 'Change your own password in Settings, where the current one can be checked.')
  }
  if (isAdmin !== undefined) {
    if (id === c.get('user').id && !isAdmin) store.fail(400, "You can't remove your own admin rights")
    run('UPDATE users SET is_admin = ? WHERE id = ?', isAdmin ? 1 : 0, id)
  }
  return c.json(findUser(id))
})

api.delete('/users/:id', requireAdmin, (c) => {
  const id = idParam(c.req.param('id'))
  if (id === c.get('user').id) store.fail(400, "You can't delete your own account")
  // Their vault can't be read from here — only its owner's password opens it — so it goes as a
  // whole, along with everything they uploaded.
  run('DELETE FROM users WHERE id = ?', id)
  run('DELETE FROM sessions WHERE user_id = ?', id)
  vault.destroy(id)
  rmSync(join(UPLOAD_DIR, String(id)), { recursive: true, force: true })
  return c.json({ ok: true })
})

// ---------- dashboard, timer ----------

api.get('/dashboard', (c) => c.json(store.dashboard(c.get('user'))))

api.post('/completions/:id/undo', (c) => c.json(store.undoCompletion(c.get('user'), idParam(c.req.param('id')))))

api.get('/timer', (c) => c.json({ timer: store.currentTimer(c.get('user')) }))
api.post('/timer/start', async (c) => {
  const { itemType, itemId, mode } = await body<{ itemType?: string; itemId?: number; mode?: 'regular' | 'pomodoro' }>(c)
  return c.json({ timer: store.startTimer(c.get('user'), typeParam(itemType), idParam(String(itemId)), mode ?? 'regular') })
})
api.post('/timer/pause', (c) => c.json({ timer: store.pauseTimer(c.get('user')) }))
api.post('/timer/resume', (c) => c.json({ timer: store.resumeTimer(c.get('user')) }))
api.post('/timer/stop', (c) => c.json({ session: store.stopTimer(c.get('user')) }))

// ---------- goals & tasks ----------

api.get('/goals', (c) => c.json(store.listGoals(c.get('user'))))
api.post('/goals', async (c) => c.json(store.createGoal(c.get('user'), await body(c))))
api.put('/goals/order', async (c) => {
  const { ids } = await body<{ ids?: number[] }>(c)
  store.reorderGoals(c.get('user'), Array.isArray(ids) ? ids : [])
  return c.json({ ok: true })
})
api.put('/goals/:id', async (c) => c.json(store.updateGoal(c.get('user'), idParam(c.req.param('id')), await body(c))))

api.get('/tasks', (c) => c.json(store.listTasks(c.get('user'))))
api.post('/tasks', async (c) => c.json(store.createTask(c.get('user'), await body(c))))
api.put('/tasks/order', async (c) => {
  const { ids } = await body<{ ids?: number[] }>(c)
  store.reorderTasks(c.get('user'), Array.isArray(ids) ? ids : [])
  return c.json({ ok: true })
})
api.put('/tasks/:id', async (c) => c.json(store.updateTask(c.get('user'), idParam(c.req.param('id')), await body(c))))

api.get('/:type{goals|tasks}/:id', (c) =>
  c.json(store.itemDetail(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id')))))

api.delete('/:type{goals|tasks}/:id', (c) => {
  const u = c.get('user')
  const type = typeParam(c.req.param('type'))
  const id = idParam(c.req.param('id'))
  store.assertItem(u, type, id)
  notes.detachNotesOfItem(u, type, id) // pages stay in the wiki; only the goal goes
  store.deleteItem(u, type, id)
  return c.json({ ok: true })
})

api.post('/:type{goals|tasks}/:id/uncomplete', (c) => {
  const u = c.get('user')
  const type = typeParam(c.req.param('type'))
  const id = idParam(c.req.param('id'))
  return c.json(store.undoCompletion(u, store.latestCompletionId(u, type, id)))
})

api.post('/:type{goals|tasks}/:id/complete', async (c) =>
  c.json(store.completeItem(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id')), await body(c))))

api.post('/:type{goals|tasks}/:id/comments', async (c) => {
  const { body: text } = await body<{ body?: string }>(c)
  return c.json(store.addComment(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id')), String(text ?? '')))
})
api.delete('/comments/:id', (c) => {
  store.deleteComment(c.get('user'), idParam(c.req.param('id')))
  return c.json({ ok: true })
})

api.post('/:type{goals|tasks}/:id/resources', async (c) => {
  const { resourceId } = await body<{ resourceId?: number }>(c)
  const u = c.get('user')
  const type = typeParam(c.req.param('type'))
  const id = idParam(c.req.param('id'))
  store.attachResource(u, type, id, idParam(String(resourceId)))
  return c.json(store.attachedResources(u, type, id))
})
api.delete('/:type{goals|tasks}/:id/resources/:rid', (c) => {
  const u = c.get('user')
  const type = typeParam(c.req.param('type'))
  const id = idParam(c.req.param('id'))
  store.detachResource(u, type, id, idParam(c.req.param('rid')))
  return c.json(store.attachedResources(u, type, id))
})
api.post('/:type{goals|tasks}/:id/sessions', async (c) => {
  const { seconds, day } = await body<{ seconds?: number; day?: string }>(c)
  return c.json(store.addWorkSession(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id')), Number(seconds), day))
})
api.put('/sessions/:id', async (c) => {
  const { seconds } = await body<{ seconds?: number }>(c)
  store.updateWorkSession(c.get('user'), idParam(c.req.param('id')), Number(seconds))
  return c.json({ ok: true })
})
api.delete('/sessions/:id', (c) => {
  store.deleteWorkSession(c.get('user'), idParam(c.req.param('id')))
  return c.json({ ok: true })
})

api.get('/:type{goals|tasks}/:id/sessions', (c) =>
  c.json(store.itemSessions(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id')), c.req.query('before') || undefined)))

api.put('/:type{goals|tasks}/:id/resources/:rid/prefs', async (c) => {
  const { syncTimer } = await body<{ syncTimer?: boolean | null }>(c)
  store.setResourcePrefs(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id')), idParam(c.req.param('rid')), { syncTimer })
  return c.json({ ok: true })
})

// Opening a book or link during a timer run counts it as used in that session.
api.post('/:type{goals|tasks}/:id/resources/:rid/opened', (c) => {
  store.noteResourceUse(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id')), idParam(c.req.param('rid')))
  return c.json({ ok: true })
})
api.put('/:type{goals|tasks}/:id/resources/:rid/bookmark', async (c) => {
  const b = await body(c)
  store.saveBookmark(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id')), { ...b, resourceId: idParam(c.req.param('rid')) })
  return c.json({ ok: true })
})

// ---------- resources ----------

api.get('/resources', (c) => c.json(store.listResources(c.get('user'))))

api.get('/resource-folders', (c) => c.json(store.listFolders(c.get('user'))))
api.post('/resource-folders', async (c) => c.json(store.createFolder(c.get('user'), await body(c))))
api.put('/resource-folders/:id', async (c) => c.json(store.updateFolder(c.get('user'), idParam(c.req.param('id')), await body(c))))
api.delete('/resource-folders/:id', (c) => {
  store.deleteFolder(c.get('user'), idParam(c.req.param('id')))
  return c.json({ ok: true })
})
api.post('/resources', async (c) => c.json(store.createResource(c.get('user'), await body(c))))
api.get('/resources/:id', (c) => c.json(store.getResource(c.get('user'), idParam(c.req.param('id')))))
api.put('/resources/:id', async (c) => c.json(store.updateResource(c.get('user'), idParam(c.req.param('id')), await body(c))))
api.delete('/resources/:id', (c) => {
  const path = store.deleteResource(c.get('user'), idParam(c.req.param('id')))
  if (path) removeUpload(path)
  return c.json({ ok: true })
})

function removeUpload(stored: string) {
  const full = join(UPLOAD_DIR, stored)
  if (!relative(UPLOAD_DIR, full).startsWith('..') && existsSync(full)) unlinkSync(full)
}

/** Streams the request body to a new file in the uploads folder; returns its stored path and size. */
async function receiveUpload(c: { req: { raw: Request; header: (n: string) => string | undefined } }, prefix = '') {
  const name = decodeURIComponent(c.req.header('x-file-name') ?? 'file')
  const raw = c.req.raw.body
  if (!raw) store.fail(400, 'The upload was empty')
  const stored = `${prefix}${randomUUID()}${extname(name).toLowerCase().slice(0, 10)}`
  const full = join(UPLOAD_DIR, stored)
  mkdirSync(dirname(full), { recursive: true })
  try {
    await pipeline(Readable.fromWeb(raw as import('node:stream/web').ReadableStream), createWriteStream(full))
  } catch (e) {
    if (existsSync(full)) unlinkSync(full)
    throw e
  }
  return { stored, name, size: statSync(full).size }
}

// ---------- notes ----------

api.get('/:type{goals|tasks}/:id/notes', (c) =>
  c.json(notes.listNotes(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id')), c.req.query('trash') === '1')))
api.post('/:type{goals|tasks}/:id/notes', async (c) =>
  c.json(notes.createNote(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id')), await body(c))))
api.delete('/:type{goals|tasks}/:id/notes/trash', (c) => {
  notes.emptyTrash(c.get('user'), typeParam(c.req.param('type')), idParam(c.req.param('id'))).forEach(removeUpload)
  return c.json({ ok: true })
})
// ---------- wiki spaces ----------

api.get('/spaces', (c) => c.json(spaces.listSpaces(c.get('user'))))
api.post('/spaces', async (c) => c.json(spaces.createSpace(c.get('user'), await body(c))))
api.put('/spaces/:id', async (c) => c.json(spaces.updateSpace(c.get('user'), idParam(c.req.param('id')), await body(c))))
api.delete('/spaces/:id', (c) => {
  spaces.deleteSpace(c.get('user'), idParam(c.req.param('id')))
  return c.json({ ok: true })
})
api.put('/goals/:id/space', async (c) => {
  const u = c.get('user')
  const id = idParam(c.req.param('id'))
  spaces.setGoalSpace(u, id, idParam(String((await body(c)).spaceId)))
  return c.json(store.getGoal(u, id))
})

api.get('/link-targets', (c) => c.json(links.linkTargets(c.get('user'), c.req.query('q') ?? '')))
api.get('/backlinks/:kind{pages|goals|tasks|books}/:id', (c) => {
  const kind = { pages: 'page', goals: 'goal', tasks: 'task', books: 'book' }[c.req.param('kind')] as 'page' | 'goal' | 'task' | 'book'
  return c.json(links.backlinks(c.get('user'), kind, idParam(c.req.param('id'))))
})

api.get('/search', (c) => {
  const space = c.req.query('spaceId')
  return c.json(notes.searchNotes(c.get('user'), c.req.query('q') ?? '', space ? idParam(space) : undefined))
})
api.get('/spaces/:id/pages', (c) =>
  c.json(notes.listSpacePages(c.get('user'), idParam(c.req.param('id')), c.req.query('trash') === '1')))
api.post('/spaces/:id/pages', async (c) =>
  c.json(notes.createPage(c.get('user'), idParam(c.req.param('id')), await body(c))))
api.delete('/spaces/:id/trash', (c) => {
  notes.emptySpaceTrash(c.get('user'), idParam(c.req.param('id'))).forEach(removeUpload)
  return c.json({ ok: true })
})
api.put('/spaces/:id/pages/order', async (c) => {
  const { pages } = (await body(c)) as { pages?: { id: number; parentId: number | null }[] }
  notes.reorderPages(c.get('user'), idParam(c.req.param('id')), pages ?? [])
  return c.json({ ok: true })
})
api.put('/notes/:id/move', async (c) => c.json(notes.movePage(c.get('user'), idParam(c.req.param('id')), await body(c))))

api.get('/notes/:id', (c) => c.json(notes.getNote(c.get('user'), idParam(c.req.param('id')))))
api.put('/notes/:id', async (c) => c.json(notes.updateNote(c.get('user'), idParam(c.req.param('id')), await body(c))))
api.delete('/notes/:id', (c) => {
  notes.trashNote(c.get('user'), idParam(c.req.param('id')))
  return c.json({ ok: true })
})
api.post('/notes/:id/restore', (c) => c.json(notes.restoreNote(c.get('user'), idParam(c.req.param('id')))))
api.delete('/notes/:id/forever', (c) => {
  notes.deleteNoteForever(c.get('user'), idParam(c.req.param('id'))).forEach(removeUpload)
  return c.json({ ok: true })
})

const MAX_IMAGE = 25 * 1024 * 1024
api.post('/note-images', async (c) => {
  const mime = c.req.header('content-type') ?? ''
  if (!mime.startsWith('image/')) store.fail(400, 'Only images can be pasted into notes')
  if (Number(c.req.header('content-length') ?? 0) > MAX_IMAGE) store.fail(400, 'Images can be up to 25 MB')
  const { stored, size } = await receiveUpload(c, `${c.get('user').id}/notes/`)
  if (size > MAX_IMAGE) {
    removeUpload(stored)
    store.fail(400, 'Images can be up to 25 MB')
  }
  const id = basename(stored).replace(/\.[^.]*$/, '')
  notes.addNoteImage(c.get('user'), { id, path: stored, mime, size })
  return c.json({ id, url: `/api/note-images/${id}` })
})
api.get('/note-images/:id', (c) => {
  const img = notes.noteImage(c.get('user'), c.req.param('id'))
  const full = join(UPLOAD_DIR, img.file_path)
  if (!existsSync(full)) store.fail(404, 'The image file is missing')
  return c.body(Readable.toWeb(createReadStream(full)) as ReadableStream, 200, {
    'Content-Type': img.mime, 'Content-Length': String(statSync(full).size), 'Cache-Control': 'private, max-age=31536000, immutable',
  })
})

// Uploads stream straight to disk so large videos never sit in memory.
api.put('/resources/:id/file', async (c) => {
  const u = c.get('user')
  const id = idParam(c.req.param('id'))
  store.resourceRow(u, id)
  const name = decodeURIComponent(c.req.header('x-file-name') ?? 'file')
  const mime = c.req.header('content-type') ?? 'application/octet-stream'
  const raw = c.req.raw.body
  if (!raw) store.fail(400, 'The upload was empty')
  const stored = `${u.id}/${randomUUID()}${extname(name).toLowerCase().slice(0, 10)}`
  const full = join(UPLOAD_DIR, stored)
  mkdirSync(dirname(full), { recursive: true })
  try {
    await pipeline(Readable.fromWeb(raw as import('node:stream/web').ReadableStream), createWriteStream(full))
  } catch (e) {
    if (existsSync(full)) unlinkSync(full)
    throw e
  }
  const size = statSync(full).size
  const prev = store.setResourceFile(u, id, { path: stored, name, mime, size })
  if (prev) removeUpload(prev)
  return c.json(store.getResource(u, id))
})

api.get('/resources/:id/file', (c) => {
  const row = store.resourceRow(c.get('user'), idParam(c.req.param('id')))
  if (!row.file_path) store.fail(404, 'No file uploaded for this resource')
  const full = join(UPLOAD_DIR, row.file_path!)
  if (!existsSync(full)) store.fail(404, 'The file is missing from the uploads folder')
  const size = statSync(full).size
  const headers: Record<string, string> = {
    'Content-Type': row.file_mime ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.file_name ?? 'file')}`,
    'Cache-Control': 'private, max-age=3600',
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('range') ?? '')
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2])
    let end = range[1] && range[2] ? Number(range[2]) : size - 1
    start = Math.max(0, start)
    end = Math.min(end, size - 1)
    if (start > end) return c.body(null, 416, { 'Content-Range': `bytes */${size}` })
    const stream = Readable.toWeb(createReadStream(full, { start, end })) as ReadableStream
    return c.body(stream, 206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) })
  }
  return c.body(Readable.toWeb(createReadStream(full)) as ReadableStream, 200, { ...headers, 'Content-Length': String(size) })
})

// ---------- history ----------

api.get('/history/work', (c) => {
  const t = c.req.query('type')
  return c.json(store.workHistory(c.get('user'), c.req.query('before') || undefined, 14, t ? typeParam(t) : undefined))
})

api.get('/history/completions', (c) => {
  const t = c.req.query('type')
  return c.json(store.completionHistory(c.get('user'), {
    type: t ? typeParam(t) : undefined,
    order: c.req.query('order') === 'asc' ? 'asc' : 'desc',
    offset: Math.max(0, Number(c.req.query('offset') ?? 0) || 0),
    limit: 100,
  }))
})

app.route('/api', api)

// In production the server also hands out the built web app.
const dist = join(import.meta.dirname, '..', 'web', 'dist')
const indexFile = join(dist, 'index.html')
/** Changes with every build, so an open app can notice it's out of date. */
export const BUILD = existsSync(indexFile) ? String(statSync(indexFile).mtimeMs) : 'dev'

if (existsSync(dist)) {
  const root = relative(process.cwd(), dist)
  // The page itself must never be cached, or an updated app can keep serving the old one.
  // Everything under /assets has a content hash in its name, so it can be cached forever.
  app.use('/*', async (c, next) => {
    await next()
    const path = c.req.path
    if (path.startsWith('/assets/') || path.startsWith('/icons/')) c.header('Cache-Control', 'public, max-age=31536000, immutable')
    else if (path === '/' || path.endsWith('.html') || path.endsWith('.webmanifest') || path.endsWith('sw.js')) c.header('Cache-Control', 'no-store')
  })
  app.use('/*', serveStatic({ root }))
  app.get('*', serveStatic({ root, path: 'index.html' }))
}

/** Empties the Trash of notes older than 30 days, and their images. */
/**
 * Empties old Trash. It can only reach vaults that are open, so anyone signed out is done the next
 * time they sign in — nothing is lost by waiting.
 */
export function purgeTrash() {
  for (const { userId, conn } of vault.openVaults()) {
    try {
      useConnection(conn, () => notes.purgeExpired().forEach(removeUpload))
    } catch (e) {
      console.error(`Trash cleanup failed for user ${userId}`, e)
    }
  }
}
