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

/*
|--------------------------------------------------------------------------
| Password reset and invitation links (separate from the login limiters)
|--------------------------------------------------------------------------
|
| - request per IP     10 / 15 min: then "too many requests" (no enumeration:
|                      counted the same for known and unknown emails).
| - request per email   3 / 15 min: further requests answer exactly like a
|                      normal one but send nothing (stops mail bombing a
|                      victim without revealing anything).
| - set-password per IP 20 / 15 min: link submissions (reset + invitation).
|
*/
export const PASSWORD_LINK_LIMITS = {
  requestIp: { requests: 10, duration: '15 mins' },
  requestEmail: { requests: 3, duration: '15 mins' },
  confirmIp: { requests: 20, duration: '15 mins' },
} as const

export function resetRequestIpLimiter() {
  return limiter.use({ ...PASSWORD_LINK_LIMITS.requestIp })
}

export function resetRequestEmailLimiter() {
  return limiter.use({ ...PASSWORD_LINK_LIMITS.requestEmail })
}

export function passwordLinkConfirmLimiter() {
  return limiter.use({ ...PASSWORD_LINK_LIMITS.confirmIp })
}

export const passwordLinkKeys = {
  requestIp: (ip: string) => `pwreset:ip:${rateLimitIpKey(ip)}`,
  requestEmail: (email: string) => `pwreset:email:${email}`,
  confirmIp: (ip: string) => `pwlink:confirm:ip:${rateLimitIpKey(ip)}`,
}

/*
|--------------------------------------------------------------------------
| Report downloads (Phase 7)
|--------------------------------------------------------------------------
|
| Labels PDF and Excel/CSV exports are the heaviest authenticated requests
| (bounded per file, but not in number): 30 downloads / min per user, then
| 429. Pages of the kitchen area are not limited.
|
*/
export const REPORT_DOWNLOAD_LIMITS = { requests: 30, duration: '1 min' } as const

export function reportDownloadLimiter() {
  return limiter.use({ ...REPORT_DOWNLOAD_LIMITS })
}

export const reportKeys = {
  download: (userId: number) => `reports:download:${userId}`,
}
