// Integration tests: the real Hono app against a real SQLite database in a temp folder, driven
// through requests the way the browser drives it. No port, no browser — app.fetch is enough.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import Database from 'better-sqlite3-multiple-ciphers'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// db.ts reads DATA_DIR when it loads, so this has to be set before the app is imported.
const dir = mkdtempSync(join(tmpdir(), 'deskwork-test-'))
process.env.DATA_DIR = dir
const { app } = await import('../server/app.ts')
const vault = await import('../server/vault.ts')
const { keyHex, unwrap, wrappingKey } = await import('../server/keys.ts')

let cookie = ''
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.fetch(new Request(`http://test${path}`, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  }))
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}
const ok = async (method: string, path: string, body?: unknown) => {
  const r = await call(method, path, body)
  assert.equal(r.status, 200, `${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`)
  return r.body
}

before(async () => {
  // An empty database has no accounts: the first one is made through setup, which signs it in.
  assert.deepEqual(await ok('GET', '/api/auth/setup'), { needed: true })
  assert.equal((await call('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).status, 401)
  const me = await ok('POST', '/api/auth/setup', { username: 'admin', password: 'admin', timezone: 'Europe/Berlin' })
  assert.equal(me.isAdmin, true)
  assert.equal(me.settings.timezone, 'Europe/Berlin')
})
after(() => rmSync(dir, { recursive: true, force: true }))

test('setup only works once, so nobody can make a second admin through it', async () => {
  assert.deepEqual(await ok('GET', '/api/auth/setup'), { needed: false })
  const saved = cookie
  cookie = ''
  const r = await call('POST', '/api/auth/setup', { username: 'intruder', password: 'secret' })
  assert.equal(r.status, 409)
  assert.equal((await call('POST', '/api/auth/login', { username: 'intruder', password: 'secret' })).status, 401)
  cookie = saved
})

test('a request without a session is refused', async () => {
  const saved = cookie
  cookie = ''
  assert.equal((await call('GET', '/api/spaces')).status, 401)
  // This one deletes a file on the Mac, so it especially must not answer strangers.
  assert.equal((await call('POST', '/api/launcher/retire')).status, 401)
  // And this one runs Homebrew and restarts the server.
  assert.equal((await call('POST', '/api/update')).status, 401)
  assert.equal((await call('GET', '/api/update')).status, 401)
  cookie = saved
})

test('a copy that Homebrew did not install does not offer to update itself', async () => {
  const status = await ok('POST', '/api/update')
  assert.equal(status.state, 'failed')
  assert.match(status.error, /not installed with Homebrew/)
})

test('a new goal gets a space of its own, and notes land in it', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Learn Hebrew', budgetMinutes: 30 })
  assert.ok(goal.spaceId, 'the goal points at a space')

  const spaces = await ok('GET', '/api/spaces')
  const space = spaces.find((s: { id: number }) => s.id === goal.spaceId)
  assert.equal(space.name, 'Learn Hebrew')
  assert.equal(space.slug, 'learn-hebrew')
  assert.equal(space.goalId, goal.id)

  const note = await ok('POST', `/api/goals/${goal.id}/notes`, { title: 'Binyanim' })
  assert.equal(note.spaceId, goal.spaceId)
  assert.equal(note.slug, 'binyanim')
  assert.deepEqual((await ok('GET', `/api/spaces/${goal.spaceId}/pages`)).map((p: { title: string }) => p.title),
    ['Learn Hebrew', 'Binyanim'], 'the space home page comes first')
})

test('deleting a goal keeps its pages, in its space', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Throwaway', budgetMinutes: 10 })
  const note = await ok('POST', `/api/goals/${goal.id}/notes`, { title: 'Worth keeping' })
  await ok('DELETE', `/api/goals/${goal.id}`)

  const after = await ok('GET', `/api/notes/${note.id}`)
  assert.equal(after.title, 'Worth keeping')
  assert.equal(after.spaceId, goal.spaceId, 'still in the space')
  assert.equal(after.itemType, null, 'no longer points at a goal')
  assert.equal(after.itemTitle, null)
})

test('pages rearrange, and a page in the Trash does not block it', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Tree test', budgetMinutes: 10 })
  const space = goal.spaceId
  const a = await ok('POST', `/api/spaces/${space}/pages`, { title: 'A' })
  const b = await ok('POST', `/api/spaces/${space}/pages`, { title: 'B' })
  const c = await ok('POST', `/api/spaces/${space}/pages`, { title: 'C' })

  // The regression: a trashed page is out of the tree, so it isn't part of the arrangement sent.
  const gone = await ok('POST', `/api/spaces/${space}/pages`, { title: 'Trashed' })
  await ok('DELETE', `/api/notes/${gone.id}`)

  const home = (await ok('GET', '/api/spaces')).find((s: { id: number }) => s.id === space).homeId
  await ok('PUT', `/api/spaces/${space}/pages/order`, {
    pages: [{ id: home, parentId: null }, { id: c.id, parentId: home }, { id: a.id, parentId: c.id }, { id: b.id, parentId: a.id }],
  })
  assert.deepEqual(
    (await ok('GET', `/api/spaces/${space}/pages`)).map((p: { title: string; parentId: number | null }) => [p.title, p.parentId]),
    [['Tree test', null], ['C', home], ['A', c.id], ['B', a.id]],
  )
  assert.deepEqual((await ok('GET', `/api/spaces/${space}/pages?trash=1`)).map((p: { title: string }) => p.title), ['Trashed'])
})

test('a rearrangement that would make a loop or lose a page is refused', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Guards', budgetMinutes: 10 })
  const space = goal.spaceId
  const a = await ok('POST', `/api/spaces/${space}/pages`, { title: 'A' })
  const b = await ok('POST', `/api/spaces/${space}/pages`, { title: 'B' })
  const elsewhere = await ok('POST', '/api/goals', { title: 'Another space', budgetMinutes: 10 })
  const far = await ok('POST', `/api/spaces/${elsewhere.spaceId}/pages`, { title: 'Far' })

  const home = (await ok('GET', '/api/spaces')).find((s: { id: number }) => s.id === space).homeId
  const bad = [
    [{ id: home, parentId: null }, { id: b.id, parentId: a.id }, { id: a.id, parentId: home }], // child before its parent
    [{ id: home, parentId: null }, { id: a.id, parentId: a.id }, { id: b.id, parentId: home }], // its own parent
    [{ id: home, parentId: null }, { id: a.id, parentId: home }], // a page left out
    [{ id: home, parentId: null }, { id: a.id, parentId: home }, { id: b.id, parentId: home }, { id: far.id, parentId: home }],
    [{ id: a.id, parentId: null }, { id: home, parentId: a.id }, { id: b.id, parentId: home }], // the home page filed under a page
  ]
  for (const pages of bad) {
    assert.equal((await call('PUT', `/api/spaces/${space}/pages/order`, { pages })).status, 400)
  }
  // Nothing moved: the home page at the top, the other two under it.
  assert.deepEqual((await ok('GET', `/api/spaces/${space}/pages`)).map((p: { parentId: number | null }) => p.parentId),
    [null, home, home])
})

test('a page moved to another space takes its children along', async () => {
  const from = await ok('POST', '/api/goals', { title: 'From', budgetMinutes: 10 })
  const to = await ok('POST', '/api/goals', { title: 'To', budgetMinutes: 10 })
  const parent = await ok('POST', `/api/spaces/${from.spaceId}/pages`, { title: 'Parent' })
  const child = await ok('POST', `/api/spaces/${from.spaceId}/pages`, { title: 'Child', parentId: parent.id })

  await ok('PUT', `/api/notes/${parent.id}/move`, { spaceId: to.spaceId })
  assert.equal((await ok('GET', `/api/notes/${child.id}`)).spaceId, to.spaceId)
  // Only the home page is left behind; it belongs to the space, not to what was filed in it.
  assert.deepEqual((await ok('GET', `/api/spaces/${from.spaceId}/pages`)).map((p: { title: string }) => p.title), ['From'])
})

test('a space holding pages cannot be deleted', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Full space', budgetMinutes: 10 })
  await ok('POST', `/api/spaces/${goal.spaceId}/pages`, { title: 'In the way' })
  assert.equal((await call('DELETE', `/api/spaces/${goal.spaceId}`)).status, 409)
})

test('renaming a space moves its slug with it', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Before', budgetMinutes: 10 })
  const renamed = await ok('PUT', `/api/spaces/${goal.spaceId}`, { name: 'After the rename' })
  assert.equal(renamed.slug, 'after-the-rename')
})

test('search finds pages by their words, and ranks a title match first', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Searchable', budgetMinutes: 10 })
  const space = goal.spaceId
  await ok('POST', `/api/spaces/${space}/pages`, {
    title: 'Binyanim',
    body: 'The **hitpael** pattern is reflexive. See [the notes](https://example.com/paradigm).',
  })
  await ok('POST', `/api/spaces/${space}/pages`, { title: 'Grammar', body: 'A long page about binyanim and much else besides, going on at some length.' })
  const other = await ok('POST', `/api/spaces/${space}/pages`, { title: 'Reading list', body: 'A page mentioning hitpael once.' })

  const hits = await ok('GET', '/api/search?q=hitpael')
  assert.equal(hits.length, 2)
  assert.match(hits[0].snippet, /«hitpael»/, 'the match is marked')
  assert.equal(hits[0].spaceName, 'Searchable')

  // A word in the title counts for more than the same word buried in a page.
  const titled = await ok('GET', '/api/search?q=binyanim')
  assert.equal(titled[0].title, 'Binyanim')

  // Markdown is not indexed, so neither punctuation nor a link address counts as a match.
  assert.equal((await ok('GET', '/api/search?q=example')).length, 0)
  assert.equal((await ok('GET', '/api/search?q=paradigm')).length, 0)

  // Typing part of a word still finds it.
  assert.equal((await ok('GET', '/api/search?q=reflex')).length, 1)
  assert.equal((await ok('GET', '/api/search?q=reflex')).length, 1)

  // Scoped to one space.
  const elsewhere = await ok('POST', '/api/goals', { title: 'Elsewhere', budgetMinutes: 10 })
  await ok('POST', `/api/spaces/${elsewhere.spaceId}/pages`, { title: 'Far', body: 'hitpael again' })
  assert.equal((await ok('GET', '/api/search?q=hitpael')).length, 3)
  assert.equal((await ok('GET', `/api/search?q=hitpael&spaceId=${space}`)).length, 2)

  // An edit updates the index; the Trash takes a page out of it.
  await ok('PUT', `/api/notes/${other.id}`, { body: 'Nothing of interest now.' })
  assert.equal((await ok('GET', `/api/search?q=hitpael&spaceId=${space}`)).length, 1)
  assert.equal((await ok('GET', '/api/search?q=interest')).length, 1)
  await ok('DELETE', `/api/notes/${other.id}`)
  assert.equal((await ok('GET', '/api/search?q=interest')).length, 0)
})

test('a page nested under others says where it sits', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Deep', budgetMinutes: 10 })
  const top = await ok('POST', `/api/spaces/${goal.spaceId}/pages`, { title: 'Hebrew' })
  const mid = await ok('POST', `/api/spaces/${goal.spaceId}/pages`, { title: 'Verbs', parentId: top.id })
  await ok('POST', `/api/spaces/${goal.spaceId}/pages`, { title: 'Leaf', parentId: mid.id, body: 'zzxxqq' })

  const [hit] = await ok('GET', '/api/search?q=zzxxqq')
  // The space's home page is not repeated in the trail: the space is already named beside it.
  assert.equal(hit.path, 'Hebrew › Verbs')
})

test('search never reaches another user', async () => {
  await ok('POST', '/api/users', { username: 'someone', password: 'another-password' })
  const mine = await ok('GET', '/api/search?q=hitpael')
  assert.ok(mine.length > 0)

  const saved = cookie
  cookie = ''
  await ok('POST', '/api/auth/login', { username: 'someone', password: 'another-password' })
  assert.deepEqual(await ok('GET', '/api/search?q=hitpael'), [])
  cookie = saved
})

test('links are recorded, and the page linked to knows about it', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Linking', budgetMinutes: 10 })
  const target = await ok('POST', `/api/spaces/${goal.spaceId}/pages`, { title: 'Verb patterns' })
  const source = await ok('POST', `/api/spaces/${goal.spaceId}/pages`, {
    title: 'Session notes',
    body: `Drilled [Verb patterns](deskwork:page/${target.id}) for [Linking](deskwork:goal/${goal.id}).`,
  })

  const onPage = await ok('GET', `/api/backlinks/pages/${target.id}`)
  assert.equal(onPage.length, 1)
  assert.equal(onPage[0].id, source.id)
  assert.equal(onPage[0].title, 'Session notes')
  assert.equal(onPage[0].spaceName, 'Linking')

  const onGoal = await ok('GET', `/api/backlinks/goals/${goal.id}`)
  assert.deepEqual(onGoal.map((b: { id: number }) => b.id), [source.id])

  // Removing the link removes the backlink.
  await ok('PUT', `/api/notes/${source.id}`, { body: 'Nothing linked now.' })
  assert.deepEqual(await ok(`GET`, `/api/backlinks/pages/${target.id}`), [])
  assert.deepEqual(await ok('GET', `/api/backlinks/goals/${goal.id}`), [])
})

test('a renamed target reads right wherever it was linked', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Before the rename', budgetMinutes: 10 })
  const page = await ok('POST', `/api/spaces/${goal.spaceId}/pages`, {
    body: `Working on [Before the rename](deskwork:goal/${goal.id}).`,
  })
  await ok('PUT', `/api/goals/${goal.id}`, { title: 'After the rename' })

  const reread = await ok('GET', `/api/notes/${page.id}`)
  assert.match(reread.body, /\[After the rename\]\(deskwork:goal\/\d+\)/)
})

test('a page in the Trash stops being a mention', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Trash and links', budgetMinutes: 10 })
  const target = await ok('POST', `/api/spaces/${goal.spaceId}/pages`, { title: 'Target' })
  const source = await ok('POST', `/api/spaces/${goal.spaceId}/pages`, { body: `[Target](deskwork:page/${target.id})` })
  assert.equal((await ok('GET', `/api/backlinks/pages/${target.id}`)).length, 1)
  await ok('DELETE', `/api/notes/${source.id}`)
  assert.equal((await ok('GET', `/api/backlinks/pages/${target.id}`)).length, 0)
})

test('the link picker offers pages, goals and tasks by name', async () => {
  await ok('POST', '/api/goals', { title: 'Zebra goal', budgetMinutes: 10 })
  await ok('POST', '/api/tasks', { title: 'Zebra task' })
  const targets = await ok('GET', '/api/link-targets?q=zebra')
  // The goal's space and its home page are both named after the goal, so they show up too.
  assert.deepEqual(targets.map((t: { kind: string; title: string }) => `${t.kind}:${t.title}`).sort(),
    ['goal:Zebra goal', 'page:Zebra goal', 'task:Zebra task'])
  for (const t of targets) assert.match(t.address, /^deskwork:(page|goal|task)\/\d+$/)

  // A wildcard typed into the box is matched literally, not as a pattern.
  assert.deepEqual(await ok('GET', '/api/link-targets?q=%25'), [])
})

test('a new task goes to the top of the list, even after the list was reordered', async () => {
  const titles = async () => (await ok('GET', '/api/tasks')).map((t: { title: string }) => t.title).filter((t: string) => t.startsWith('Order '))
  const a = await ok('POST', '/api/tasks', { title: 'Order A' })
  const b = await ok('POST', '/api/tasks', { title: 'Order B' })
  assert.deepEqual(await titles(), ['Order B', 'Order A'])
  await ok('PUT', '/api/tasks/layout', { entries: [{ task: a.id }, { task: b.id }] })
  await ok('POST', '/api/tasks', { title: 'Order C' })
  assert.deepEqual(await titles(), ['Order C', 'Order A', 'Order B'])
})

test('tasks can be grouped into a folder, moved in and out of it, and ungrouped', async () => {
  type T = { id: number; title: string; folderId: number | null }
  // The list as the Tasks window shows it: "Fold C", or "Errands[Fold B, Fold A]" for a folder.
  const shape = async () => {
    const d = await ok('GET', '/api/dashboard')
    const out: string[] = []
    let last: number | null = null
    for (const t of (d.tasks as T[]).filter((t) => t.title.startsWith('Fold '))) {
      if (t.folderId === null) out.push(t.title)
      else if (t.folderId === last) out[out.length - 1] = out[out.length - 1].replace(']', `, ${t.title}]`)
      else out.push(`${d.taskFolders.find((f: { id: number }) => f.id === t.folderId).title}[${t.title}]`)
      last = t.folderId
    }
    return out
  }
  const [a, b, c, d] = [
    await ok('POST', '/api/tasks', { title: 'Fold A' }), await ok('POST', '/api/tasks', { title: 'Fold B' }),
    await ok('POST', '/api/tasks', { title: 'Fold C' }), await ok('POST', '/api/tasks', { title: 'Fold D' }),
  ]
  assert.deepEqual(await shape(), ['Fold D', 'Fold C', 'Fold B', 'Fold A'])

  // Dropping A on B makes a folder where B was. It starts closed, with a name to change.
  const folder = await ok('POST', '/api/task-folders', { taskIds: [b.id, a.id] })
  assert.deepEqual({ title: folder.title, collapsed: folder.collapsed }, { title: 'New folder', collapsed: true })
  assert.deepEqual(await shape(), ['Fold D', 'Fold C', 'New folder[Fold B, Fold A]'])
  assert.equal((await call('POST', '/api/task-folders', { taskIds: [c.id] })).status, 400)

  const opened = await ok('PUT', `/api/task-folders/${folder.id}`, { title: 'Errands', collapsed: false })
  assert.deepEqual({ title: opened.title, collapsed: opened.collapsed }, { title: 'Errands', collapsed: false })
  assert.equal((await call('PUT', `/api/task-folders/${folder.id}`, { title: '  ' })).status, 400)

  // D goes into the folder between B and A, and the folder moves above C.
  await ok('PUT', '/api/tasks/layout', { entries: [{ folder: folder.id, tasks: [b.id, d.id, a.id] }, { task: c.id }] })
  assert.deepEqual(await shape(), ['Errands[Fold B, Fold D, Fold A]', 'Fold C'])
  // The flat list of all tasks still has every one of them, each knowing its folder.
  const flat = (await ok('GET', '/api/tasks') as T[]).filter((t) => t.title.startsWith('Fold '))
  assert.deepEqual(flat.map((t) => [t.title, t.folderId === folder.id]),
    [['Fold B', true], ['Fold D', true], ['Fold A', true], ['Fold C', false]])

  // A new task still lands on top, above the folder.
  const e = await ok('POST', '/api/tasks', { title: 'Fold E' })
  assert.deepEqual(await shape(), ['Fold E', 'Errands[Fold B, Fold D, Fold A]', 'Fold C'])

  // A list that names a task twice, or one that doesn't exist, changes nothing.
  assert.equal((await call('PUT', '/api/tasks/layout', { entries: [{ task: a.id }, { folder: folder.id, tasks: [a.id] }] })).status, 400)
  assert.equal((await call('PUT', '/api/tasks/layout', { entries: [{ task: 999999 }] })).status, 400)
  assert.deepEqual(await shape(), ['Fold E', 'Errands[Fold B, Fold D, Fold A]', 'Fold C'])

  // Ungrouping leaves the tasks where the folder was, in the same order.
  await ok('DELETE', `/api/task-folders/${folder.id}`)
  assert.deepEqual(await shape(), ['Fold E', 'Fold B', 'Fold D', 'Fold A', 'Fold C'])

  // A folder goes away by itself when its last task is dragged out…
  const second = await ok('POST', '/api/task-folders', { taskIds: [c.id, e.id], title: 'Second' })
  assert.deepEqual(await shape(), ['Fold B', 'Fold D', 'Fold A', 'Second[Fold C, Fold E]'])
  await ok('PUT', '/api/tasks/layout', { entries: [{ task: e.id }, { task: c.id }, { task: b.id }, { task: d.id }, { task: a.id }] })
  assert.deepEqual(await shape(), ['Fold E', 'Fold C', 'Fold B', 'Fold D', 'Fold A'])
  assert.equal((await call('PUT', `/api/task-folders/${second.id}`, { collapsed: false })).status, 404)

  // …or deleted.
  const third = await ok('POST', '/api/task-folders', { taskIds: [a.id, b.id], title: 'Third' })
  await ok('DELETE', `/api/tasks/${a.id}`)
  assert.deepEqual(await shape(), ['Fold E', 'Fold C', 'Fold D', 'Third[Fold B]'])
  await ok('DELETE', `/api/tasks/${b.id}`)
  assert.equal((await call('PUT', `/api/task-folders/${third.id}`, { collapsed: false })).status, 404)
})

test('a new task can be made at a spot in the list: between two tasks, or inside a folder', async () => {
  type T = { id: number; title: string; folderId: number | null }
  // "Spot A", or "(Spot B, Spot C)" for the tasks of a folder.
  const shape = async () => {
    const mine = ((await ok('GET', '/api/dashboard')).tasks as T[]).filter((t) => t.title.startsWith('Spot '))
    return mine.map((t, i) => {
      const opens = t.folderId !== null && mine[i - 1]?.folderId !== t.folderId
      const closes = t.folderId !== null && mine[i + 1]?.folderId !== t.folderId
      return `${opens ? '(' : ''}${t.title}${closes ? ')' : ''}`
    }).join(', ')
  }
  const a = await ok('POST', '/api/tasks', { title: 'Spot A' })
  const b = await ok('POST', '/api/tasks', { title: 'Spot B' })
  const c = await ok('POST', '/api/tasks', { title: 'Spot C' })
  const folder = await ok('POST', '/api/task-folders', { taskIds: [b.id, a.id] })
  assert.equal(await shape(), 'Spot C, (Spot B, Spot A)')

  // 0 stands for the task being made. Between C and the folder: a task of its own.
  const d = await ok('POST', '/api/tasks', { title: 'Spot D', layout: [{ task: c.id }, { task: 0 }, { folder: folder.id, tasks: [b.id, a.id] }] })
  assert.equal(d.folderId, null)
  assert.equal(await shape(), 'Spot C, Spot D, (Spot B, Spot A)')

  // Between the two tasks of the folder: it belongs to the folder.
  const e = await ok('POST', '/api/tasks', {
    title: 'Spot E', layout: [{ task: c.id }, { task: d.id }, { folder: folder.id, tasks: [b.id, 0, a.id] }],
  })
  assert.equal(e.folderId, folder.id)
  assert.equal(await shape(), 'Spot C, Spot D, (Spot B, Spot E, Spot A)')

  // At the very end.
  await ok('POST', '/api/tasks', {
    title: 'Spot F', layout: [{ task: c.id }, { task: d.id }, { folder: folder.id, tasks: [b.id, e.id, a.id] }, { task: 0 }],
  })
  assert.equal(await shape(), 'Spot C, Spot D, (Spot B, Spot E, Spot A), Spot F')

  // A list that is out of date makes no task at all.
  const stale = await call('POST', '/api/tasks', { title: 'Spot G', layout: [{ task: 0 }, { task: 999999 }] })
  assert.equal(stale.status, 400)
  assert.equal(await shape(), 'Spot C, Spot D, (Spot B, Spot E, Spot A), Spot F')
})

test('a failure inside a nested transaction rolls the whole thing back', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Rollback', budgetMinutes: 10 })
  const page = await ok('POST', `/api/spaces/${goal.spaceId}/pages`, { title: 'Kept', body: 'original text' })

  // A move to a page that is its own child is refused; nothing about the page may change.
  assert.equal((await call('PUT', `/api/notes/${page.id}/move`, { parentId: page.id })).status, 400)
  const after = await ok('GET', `/api/notes/${page.id}`)
  assert.equal(after.body, 'original text')
  assert.equal(after.spaceId, goal.spaceId)
})

test('a vault on disk is ciphertext, and the shared database holds no content', async () => {
  const goal = await ok('POST', '/api/goals', { title: 'Zebra striped findable goal', budgetMinutes: 10 })
  await ok('POST', `/api/spaces/${goal.spaceId}/pages`, { title: 'Findable page', body: 'a distinctive sentence' })

  const vault = readFileSync(join(dir, 'vault-1.db'))
  assert.equal(vault.includes(Buffer.from('Zebra striped findable goal')), false, 'no goal titles on disk')
  assert.equal(vault.includes(Buffer.from('a distinctive sentence')), false, 'no note text on disk')
  assert.equal(vault.includes(Buffer.from('SQLite format 3')), false, 'not even recognisable as a database')

  // The shared file keeps accounts and sessions, and must not have gained content tables.
  const shared = new Database(join(dir, 'deskwork.db'), { readonly: true })
  const tables = shared.prepare(`SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .all().map((r: { name: string }) => r.name)
  shared.close()
  assert.deepEqual(tables.filter((t) => t === 'goals' || t === 'notes'), [], 'content lives only in vaults')
  assert.ok(tables.includes('users') && tables.includes('sessions'))
})

test('the vault cannot be opened without the password', async () => {
  const file = join(dir, 'vault-1.db')
  const wrong = new Database(file)
  wrong.pragma(`key = "x'${'11'.repeat(32)}'"`)
  assert.throws(() => wrong.prepare('SELECT count(*) FROM goals').get(), /not a database|encrypted/i)
  wrong.close()
})

test('signing out locks the vault until the password is given again', async () => {
  assert.equal((await call('GET', '/api/goals')).status, 200)
  await ok('POST', '/api/auth/logout')

  // The session is gone and so is the key: both halves of signing out.
  assert.equal((await call('GET', '/api/goals')).status, 401)
  assert.equal(vault.isUnlocked(1), false, 'the key is no longer in memory')

  await ok('POST', '/api/auth/login', { username: 'admin', password: 'admin' })
  assert.equal((await call('GET', '/api/goals')).status, 200)
})

test('a changed password re-locks the same data, which survives', async () => {
  const before = (await ok('GET', '/api/goals')).length
  await ok('PUT', '/api/me/password', { current: 'admin', next: 'a longer password' })

  await ok('POST', '/api/auth/logout')
  assert.equal((await call('POST', '/api/auth/login', { username: 'admin', password: 'admin' })).status, 401)

  await ok('POST', '/api/auth/login', { username: 'admin', password: 'a longer password' })
  assert.equal((await ok('GET', '/api/goals')).length, before, 'everything is still there')
  await ok('PUT', '/api/me/password', { current: 'a longer password', next: 'admin' })
})

test('an admin cannot reset another account’s password', async () => {
  const them = await ok('POST', '/api/users', { username: 'otherperson', password: 'their own password' })
  const refused = await call('PUT', `/api/users/${them.id}`, { password: 'set by an admin' })
  assert.equal(refused.status, 400)
  assert.match(refused.body.error, /owner/i)

  // Their own password still works, which is the point.
  const saved = cookie
  cookie = ''
  await ok('POST', '/api/auth/login', { username: 'otherperson', password: 'their own password' })
  assert.equal((await call('GET', '/api/goals')).status, 200)
  await ok('POST', '/api/auth/logout')
  cookie = saved
})

test('deleting an account takes its vault with it', async () => {
  const them = await ok('POST', '/api/users', { username: 'temporary', password: 'a password' })
  const saved = cookie
  cookie = ''
  await ok('POST', '/api/auth/login', { username: 'temporary', password: 'a password' })
  await ok('POST', '/api/goals', { title: 'Theirs', budgetMinutes: 10 })
  cookie = saved
  assert.equal(existsSync(join(dir, `vault-${them.id}.db`)), true)

  await ok('DELETE', `/api/users/${them.id}`)
  assert.equal(existsSync(join(dir, `vault-${them.id}.db`)), false)
})

test('a vault made before home pages existed is repaired when it is next opened', async () => {
  // Build a space the normal way, then wind that vault back to how it looked before home pages:
  // no home_id column, no home page, pages sitting at the top. This is what an account that was
  // encrypted an hour before the feature landed actually looks like on disk.
  const them = await ok('POST', '/api/users', { username: 'earlyadopter', password: 'their password' })
  const saved = cookie
  cookie = ''
  await ok('POST', '/api/auth/login', { username: 'earlyadopter', password: 'their password' })
  const goal = await ok('POST', '/api/goals', { title: 'Older vault', budgetMinutes: 10 })
  await ok('POST', `/api/spaces/${goal.spaceId}/pages`, { title: 'Written back then' })
  await ok('POST', '/api/auth/logout')

  const shared = new Database(join(dir, 'deskwork.db'))
  const row = shared.prepare('SELECT key_salt, wrapped_key FROM users WHERE id = ?').get(them.id) as
    { key_salt: string; wrapped_key: string }
  const key = unwrap(row.wrapped_key, wrappingKey('their password', Buffer.from(row.key_salt, 'base64')))!
  shared.exec(`ATTACH DATABASE '${join(dir, `vault-${them.id}.db`)}' AS vault KEY "x'${keyHex(key)}'"`)
  shared.exec(`DELETE FROM vault.notes WHERE id IN (SELECT home_id FROM vault.spaces WHERE home_id IS NOT NULL)`)
  shared.exec('UPDATE vault.notes SET parent_id = NULL')
  shared.exec('ALTER TABLE vault.spaces DROP COLUMN home_id')
  shared.exec('PRAGMA vault.user_version = 1')
  shared.close()

  // Signing in again has to bring it up to date rather than fall over.
  await ok('POST', '/api/auth/login', { username: 'earlyadopter', password: 'their password' })
  const spaces = await ok('GET', '/api/spaces')
  const space = spaces.find((s: { id: number }) => s.id === goal.spaceId)
  assert.ok(space.homeId, 'the space was given a home page')

  const pages = await ok('GET', `/api/spaces/${goal.spaceId}/pages`)
  assert.deepEqual(pages.map((p: { title: string }) => p.title), ['Older vault', 'Written back then'])
  assert.equal(pages.find((p: { title: string }) => p.title === 'Written back then').parentId, space.homeId,
    'what was already there is filed under the new home page')
  await ok('POST', '/api/auth/logout')
  cookie = saved
})

test('a vault that already has the column is not broken by the step that adds it', async () => {
  // The home_id column briefly shipped inside the first migration before being moved into its own
  // step. A vault built in that window has the column but records only one step as done, so the
  // step must notice rather than fail and lock its owner out.
  const them = await ok('POST', '/api/users', { username: 'inbetween', password: 'a password here' })
  const saved = cookie
  cookie = ''
  await ok('POST', '/api/auth/login', { username: 'inbetween', password: 'a password here' })
  await ok('POST', '/api/goals', { title: 'Mid-flight', budgetMinutes: 10 })
  await ok('POST', '/api/auth/logout')

  const shared = new Database(join(dir, 'deskwork.db'))
  const row = shared.prepare('SELECT key_salt, wrapped_key FROM users WHERE id = ?').get(them.id) as
    { key_salt: string; wrapped_key: string }
  const key = unwrap(row.wrapped_key, wrappingKey('a password here', Buffer.from(row.key_salt, 'base64')))!
  shared.exec(`ATTACH DATABASE '${join(dir, `vault-${them.id}.db`)}' AS vault KEY "x'${keyHex(key)}'"`)
  shared.exec('PRAGMA vault.user_version = 1') // the column stays; only the bookkeeping goes back
  shared.close()

  await ok('POST', '/api/auth/login', { username: 'inbetween', password: 'a password here' })
  assert.equal((await call('GET', '/api/spaces')).status, 200)
  await ok('POST', '/api/auth/logout')
  cookie = saved
})

test('a page deleted in a space of your own can be found and restored', async () => {
  // This is what had no way back before: a space with no goal behind it, so no Notes tab to reach.
  const space = await ok('POST', '/api/spaces', { name: 'My own space' })
  const page = await ok('POST', `/api/spaces/${space.id}/pages`, { title: 'Deleted by mistake', body: 'worth keeping' })
  await ok('DELETE', `/api/notes/${page.id}`)

  assert.deepEqual((await ok('GET', `/api/spaces/${space.id}/pages`)).map((p: { title: string }) => p.title), ['My own space'])
  const trash = await ok('GET', `/api/spaces/${space.id}/pages?trash=1`)
  assert.deepEqual(trash.map((p: { title: string }) => p.title), ['Deleted by mistake'])
  assert.ok(trash[0].deletedAt)

  const back = await ok('POST', `/api/notes/${page.id}/restore`)
  assert.equal(back.body, 'worth keeping')
  assert.equal(back.parentId, space.homeId, 'it comes back under the home page, where it can be seen')
  assert.deepEqual((await ok('GET', `/api/spaces/${space.id}/pages?trash=1`)), [])
})

test('a restored page whose parent is gone still comes back somewhere visible', async () => {
  const space = await ok('POST', '/api/spaces', { name: 'Orphans' })
  const parent = await ok('POST', `/api/spaces/${space.id}/pages`, { title: 'Section' })
  const child = await ok('POST', `/api/spaces/${space.id}/pages`, { title: 'Inside it', parentId: parent.id })

  await ok('DELETE', `/api/notes/${child.id}`)
  await ok('DELETE', `/api/notes/${parent.id}`)
  await ok('POST', `/api/notes/${child.id}/restore`)

  const pages = await ok('GET', `/api/spaces/${space.id}/pages`)
  const restored = pages.find((p: { id: number }) => p.id === child.id)
  assert.equal(restored.parentId, space.homeId, 'filed under the home page rather than under a page in the Trash')
})

test('emptying a space’s Trash deletes those pages for good, and no others', async () => {
  const space = await ok('POST', '/api/spaces', { name: 'Emptying' })
  const keep = await ok('POST', `/api/spaces/${space.id}/pages`, { title: 'Still wanted' })
  const binned = await ok('POST', `/api/spaces/${space.id}/pages`, { title: 'Not wanted' })
  const elsewhere = await ok('POST', '/api/spaces', { name: 'Untouched' })
  const alsoBinned = await ok('POST', `/api/spaces/${elsewhere.id}/pages`, { title: 'In another space' })
  await ok('DELETE', `/api/notes/${binned.id}`)
  await ok('DELETE', `/api/notes/${alsoBinned.id}`)

  await ok('DELETE', `/api/spaces/${space.id}/trash`)
  assert.equal((await call('GET', `/api/notes/${binned.id}`)).status, 404, 'gone for good')
  assert.equal((await call('GET', `/api/notes/${keep.id}`)).status, 200, 'the live page is untouched')
  assert.equal((await ok('GET', `/api/spaces/${elsewhere.id}/pages?trash=1`)).length, 1, "another space's Trash is untouched")
})

test('a space home page cannot be put in the Trash', async () => {
  const space = await ok('POST', '/api/spaces', { name: 'Keeps its home' })
  const refused = await call('DELETE', `/api/notes/${space.homeId}`)
  assert.equal(refused.status, 400)
  assert.match(refused.body.error, /home page/i)
})

test('an empty space can be deleted, home page and all', async () => {
  const space = await ok('POST', '/api/spaces', { name: 'Short lived' })
  assert.ok(space.homeId, 'it has a home page')
  // Its own home page must not be mistaken for a page left behind.
  await ok('DELETE', `/api/spaces/${space.id}`)
  assert.equal((await ok('GET', '/api/spaces')).some((s: { id: number }) => s.id === space.id), false)
  assert.equal((await call('GET', `/api/notes/${space.homeId}`)).status, 404, 'the home page went with it')
})

test('a space is still protected while anything is in it', async () => {
  const space = await ok('POST', '/api/spaces', { name: 'Not yet' })
  const page = await ok('POST', `/api/spaces/${space.id}/pages`, { title: 'In the way' })
  assert.equal((await call('DELETE', `/api/spaces/${space.id}`)).status, 409)

  await ok('DELETE', `/api/notes/${page.id}`) // now it is only in the Trash
  const inTrash = await call('DELETE', `/api/spaces/${space.id}`)
  assert.equal(inTrash.status, 409)
  assert.match(inTrash.body.error, /Trash/)

  await ok('DELETE', `/api/spaces/${space.id}/trash`)
  await ok('DELETE', `/api/spaces/${space.id}`) // and now it goes
})
