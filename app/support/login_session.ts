import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import Clock from '#services/clock'
import { rememberKnownDevice } from '#support/known_device'

/**
 * Session key holding the user's `credentials_version` at login time.
 * EnsureActiveUserMiddleware logs the session out when it no longer matches
 * (password reset/change, email change, deactivation).
 */
export const CREDENTIALS_SESSION_KEY = 'auth_cv'

/** When the authenticated session started / was last used (epoch ms, Clock). */
export const SESSION_ISSUED_KEY = 'auth_iat'
export const SESSION_SEEN_KEY = 'auth_seen'

/**
 * Server-side lifetime of a signed-in session (security review M1). Cookie
 * sessions carry no expiry of their own (the cookie's Max-Age is only a
 * browser hint), so a copied session cookie would work forever:
 * - idle: no request for SESSION_IDLE_MINUTES ends it;
 * - absolute: SESSION_ABSOLUTE_HOURS after sign-in, it ends anyway.
 * A remember-me cookie then starts a fresh session (new timestamps).
 * `auth_seen` is refreshed at most every SESSION_SEEN_REFRESH_SECONDS.
 */
export const SESSION_IDLE_MINUTES = 120
export const SESSION_ABSOLUTE_HOURS = 12
export const SESSION_SEEN_REFRESH_SECONDS = 60

/** Binds the current session to the user's credentials version and starts its clock. */
export async function bindSession(ctx: HttpContext, user: Pick<User, 'credentialsVersion'>) {
  const clock = await ctx.containerResolver.make(Clock)
  const now = clock.now().toMillis()
  ctx.session.put(CREDENTIALS_SESSION_KEY, user.credentialsVersion)
  ctx.session.put(SESSION_ISSUED_KEY, now)
  ctx.session.put(SESSION_SEEN_KEY, now)
}

/**
 * Starts an authenticated session for `user` (password login, invitation
 * acceptance, password reset): logs in, binds the session to the current
 * credentials version and marks this browser as a known device.
 */
export async function startUserSession(ctx: HttpContext, user: User, remember = false) {
  await ctx.auth.use('web').login(user, remember)
  await bindSession(ctx, user)
  rememberKnownDevice(ctx, user)
}

function forgetSessionKeys(ctx: HttpContext) {
  ctx.session.forget(CREDENTIALS_SESSION_KEY)
  ctx.session.forget(SESSION_ISSUED_KEY)
  ctx.session.forget(SESSION_SEEN_KEY)
}

/**
 * Logs out (remember-me token deleted) and forgets the keys bound to the
 * session (the cookie lives on for flash messages and the CSRF token).
 */
export async function endSession(ctx: HttpContext) {
  await ctx.auth.use('web').logout()
  forgetSessionKeys(ctx)
}

/**
 * Ends an expired session without touching the remember-me token: the
 * next request signs in again from the remember-me cookie (fresh session)
 * if the browser has one, otherwise the user sees the login page.
 */
export function expireSession(ctx: HttpContext) {
  ctx.session.forget(ctx.auth.use('web').sessionKeyName)
  forgetSessionKeys(ctx)
}
