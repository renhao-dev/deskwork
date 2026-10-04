import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { HTTPException } from 'hono/http-exception'
import { get, run } from './db.ts'
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

export function login(c: Context, username: string, password: string): User | null {
  const row = get<UserRow>('SELECT * FROM users WHERE username = ?', username.trim())
  if (!row || !verifyPassword(password, row.password_hash)) return null
  const token = randomBytes(32).toString('base64url')
  run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', token, row.id, Date.now() + SESSION_DAYS * 86_400_000)
  setCookie(c, COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86_400 })
  return toUser(row)
}

export function logout(c: Context) {
  const token = getCookie(c, COOKIE)
  if (token) run('DELETE FROM sessions WHERE token = ?', token)
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
  c.set('user', user)
  await next()
}

export const requireAdmin: MiddlewareHandler<Env> = async (c, next) => {
  if (!c.get('user').isAdmin) throw new HTTPException(403, { message: 'Only admins can manage users' })
  await next()
}
