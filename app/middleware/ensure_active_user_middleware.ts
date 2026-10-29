import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import Clock from '#services/clock'
import {
  CREDENTIALS_SESSION_KEY,
  SESSION_ABSOLUTE_HOURS,
  SESSION_IDLE_MINUTES,
  SESSION_ISSUED_KEY,
  SESSION_SEEN_KEY,
  SESSION_SEEN_REFRESH_SECONDS,
  bindSession,
  endSession,
  expireSession,
} from '#support/login_session'

/**
 * Runs on every request after the silent auth check. Sessions are stored in
 * cookies and cannot be revoked server-side, so (the user row is re-read
 * from the database on every request by the session guard):
 * - a user deactivated by staff is logged out on their next request;
 * - a session started before a password reset/change, an email change or a
 *   deactivation (credentials version bumped) is logged out too;
 * - a session idle for SESSION_IDLE_MINUTES or older than
 *   SESSION_ABSOLUTE_HOURS (timestamps from the Clock) expires.
 *
 * A session without the keys adopts the current version and starts its
 * clock only when it was just restored from a remember-me token (those
 * tokens are deleted on every bump, so a valid one proves the credentials
 * did not change). Any other session without them is logged out: every
 * login path sets them (startUserSession).
 */
export default class EnsureActiveUserMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user
    if (!user) return next()

    if (!user.isActive) {
      await endSession(ctx)
      ctx.session.flash('error', ctx.i18n.t('auth.login.inactive'))
      return ctx.response.redirect('/login')
    }

    const guard = ctx.auth.use('web')
    const version = ctx.session.get(CREDENTIALS_SESSION_KEY)
    const issued = Number(ctx.session.get(SESSION_ISSUED_KEY))
    const seen = Number(ctx.session.get(SESSION_SEEN_KEY))
    const missing =
      version === undefined ||
      version === null ||
      !Number.isFinite(issued) ||
      !Number.isFinite(seen)

    if (guard.viaRemember) {
      // Restored from a remember-me cookie: a fresh session.
      await bindSession(ctx, user)
      return next()
    }
    if (missing || version !== user.credentialsVersion) {
      await endSession(ctx)
      ctx.session.flash('error', ctx.i18n.t('auth.login.session_ended'))
      return ctx.response.redirect('/login')
    }

    const clock = await ctx.containerResolver.make(Clock)
    const now = clock.now().toMillis()
    if (
      now - seen > SESSION_IDLE_MINUTES * 60_000 ||
      now - issued > SESSION_ABSOLUTE_HOURS * 3_600_000
    ) {
      expireSession(ctx)
      // With a remember-me cookie the same page signs in again (fresh session).
      const remember = ctx.request.encryptedCookie(guard.rememberMeKeyName)
      if (remember && ['GET', 'HEAD'].includes(ctx.request.method())) {
        return ctx.response.redirect().toPath(ctx.request.url(true))
      }
      ctx.session.flash('error', ctx.i18n.t('auth.login.session_expired'))
      return ctx.response.redirect('/login')
    }
    if (now - seen > SESSION_SEEN_REFRESH_SECONDS * 1000) {
      ctx.session.put(SESSION_SEEN_KEY, now)
    }

    return next()
  }
}
