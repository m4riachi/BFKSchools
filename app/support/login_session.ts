import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { rememberKnownDevice } from '#support/known_device'

/**
 * Session key holding the user's `credentials_version` at login time.
 * EnsureActiveUserMiddleware logs the session out when it no longer matches
 * (password reset/change, email change, deactivation).
 */
export const CREDENTIALS_SESSION_KEY = 'auth_cv'

/**
 * Starts an authenticated session for `user` (password login, invitation
 * acceptance, password reset): logs in, binds the session to the current
 * credentials version and marks this browser as a known device.
 */
export async function startUserSession(ctx: HttpContext, user: User, remember = false) {
  await ctx.auth.use('web').login(user, remember)
  ctx.session.put(CREDENTIALS_SESSION_KEY, user.credentialsVersion)
  rememberKnownDevice(ctx, user)
}
