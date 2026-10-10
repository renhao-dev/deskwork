// A vault is one user's encrypted database. It is opened by attaching it to a connection that
// already has the shared database (accounts and sessions) as its main, so a query can reach both:
// unqualified table names resolve to the shared database first and the vault second.
//
// The key only ever exists in this process's memory, put there by someone typing their password.
// Signing out, or the server stopping, loses it — the file on disk is never anything but
// ciphertext.
import Database from 'better-sqlite3-multiple-ciphers'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, dbFile, type Conn } from './db.ts'
import { keyHex, wipe } from './keys.ts'
import { vaultMigrations } from './vaultSchema.ts'

const vaultFile = (userId: number) => join(DATA_DIR, `vault-${userId}.db`)

interface Unlocked { userId: number; conn: Conn; key: Buffer }

/** One connection per unlocked user, however many browser tabs they have open. */
const unlocked = new Map<number, Unlocked>()

/** Opens the shared database and attaches this user's vault to it. */
function connect(userId: number, key: Buffer): Conn {
  const conn = new Database(dbFile)
  conn.exec(`PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA temp_store = MEMORY; PRAGMA secure_delete = ON;`)
  // A big sort or a VACUUM must never spill a user's text into a temp file on disk, hence
  // temp_store above. The key goes in through ATTACH, never through a file or an environment.
  conn.exec(`ATTACH DATABASE '${vaultFile(userId).replace(/'/g, "''")}' AS vault KEY "x'${keyHex(key)}'"`)
  conn.exec(`PRAGMA vault.cipher = 'sqlcipher'`)
  return conn
}

/** Fails loudly if the key is wrong, rather than part-way through someone's first request. */
function check(conn: Conn) {
  conn.prepare('SELECT count(*) FROM vault.sqlite_schema').get()
}

function migrate(conn: Conn) {
  const { user_version: at } = conn.prepare('PRAGMA vault.user_version').get() as { user_version: number }
  for (let i = at; i < vaultMigrations.length; i++) {
    conn.exec('BEGIN')
    try {
      const step = vaultMigrations[i]
      if (typeof step === 'string') conn.exec(step)
      else step(conn)
      conn.exec(`PRAGMA vault.user_version = ${i + 1}`)
      conn.exec('COMMIT')
    } catch (e) {
      conn.exec('ROLLBACK')
      throw e
    }
  }
}

/**
 * Opens a user's vault, creating it the first time. Returns null when the key is wrong, which is
 * how a wrong password is noticed for a vault that already exists.
 */
export function open(userId: number, key: Buffer): Conn | null {
  const existing = unlocked.get(userId)
  if (existing) return existing.conn
  let conn: Conn
  try {
    conn = connect(userId, key)
    check(conn)
    migrate(conn)
  } catch (e) {
    // A wrong key fails here, but so would a broken migration — say which, rather than looking
    // to the person signing in like a rejected password.
    const message = e instanceof Error ? e.message : String(e)
    if (!/not a database|file is encrypted/i.test(message)) console.error(`Opening vault ${userId} failed:`, message)
    return null
  }
  unlocked.set(userId, { userId, conn, key: Buffer.from(key) })
  return conn
}

/** The open connection for a user, or undefined when nobody has unlocked them since startup. */
export const connectionFor = (userId: number) => unlocked.get(userId)?.conn

export const isUnlocked = (userId: number) => unlocked.has(userId)

/** Everyone currently signed in, for work that can only touch vaults that are open. */
export const openVaults = () => [...unlocked.values()].map(({ userId, conn }) => ({ userId, conn }))

/** Signing out: close the vault and overwrite the key, so a memory dump finds nothing. */
export function lock(userId: number) {
  const entry = unlocked.get(userId)
  if (!entry) return
  unlocked.delete(userId)
  try {
    entry.conn.exec('DETACH DATABASE vault')
  } catch {}
  try {
    entry.conn.close()
  } catch {}
  wipe(entry.key)
}

export function lockAll() {
  for (const id of [...unlocked.keys()]) lock(id)
}

export const vaultExists = (userId: number) => existsSync(vaultFile(userId))

/** Deleting a user takes their vault with it; without the key there is nothing to keep. */
export function destroy(userId: number) {
  lock(userId)
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${vaultFile(userId)}${suffix}`
    if (existsSync(f)) unlinkSync(f)
  }
}
