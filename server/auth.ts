import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { get, run, useConnection } from './db.ts'
import { keyHex, newDataKey, newSalt, unwrap, wipe, wrap, wrappingKey } from './keys.ts'
import * as vault from './vault.ts'
import { ensureSpaceHomes } from './spaces.ts'
import { moveToVault, dropLegacyIfEmpty } from './moveToVault.ts'
import { DEFAULT_SETTINGS, type User, type UserSettings } from '../shared/types.ts'

const COOKIE = 'deskwork_session'
const SESSION_DAYS = 60

export function hashPassword(password: string) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split('$')
  if (!salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = scryptSync(password, Buffer.from(salt, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

interface UserRow {
  id: number
  username: string
  is_admin: number
  settings: string
  created_at: number
  password_hash: string
  key_salt: string | null
  wrapped_key: string | null
}

export function parseSettings(raw: string): UserSettings {
  let parsed: Partial<UserSettings> = {}
  try {
    parsed = JSON.parse(raw)
  } catch {}
  return {
    ...DEFAULT_SETTINGS,
    ...parsed,
    pomodoro: { ...DEFAULT_SETTINGS.pomodoro, ...parsed.pomodoro },
    notifications: { ...DEFAULT_SETTINGS.notifications, ...parsed.notifications },
    layout: parsed.layout ?? {},
  }
}

export function toUser(r: UserRow): User {
  return { id: r.id, username: r.username, isAdmin: !!r.is_admin, createdAt: r.created_at, settings: parseSettings(r.settings) }
}

export function findUser(id: number) {
  const row = get<UserRow>('SELECT * FROM users WHERE id = ?', id)
  return row ? toUser(row) : undefined
}

/**
 * Opens this user's vault with their password. The key is derived here and nowhere else: it is
 * never written down, so this is the only moment it can come into being.
 */
export function unlockVault(row: UserRow, password: string): boolean {
  const salt = row.key_salt ? Buffer.from(row.key_salt, 'base64') : newSalt()
  const wrapping = wrappingKey(password, salt)
  let dataKey: Buffer | null = null
  let fresh = false

  if (row.wrapped_key) {
    dataKey = unwrap(row.wrapped_key, wrapping)
    if (!dataKey) return false // the password hash matched, so this means a damaged blob
  } else {
    dataKey = newDataKey() // first sign in since the upgrade, or a brand-new account
    fresh = true
  }

  const conn = vault.open(row.id, dataKey)
  if (!conn) {
    wipe(dataKey)
    return false
  }
  // Cheap and idempotent, so it runs every time: a vault that predates home pages gets them here.
  useConnection(conn, () => ensureSpaceHomes({ id: row.id } as User))
  if (fresh) {
    run('UPDATE users SET key_salt = ?, wrapped_key = ? WHERE id = ?',
      salt.toString('base64'), wrap(dataKey, wrapping), row.id)
    // Anything they wrote before the upgrade moves in now, while the key is in hand.
    useConnection(conn, () => {
      const { moved } = moveToVault(conn, row.id)
      if (moved > 0) console.log(`Moved ${moved} rows into ${row.username}'s vault`)
      dropLegacyIfEmpty()
      ensureSpaceHomes({ id: row.id } as User)
    })
  }
  wipe(dataKey)
  wipe(wrapping)
  return true
}

export function login(c: Context, username: string, password: string): User | null {
  const row = get<UserRow>('SELECT * FROM users WHERE username = ?', username.trim())
  if (!row || !verifyPassword(password, row.password_hash)) return null
  if (!unlockVault(row, password)) return null
  const token = randomBytes(32).toString('base64url')
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, row.id, Date.now() + SESSION_DAYS * 86_400_000)
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86_400 })
  return toUser(row)
}

/**
 * Signing out drops the session and closes the vault, overwriting the key in memory. From here the
 * data is unreadable again until someone types the password.
 */
/**
 * Changing a password re-locks the same data key under the new one. The vault is never rewritten,
 * so this is instant however much is in it.
 */
export function rewrapKey(userId: number, currentPassword: string, nextPassword: string) {
  const row = get<UserRow>('SELECT * FROM users WHERE id = ?', userId)
  if (!row?.key_salt || !row.wrapped_key) return // no vault yet; it will be made with the new password
  const dataKey = unwrap(row.wrapped_key, wrappingKey(currentPassword, Buffer.from(row.key_salt, 'base64')))
  if (!dataKey) throw new Error('Could not unlock your data with that password')
  const salt = newSalt()
  run('UPDATE users SET key_salt = ?, wrapped_key = ? WHERE id = ?',
    salt.toString('base64'), wrap(dataKey, wrappingKey(nextPassword, salt)), userId)
  wipe(dataKey)
}

export function logout(c: Context) {
  const token = getCookie(c, COOKIE)
  if (token) {
    const session = get<{ user_id: number }>('SELECT user_id FROM sessions WHERE token = ?', token)
    run('DELETE FROM sessions WHERE token = ?', token)
    if (session) vault.lock(session.user_id)
  }
  deleteCookie(c, COOKIE, { path: '/' })
}

export function ensureDefaultAdmin() {
  const count = get<{ n: number }>('SELECT COUNT(*) AS n FROM users')!.n
  if (count > 0) return
  run(
    'INSERT INTO users (username, password_hash, is_admin, settings, created_at) VALUES (?, ?, 1, ?, ?)',
    'admin',
    hashPassword('admin'),
    JSON.stringify(DEFAULT_SETTINGS),
    Date.now(),
  )
  console.log('Created default user admin / admin')
}

export type Env = { Variables: { user: User } }

export const requireUser: MiddlewareHandler<Env> = async (c, next) => {
  const token = getCookie(c, COOKIE)
  const session = token ? get<{ user_id: number; expires_at: number }>('SELECT user_id, expires_at FROM sessions WHERE token = ?', token) : undefined
  const user = session && session.expires_at > Date.now() ? findUser(session.user_id) : undefined
  if (!user) throw new HTTPException(401, { message: 'Sign in to continue' })
  // The session can outlive the key: the key lives only in memory, so a restart locks everyone
  // out until they sign in again. Nothing is lost, it just has to be unlocked.
  const conn = vault.connectionFor(user.id)
  if (!conn) throw new HTTPException(401, { message: 'Deskwork was restarted. Sign in to unlock your data.' })
  c.set('user', user)
  // Every query in this request goes to this user's connection, and reaches no other vault.
  await useConnection(conn, () => next())
}

export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('user').isAdmin) throw new HTTPException(403, { message: 'Only admins can manage users' })
  await next()
}
