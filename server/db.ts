import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

export const DATA_DIR = resolve(process.env.DATA_DIR ?? join(import.meta.dirname, '..', 'data'))
export const UPLOAD_DIR = join(DATA_DIR, 'uploads')
mkdirSync(UPLOAD_DIR, { recursive: true })

export const db = new DatabaseSync(join(DATA_DIR, 'deskwork.db'))
db.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;`)

// Each entry runs once, in order. Append new migrations; never edit old ones.
const migrations: string[] = [
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
]

const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
for (let i = version; i < migrations.length; i++) {
  db.exec('BEGIN')
  try {
    db.exec(migrations[i])
    db.exec(`PRAGMA user_version = ${i + 1}`)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

type Param = null | number | bigint | string | Uint8Array
export const all = <T>(sql: string, ...params: Param[]) => db.prepare(sql).all(...params) as T[]
export const get = <T>(sql: string, ...params: Param[]) => db.prepare(sql).get(...params) as T | undefined
export const run = (sql: string, ...params: Param[]) => db.prepare(sql).run(...params)
