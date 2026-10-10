// Each user's data is encrypted with a random key that never changes. That key is itself kept
// encrypted ("wrapped") under a key derived from their password, so changing a password rewraps
// 32 bytes instead of re-encrypting everything — and nothing on disk can open a vault on its own.
//
//   password --scrypt--> wrapping key --AES-GCM--> unwraps the data key --> opens the vault
//
// Nobody but the person typing the password can complete that chain: not another user, not an
// admin, not someone holding the files.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } // ~100ms, deliberately slow
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16

/** A fresh key for a new vault. It is never stored unwrapped. */
export const newDataKey = () => randomBytes(KEY_BYTES)
export const newSalt = () => randomBytes(16)

/**
 * The key that wraps a data key. Derived from the password with its own salt, so it can never
 * collide with the password hash kept for signing in — the stored hash must not be a usable key.
 */
export function wrappingKey(password: string, salt: Buffer) {
  return scryptSync(password, salt, KEY_BYTES, SCRYPT)
}

/** Encrypts a data key under a wrapping key. The result is safe to keep in the users table. */
export function wrap(dataKey: Buffer, wrapping: Buffer) {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', wrapping, iv)
  const sealed = Buffer.concat([cipher.update(dataKey), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), sealed]).toString('base64')
}

/** Returns the data key, or null when the password was wrong — the tag check is what tells us. */
export function unwrap(blob: string, wrapping: Buffer): Buffer | null {
  try {
    const raw = Buffer.from(blob, 'base64')
    if (raw.length !== IV_BYTES + TAG_BYTES + KEY_BYTES) return null
    const decipher = createDecipheriv('aes-256-gcm', wrapping, raw.subarray(0, IV_BYTES))
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES))
    return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()])
  } catch {
    return null // wrong password, or someone tampered with the stored blob
  }
}

/** SQLCipher takes the key as hex. */
export const keyHex = (dataKey: Buffer) => dataKey.toString('hex')

/** Overwrites a key in memory once we're done with it, so a later memory dump finds nothing. */
export function wipe(key: Buffer) {
  key.fill(0)
}

/** Only used by tests and the recovery script. */
export const sameKey = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b)
