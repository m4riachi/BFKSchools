import { createHmac } from 'node:crypto'
import app from '@adonisjs/core/services/app'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'

/**
 * "Known device" cookie: set after a successful login, it lets that browser
 * skip the per-email login limiter (an attacker exhausting an account's
 * per-email budget cannot lock its owner out). Per-IP and per-IP+email limits
 * still apply.
 *
 * The encrypted cookie holds keyed hashes (HMAC with APP_KEY) of the
 * normalized emails that logged in on this browser — no user id, no email,
 * and checking it needs no database lookup, so it reveals nothing about
 * whether an email exists and does not change unknown-email timing.
 */
export const KNOWN_DEVICE_COOKIE = 'bfk_kd'
const MAX_ACCOUNTS = 5

export function knownDeviceHash(email: string): string {
  return createHmac('sha256', env.get('APP_KEY').release())
    .update(`known-device:${email}`)
    .digest('hex')
    .slice(0, 32)
}

function readHashes(request: HttpContext['request']): string[] {
  const value = request.encryptedCookie(KNOWN_DEVICE_COOKIE)
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
}

/** `email` must already be normalized (trimmed, lower-cased). */
export function isKnownDevice(request: HttpContext['request'], email: string): boolean {
  return readHashes(request).includes(knownDeviceHash(email))
}

export function rememberKnownDevice({ request, response }: HttpContext, email: string) {
  const hash = knownDeviceHash(email)
  const hashes = [hash, ...readHashes(request).filter((entry) => entry !== hash)]
  response.encryptedCookie(KNOWN_DEVICE_COOKIE, hashes.slice(0, MAX_ACCOUNTS), {
    maxAge: '180 days',
    httpOnly: true,
    secure: app.inProduction,
    sameSite: 'lax',
    path: '/',
  })
}
