// Everything a person writes lives in their own encrypted vault file. The shared database keeps
// only accounts and sessions, so it can be read before anyone has signed in.
//
// These tables are the ones that used to sit in the single database, with two differences. The
// foreign keys to users(id) are gone, because SQLite cannot enforce a key across two attached
// files; the user_id columns stay, so every query that filters by them works unchanged. And every
// statement names the vault explicitly — an unqualified CREATE goes to main, which would build a
// user's schema in the shared database instead of their own.
import type { Conn } from './db.ts'

/** A step is SQL, or a function when it has to look at what the vault already has. */
export const vaultMigrations: (string | ((conn: Conn) => void))[] = [
  `
  CREATE TABLE vault.goals (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    budget_minutes INTEGER NOT NULL,
    points_target INTEGER,
    points_done INTEGER NOT NULL DEFAULT 0,
    archived_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sort_order INTEGER,
    space_id INTEGER REFERENCES spaces(id) ON DELETE SET NULL
  );
  CREATE TABLE vault.tasks (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    scheduled_day TEXT,
    completed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sort_order INTEGER
  );
  CREATE TABLE vault.comments (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX vault.comments_item ON comments(item_type, item_id);
  CREATE TABLE vault.resource_folders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    parent_id INTEGER REFERENCES resource_folders(id) ON DELETE SET NULL
  );
  CREATE INDEX vault.resource_folders_parent ON resource_folders(parent_id);
  CREATE TABLE vault.resources (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
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
    created_at INTEGER NOT NULL,
    folder_id INTEGER REFERENCES resource_folders(id) ON DELETE SET NULL
  );
  CREATE TABLE vault.item_resources (
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    resource_id INTEGER NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    bookmark_page INTEGER,
    bookmark_seconds REAL,
    bookmark_index INTEGER,
    bookmark_updated_at INTEGER,
    attached_at INTEGER NOT NULL,
    sync_timer INTEGER,
    PRIMARY KEY (item_type, item_id, resource_id)
  );
  CREATE TABLE vault.work_sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    item_title TEXT NOT NULL,
    mode TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    seconds INTEGER NOT NULL,
    day TEXT NOT NULL
  );
  CREATE INDEX vault.work_user_day ON work_sessions(user_id, day);
  CREATE INDEX vault.work_item ON work_sessions(item_type, item_id);
  CREATE TABLE vault.work_session_resources (
    work_session_id INTEGER NOT NULL REFERENCES work_sessions(id) ON DELETE CASCADE,
    resource_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    from_seconds REAL, to_seconds REAL,
    from_index INTEGER, to_index INTEGER,
    from_page INTEGER, to_page INTEGER,
    PRIMARY KEY (work_session_id, resource_id)
  );
  CREATE TABLE vault.completions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
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
  CREATE INDEX vault.completions_user_day ON completions(user_id, day);
  CREATE TABLE vault.timers (
    user_id INTEGER PRIMARY KEY,
    state TEXT NOT NULL
  );
  CREATE TABLE vault.spaces (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    icon TEXT,
    goal_id INTEGER REFERENCES goals(id) ON DELETE SET NULL,
    sort_order INTEGER,
    created_at INTEGER NOT NULL,
    archived_at INTEGER
  );
  CREATE UNIQUE INDEX vault.spaces_slug ON spaces(user_id, slug);
  CREATE INDEX vault.spaces_goal ON spaces(goal_id);
  CREATE TABLE vault.notes (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER,
    space_id INTEGER REFERENCES spaces(id) ON DELETE CASCADE,
    parent_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
    sort_order INTEGER,
    slug TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX vault.notes_item ON notes(item_type, item_id);
  CREATE INDEX vault.notes_space ON notes(space_id, parent_id, sort_order);
  CREATE TABLE vault.note_images (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    note_id INTEGER REFERENCES notes(id) ON DELETE SET NULL,
    file_path TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE vault.note_events (
    id INTEGER PRIMARY KEY,
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  CREATE INDEX vault.note_events_note ON note_events(note_id, at);
  CREATE TABLE vault.links (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    from_type TEXT NOT NULL,
    from_id INTEGER NOT NULL,
    to_type TEXT NOT NULL,
    to_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX vault.links_to ON links(to_type, to_id);
  CREATE UNIQUE INDEX vault.links_pair ON links(from_type, from_id, to_type, to_id);
  CREATE VIRTUAL TABLE vault.note_search USING fts5(
    title, body_text, content='notes', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER vault.notes_search_insert AFTER INSERT ON notes BEGIN
    INSERT INTO note_search(rowid, title, body_text) VALUES (new.id, new.title, new.body_text);
  END;
  CREATE TRIGGER vault.notes_search_delete AFTER DELETE ON notes BEGIN
    INSERT INTO note_search(note_search, rowid, title, body_text) VALUES('delete', old.id, old.title, old.body_text);
  END;
  CREATE TRIGGER vault.notes_search_update AFTER UPDATE ON notes BEGIN
    INSERT INTO note_search(note_search, rowid, title, body_text) VALUES('delete', old.id, old.title, old.body_text);
    INSERT INTO note_search(rowid, title, body_text) VALUES (new.id, new.title, new.body_text);
  END;
  `,
  // Each space gained a home page: the one page every other page in it sits under. Vaults built
  // before this get the column here, and their home pages the next time they are opened.
  //
  // This checks before adding, because the column briefly shipped as part of the step above: a
  // vault made in that window already has it, and a plain ALTER would fail and lock its owner out.
  (conn: Conn) => {
    const columns = conn.prepare(`SELECT name FROM pragma_table_info('spaces', 'vault')`).all() as { name: string }[]
    if (!columns.some((c) => c.name === 'home_id')) {
      conn.exec('ALTER TABLE vault.spaces ADD COLUMN home_id INTEGER REFERENCES notes(id) ON DELETE SET NULL')
    }
  },
]

/** The tables that move out of the shared database and into each vault. */
export const VAULT_TABLES = [
  'goals', 'tasks', 'comments', 'resource_folders', 'resources', 'item_resources',
  'work_sessions', 'work_session_resources', 'completions', 'timers', 'spaces',
  'notes', 'note_images', 'note_events', 'links',
] as const
