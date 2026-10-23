import crypto from 'node:crypto'
import { DB } from './db.ts'

const SESSION_DAYS = 30

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')): string {
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')
  return `scrypt$${salt}$${key}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, salt, key] = stored.split('$')
  if (alg !== 'scrypt' || !salt || !key) return false
  const test = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  const ref = Buffer.from(key, 'hex')
  return ref.length === test.length && crypto.timingSafeEqual(ref, test)
}

/** Senha vem do ambiente: APP_PASSWORD_HASH (preferível) ou APP_PASSWORD. */
export function resolvePasswordHash(env = process.env): string | null {
  if (env.APP_PASSWORD_HASH?.startsWith('scrypt$')) return env.APP_PASSWORD_HASH
  if (env.APP_PASSWORD && env.APP_PASSWORD.length >= 8) return hashPassword(env.APP_PASSWORD)
  return null
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

export function createSession(db: DB): string {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = new Date()
  db.prepare('INSERT INTO sessions(token_hash, created_at, expires_at) VALUES (?,?,?)').run(
    sha(token),
    now.toISOString(),
    new Date(now.getTime() + SESSION_DAYS * 86400_000).toISOString(),
  )
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now.toISOString())
  return token
}

export function validSession(db: DB, token: string | undefined): boolean {
  if (!token) return false
  const r = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(sha(token)) as { expires_at: string } | undefined
  return !!r && new Date(r.expires_at) > new Date()
}

export function deleteSession(db: DB, token: string | undefined) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token))
}

/** Limite de tentativas de login por IP: 5 falhas em 15 minutos. */
const failures = new Map<string, number[]>()
export function loginBlocked(ip: string): boolean {
  const now = Date.now()
  const list = (failures.get(ip) ?? []).filter((t) => now - t < 15 * 60_000)
  failures.set(ip, list)
  return list.length >= 5
}
export function registerFailure(ip: string) {
  failures.set(ip, [...(failures.get(ip) ?? []), Date.now()])
}
export function resetFailures(ip: string) {
  failures.delete(ip)
}
