/*
|--------------------------------------------------------------------------
| Rate limiters
|--------------------------------------------------------------------------
|
| Login is protected by three limiters, all consumed atomically BEFORE the
| password is checked (see SessionController.store):
|
| - per IP       30 attempts / min, no block. Stops password spraying
|                (many emails from one client). IPv6 is keyed on the /64.
| - per IP+email 5 attempts / min, then blocked 20 min. Reset on success.
| - per email    50 attempts / 15 min, no block. Slows distributed guessing
|                against one account (many IPs). Reset on success. Skipped
|                for a browser holding a valid "known device" cookie for that
|                email (app/support/known_device.ts), so an attacker who
|                exhausts it cannot lock the real user out.
|
*/

import limiter from '@adonisjs/limiter/services/main'
import { rateLimitIpKey } from '#support/ip'

export const LOGIN_LIMITS = {
  ip: { requests: 30, duration: '1 min' },
  ipEmail: { requests: 5, duration: '1 min', blockDuration: '20 mins' },
  email: { requests: 50, duration: '15 mins' },
} as const

export function loginIpLimiter() {
  return limiter.use({ ...LOGIN_LIMITS.ip })
}

export function loginIpEmailLimiter() {
  return limiter.use({ ...LOGIN_LIMITS.ipEmail })
}

export function loginEmailLimiter() {
  return limiter.use({ ...LOGIN_LIMITS.email })
}

export const loginKeys = {
  ip: (ip: string) => `login:ip:${rateLimitIpKey(ip)}`,
  ipEmail: (ip: string, email: string) => `login:ip_email:${rateLimitIpKey(ip)}:${email}`,
  email: (email: string) => `login:email:${email}`,
}
