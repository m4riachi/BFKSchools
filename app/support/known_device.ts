import { createHmac } from 'node:crypto'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'

/**
 * "Known device" cookie: set after a successful login (password, invitation
 * acceptance or password reset), it lets that browser skip the per-email
 * login limiter, so an attacker exhausting an account's per-email budget
 * cannot lock its owner out. Per-IP and per-IP+email limits still apply.
 *
 * The encrypted cookie holds keyed hashes (HMAC with APP_KEY) of
 * (user id, normalized email, credentials version) for up to 5 accounts — no
 * user id or email in clear. Because the credentials version is bumped on
 * every password change/reset, email change and deactivation, old cookies
 * stop matching after any of those. The check is made against the user row
 * the login already loads; an unknown email simply never matches.
 */
export const KNOWN_DEVICE_COOKIE = 'bfk_kd'
const MAX_ACCOUNTS = 5

export type KnownDeviceSubject = { id: number; email: string; credentialsVersion: number }

export function knownDeviceHash(user: KnownDeviceSubject): string {
  return createHmac('sha256', env.get('APP_KEY').release())
    .update(`known-device:${user.id}:${user.email.trim().toLowerCase()}:${user.credentialsVersion}`)
    .digest('hex')
    .slice(0, 32)
}

function readHashes(request: HttpContext['request']): string[] {
  const value = request.encryptedCookie(KNOWN_DEVICE_COOKIE)
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
}

export function isKnownDevice(request: HttpContext['request'], user: KnownDeviceSubject): boolean {
  return readHashes(request).includes(knownDeviceHash(user))
}

export function rememberKnownDevice({ request, response }: HttpContext, user: KnownDeviceSubject) {
  const hash = knownDeviceHash(user)
  const hashes = [hash, ...readHashes(request).filter((entry) => entry !== hash)]
  response.encryptedCookie(KNOWN_DEVICE_COOKIE, hashes.slice(0, MAX_ACCOUNTS), {
    maxAge: '180 days',
    httpOnly: true,
    secure: app.inProduction,
    sameSite: 'lax',
    path: '/',
  })
}
