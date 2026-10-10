import Database from 'better-sqlite3-multiple-ciphers'
import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { uniqueSlug } from '../shared/slug.ts'
import { plainText } from '../shared/markdown.ts'

export const DATA_DIR = resolve(process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data'))
export const UPLOAD_DIR = join(DATA_DIR, 'uploads')
mkdirSync(UPLOAD_DIR, { recursive: true })

/** The shared database: accounts and sessions only, readable before anyone has signed in. */
export const dbFile = join(DATA_DIR, 'deskwork.db')
export const db = new Database(dbFile)
// secure_delete overwrites what is deleted instead of leaving it in free pages. The shared
// database is not encrypted — it has to be readable before anyone signs in — so anything that
// ever passes through it should leave no trace when it goes.
db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA secure_delete = ON;`)

// Each entry runs once, in order. Append new migrations; never edit old ones.
// An entry is SQL, or a function when the step needs real code (generating slugs, say).
const migrations: (string | (() => void))[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    settings TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE goals (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    budget_minutes INTEGER NOT NULL,
    points_target INTEGER,
    points_done INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scheduled_day TEXT,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX comments_item ON comments(item_type, item_id);
  CREATE TABLE resources (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    total_pages INTEGER,
    video_source TEXT,
    file_path TEXT,
    file_name TEXT,
    file_mime TEXT,
    file_size INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE item_resources (
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    bookmark_page INTEGER,
    bookmark_seconds REAL,
    bookmark_index INTEGER,
    bookmark_updated_at INTEGER,
    attached_at INTEGER NOT NULL,
    PRIMARY KEY (item_type, item_id, resource_id)
  );
  CREATE TABLE work_sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    item_title TEXT NOT NULL,
    mode TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    seconds INTEGER NOT NULL,
    day TEXT NOT NULL
  );
  CREATE INDEX work_user_day ON work_sessions(user_id, day);
  CREATE INDEX work_item ON work_sessions(item_type, item_id);
  CREATE TABLE completions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    item_title TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    day TEXT NOT NULL,
    seconds INTEGER NOT NULL,
    points INTEGER,
    comment TEXT NOT NULL DEFAULT '',
    via TEXT NOT NULL
  );
  CREATE INDEX completions_user_day ON completions(user_id, day);
  CREATE TABLE timers (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE resource_folders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE resources ADD COLUMN folder_id INTEGER REFERENCES resource_folders(id) ON DELETE SET NULL;
  `,
  `
  ALTER TABLE resource_folders ADD COLUMN parent_id INTEGER REFERENCES resource_folders(id) ON DELETE SET NULL;
  CREATE INDEX resource_folders_parent ON resource_folders(parent_id);
  `,
  `
  CREATE TABLE work_session_resources (
    work_session_id INTEGER NOT NULL REFERENCES work_sessions(id) ON DELETE CASCADE,
    resource_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    from_seconds REAL, to_seconds REAL,
    from_index INTEGER, to_index INTEGER,
    from_page INTEGER, to_page INTEGER,
    PRIMARY KEY (work_session_id, resource_id)
  );
  `,
  `
  CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX notes_item ON notes(item_type, item_id);
  CREATE TABLE note_images (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
    file_path TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE note_events (
    id INTEGER PRIMARY KEY,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX note_events_note ON note_events(note_id, at);
  `,
  `
  ALTER TABLE item_resources ADD COLUMN sync_timer INTEGER;
  `,
  `
  ALTER TABLE goals ADD COLUMN sort_order INTEGER;
  UPDATE goals SET sort_order = id;
  `,
  `
  ALTER TABLE tasks ADD COLUMN sort_order INTEGER;
  UPDATE tasks SET sort_order = id;
  `,
  `
  CREATE TABLE spaces (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    icon TEXT,
    goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
    sort_order INTEGER,
    created_at INTEGER NOT NULL,
    archived_at INTEGER
  );
  CREATE UNIQUE INDEX spaces_slug ON spaces(user_id, slug);
  CREATE INDEX spaces_goal ON spaces(goal_id);
  ALTER TABLE goals ADD COLUMN space_id INTEGER REFERENCES spaces(id) ON DELETE SET NULL;
  ALTER TABLE notes ADD COLUMN space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE;
  ALTER TABLE notes ADD COLUMN parent_id INTEGER REFERENCES notes(id) ON DELETE SET NULL;
  ALTER TABLE notes ADD COLUMN sort_order INTEGER;
  ALTER TABLE notes ADD COLUMN slug TEXT NOT NULL DEFAULT '';
  CREATE INDEX notes_space ON notes(space_id, parent_id, sort_order);
  `,
  // Every goal gets a space, named after it, holding the notes written from it. Notes written on
  // tasks go to one shared "Tasks" space: a space per errand would be clutter.
  () => {
    const now = Date.now()
    const users = db.prepare('SELECT id FROM users').all() as { id: number }[]
    const addSpace = db.prepare(
      'INSERT INTO spaces (user_id, name, slug, goal_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    for (const u of users) {
      const taken: string[] = []
      const goals = db.prepare('SELECT id, title, created_at FROM goals WHERE user_id = ? ORDER BY sort_order, created_at')
        .all(u.id) as { id: number; title: string; created_at: number }[]
      for (const [i, g] of goals.entries()) {
        const slug = uniqueSlug(g.title, taken, `goal-${g.id}`)
        taken.push(slug)
        const spaceId = Number(addSpace.run(u.id, g.title, slug, g.id, i + 1, g.created_at).lastInsertRowid)
        db.prepare('UPDATE goals SET space_id = ? WHERE id = ?').run(spaceId, g.id)
        db.prepare(`UPDATE notes SET space_id = ?, sort_order = id WHERE user_id = ? AND item_type = 'goal' AND item_id = ?`)
          .run(spaceId, u.id, g.id)
      }
      const taskNotes = db.prepare(`SELECT COUNT(*) n FROM notes WHERE user_id = ? AND item_type = 'task'`).get(u.id) as { n: number }
      if (taskNotes.n > 0) {
        const slug = uniqueSlug('Tasks', taken, 'tasks')
        const spaceId = Number(addSpace.run(u.id, 'Tasks', slug, null, goals.length + 1, now).lastInsertRowid)
        db.prepare(`UPDATE notes SET space_id = ?, sort_order = id WHERE user_id = ? AND item_type = 'task'`).run(spaceId, u.id)
      }
    }
    // Pages are found by id, so these slugs only have to be readable, not unique.
    const notes = db.prepare('SELECT id, title FROM notes').all() as { id: number; title: string }[]
    const setSlug = db.prepare('UPDATE notes SET slug = ? WHERE id = ?')
    for (const n of notes) setSlug.run(uniqueSlug(n.title, [], `note-${n.id}`), n.id)
  },
  // Pages are searched as plain words, so Markdown punctuation and link addresses don't count as
  // matches and snippets read like prose. body_text is kept beside the Markdown on every write.
  () => {
    db.exec(`ALTER TABLE notes ADD COLUMN body_text TEXT NOT NULL DEFAULT ''`)
    const rows = db.prepare('SELECT id, body FROM notes').all() as { id: number; body: string }[]
    const fill = db.prepare('UPDATE notes SET body_text = ? WHERE id = ?')
    for (const r of rows) fill.run(plainText(r.body), r.id)
    db.exec(`
      CREATE VIRTUAL TABLE note_search USING fts5(
        title, body_text, content='notes', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
      );
      INSERT INTO note_search(note_search) VALUES('rebuild');
      CREATE TRIGGER notes_search_insert AFTER INSERT ON notes BEGIN
        INSERT INTO note_search(rowid, title, body_text) VALUES (new.id, new.title, new.body_text);
      END;
      CREATE TRIGGER notes_search_delete AFTER DELETE ON notes BEGIN
        INSERT INTO note_search(note_search, rowid, title, body_text) VALUES('delete', old.id, old.title, old.body_text);
      END;
      CREATE TRIGGER notes_search_update AFTER UPDATE ON notes BEGIN
        INSERT INTO note_search(note_search, rowid, title, body_text) VALUES('delete', old.id, old.title, old.body_text);
        INSERT INTO note_search(rowid, title, body_text) VALUES (new.id, new.title, new.body_text);
      END;
    `)
  },
  `
  CREATE TABLE links (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_type TEXT NOT NULL,
    from_id INTEGER NOT NULL,
    to_type TEXT NOT NULL,
    to_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX links_to ON links(to_type, to_id);
  CREATE UNIQUE INDEX links_pair ON links(from_type, from_id, to_type, to_id);
  `,
  `
  ALTER TABLE users ADD COLUMN key_salt TEXT;
  ALTER TABLE users ADD COLUMN wrapped_key TEXT;
  `,
  // Content moves out of the shared database into a vault per user, which only that person's
  // password can open. The old tables are renamed rather than dropped: a vault can only be
  // created when someone signs in and supplies the key, so the data has to wait here until then.
  // The rename also stops them shadowing the vault, since SQLite resolves an unqualified table
  // name against main before any attached database.
  `
  DROP TRIGGER IF EXISTS notes_search_insert;
  DROP TRIGGER IF EXISTS notes_search_delete;
  DROP TRIGGER IF EXISTS notes_search_update;
  DROP TABLE IF EXISTS note_search;
  -- Renaming a table keeps its indexes under the old names, and a vault creating its own would
  -- then clash with them. They are no use here: what is left is read once and copied out.
  DROP INDEX IF EXISTS comments_item;
  DROP INDEX IF EXISTS work_user_day;
  DROP INDEX IF EXISTS work_item;
  DROP INDEX IF EXISTS completions_user_day;
  DROP INDEX IF EXISTS resource_folders_parent;
  DROP INDEX IF EXISTS notes_item;
  DROP INDEX IF EXISTS note_events_note;
  DROP INDEX IF EXISTS spaces_slug;
  DROP INDEX IF EXISTS spaces_goal;
  DROP INDEX IF EXISTS notes_space;
  DROP INDEX IF EXISTS links_to;
  DROP INDEX IF EXISTS links_pair;
  ALTER TABLE goals RENAME TO legacy_goals;
  ALTER TABLE tasks RENAME TO legacy_tasks;
  ALTER TABLE comments RENAME TO legacy_comments;
  ALTER TABLE resource_folders RENAME TO legacy_resource_folders;
  ALTER TABLE resources RENAME TO legacy_resources;
  ALTER TABLE item_resources RENAME TO legacy_item_resources;
  ALTER TABLE work_sessions RENAME TO legacy_work_sessions;
  ALTER TABLE work_session_resources RENAME TO legacy_work_session_resources;
  ALTER TABLE completions RENAME TO legacy_completions;
  ALTER TABLE timers RENAME TO legacy_timers;
  ALTER TABLE spaces RENAME TO legacy_spaces;
  ALTER TABLE notes RENAME TO legacy_notes;
  ALTER TABLE note_images RENAME TO legacy_note_images;
  ALTER TABLE note_events RENAME TO legacy_note_events;
  ALTER TABLE links RENAME TO legacy_links;
  `,
]

const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
for (let i = version; i < migrations.length; i++) {
  db.exec('BEGIN')
  try {
    const step = migrations[i]
    if (typeof step === 'string') db.exec(step)
    else step()
    db.exec(`PRAGMA user_version = ${i + 1}`)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/**
 * Which connection the query helpers below talk to. During a request it is the signed-in user's
 * connection, which has their vault attached; outside one (startup, migrations) it is the shared
 * database. Carrying it here rather than passing it around keeps every call site unchanged.
 */
const connection = new AsyncLocalStorage<Conn>()

export const useConnection = <T>(conn: Conn, fn: () => T): T => connection.run(conn, fn)
export const currentDb = (): Conn => connection.getStore() ?? db

// SQLite has no nested transactions, and one function calling another that also wants one is
// normal. The outermost call owns the transaction; the inner ones just run inside it. Depth is
// per connection, since each unlocked user has their own.
const txDepth = new WeakMap<Conn, number>()

export function tx<T>(fn: () => T): T {
  const conn = currentDb()
  const depth = txDepth.get(conn) ?? 0
  if (depth > 0) return fn()
  conn.exec('BEGIN IMMEDIATE')
  txDepth.set(conn, depth + 1)
  try {
    const out = fn()
    conn.exec('COMMIT')
    return out
  } catch (e) {
    conn.exec('ROLLBACK')
    throw e
  } finally {
    txDepth.set(conn, depth)
  }
}

type Param = null | number | bigint | string | Uint8Array
export type Conn = InstanceType<typeof Database>

export const all = <T>(sql: string, ...params: Param[]) => currentDb().prepare(sql).all(...params) as T[]
export const get = <T>(sql: string, ...params: Param[]) => currentDb().prepare(sql).get(...params) as T | undefined
export const run = (sql: string, ...params: Param[]) => currentDb().prepare(sql).run(...params)
