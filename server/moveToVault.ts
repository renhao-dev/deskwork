// Moving what a user already wrote into their new vault. This can only happen while they are
// signing in, because that is the only moment the key exists — so it runs once, on the first sign
// in after the upgrade, and the shared database keeps the data until then.
import { all, db, get, run } from './db.ts'
import { VAULT_TABLES } from './vaultSchema.ts'
import type { Conn } from './db.ts'

const legacy = (t: string) => `legacy_${t}`

/** True while the shared database is still holding anything for anyone. */
export function legacyDataExists() {
  return VAULT_TABLES.some((t) => {
    const row = get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${legacy(t)}`)
    return (row?.n ?? 0) > 0
  })
}

const hasLegacyTables = () =>
  !!get<{ n: number }>(`SELECT COUNT(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = 'legacy_goals'`)?.n

/** Which of this user's rows a table holds. The join tables are recognised by their parent. */
function whose(table: string, userId: number) {
  if (table === 'item_resources') {
    return `${legacy(table)} WHERE resource_id IN (SELECT id FROM ${legacy('resources')} WHERE user_id = ${userId})`
  }
  if (table === 'work_session_resources') {
    return `${legacy(table)} WHERE work_session_id IN (SELECT id FROM ${legacy('work_sessions')} WHERE user_id = ${userId})`
  }
  return `${legacy(table)} WHERE user_id = ${userId}`
}

const ownedBy = (table: string, userId: number) => `SELECT * FROM ${whose(table, userId)}`

/**
 * The columns the two copies of a table agree on. A vault's schema can grow past what the old
 * table had — spaces gained a home page, for one — so the copy names its columns rather than
 * trusting the two to line up.
 */
function sharedColumns(conn: Conn, table: string) {
  const names = (sql: string) => (conn.prepare(sql).all() as { name: string }[]).map((r) => r.name)
  const target = new Set(names(`SELECT name FROM pragma_table_info('${table}', 'vault')`))
  return names(`SELECT name FROM pragma_table_info('${legacy(table)}', 'main')`).filter((n) => target.has(n))
}

/**
 * Copies this user's rows into their vault, checks every one arrived, and only then removes them
 * from the shared database. A failure anywhere leaves the originals untouched.
 */
export function moveToVault(conn: Conn, userId: number) {
  if (!hasLegacyTables()) return { moved: 0 }

  const before = new Map<string, number>()
  for (const t of VAULT_TABLES) {
    before.set(t, (conn.prepare(`SELECT COUNT(*) AS n FROM (${ownedBy(t, userId)})`).get() as { n: number }).n)
  }
  const total = [...before.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return { moved: 0 }

  conn.exec('BEGIN IMMEDIATE')
  try {
    // goals and spaces point at each other, so the keys can only be checked once it is all in.
    conn.exec('PRAGMA defer_foreign_keys = ON')
    for (const t of VAULT_TABLES) {
      const cols = sharedColumns(conn, t).map((c) => `"${c}"`).join(', ')
      conn.exec(`INSERT INTO vault.${t} (${cols}) SELECT ${cols} FROM ${whose(t, userId)}`)
    }
    for (const t of VAULT_TABLES) {
      const landed = (conn.prepare(`SELECT COUNT(*) AS n FROM vault.${t}`).get() as { n: number }).n
      const expected = before.get(t)!
      if (landed !== expected) throw new Error(`${t}: ${landed} rows arrived, expected ${expected}`)
    }
    conn.exec('COMMIT')
  } catch (e) {
    conn.exec('ROLLBACK')
    throw e
  }

  // Only now is it safe to let go of the plaintext copies.
  conn.exec('BEGIN IMMEDIATE')
  try {
    conn.exec('PRAGMA defer_foreign_keys = ON')
    for (const t of [...VAULT_TABLES].reverse()) {
      conn.exec(`DELETE FROM main.${legacy(t)} WHERE rowid IN (SELECT rowid FROM ${whose(t, userId)})`)
    }
    conn.exec('COMMIT')
  } catch (e) {
    conn.exec('ROLLBACK')
    throw e
  }
  return { moved: total }
}

/**
 * Once nobody's data is left behind, the old tables go — and the file is rewritten so the plain
 * text is actually gone from disk rather than sitting in free pages.
 */
export function dropLegacyIfEmpty() {
  if (!hasLegacyTables() || legacyDataExists()) return false
  db.exec('PRAGMA foreign_keys = OFF')
  for (const t of [...VAULT_TABLES].reverse()) db.exec(`DROP TABLE IF EXISTS ${legacy(t)}`)
  db.exec('PRAGMA foreign_keys = ON')
  // VACUUM rebuilds the file, but in WAL mode the rebuild lands in the log and the old pages sit
  // in the database file until a checkpoint folds them in and truncates it. Both are needed
  // before the plain text is really gone from disk.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  db.exec('VACUUM')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  return true
}

/** Users whose data is still sitting in the shared database, for the startup notice. */
export function usersAwaitingMove(): number[] {
  if (!hasLegacyTables()) return []
  return all<{ user_id: number }>(
    `SELECT DISTINCT user_id FROM legacy_goals
     UNION SELECT DISTINCT user_id FROM legacy_notes
     UNION SELECT DISTINCT user_id FROM legacy_work_sessions`,
  ).map((r) => r.user_id)
}

export { run }
