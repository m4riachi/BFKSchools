import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { CREDENTIALS_SESSION_KEY } from '#support/login_session'

/**
 * Runs on every request after the silent auth check. Sessions are stored in
 * cookies and cannot be revoked server-side, so (the user row is re-read
 * from the database on every request by the session guard):
 * - a user deactivated by staff is logged out on their next request;
 * - a session started before a password reset/change, an email change or a
 *   deactivation (credentials version bumped) is logged out too.
 *
 * A session without the key (logged in through a remember-me token, which
 * is deleted on every bump, or started before this check existed) adopts
 * the current version.
 */
export default class EnsureActiveUserMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user
    if (!user) return next()

    if (!user.isActive) {
      await ctx.auth.use('web').logout()
      ctx.session.flash('error', ctx.i18n.t('auth.login.inactive'))
      return ctx.response.redirect('/login')
    }

    const version = ctx.session.get(CREDENTIALS_SESSION_KEY)
    if (version === undefined || version === null) {
      ctx.session.put(CREDENTIALS_SESSION_KEY, user.credentialsVersion)
    } else if (version !== user.credentialsVersion) {
      await ctx.auth.use('web').logout()
      ctx.session.forget(CREDENTIALS_SESSION_KEY)
      ctx.session.flash('error', ctx.i18n.t('auth.login.session_ended'))
      return ctx.response.redirect('/login')
    }

    return next()
  }
}
