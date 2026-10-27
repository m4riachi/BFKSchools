import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

/**
 * Runs on every request after the silent auth check. Sessions are stored in
 * cookies and cannot be revoked server-side, so a user deactivated by staff
 * is logged out here on their next request (the user row is re-read from
 * the database on every request by the session guard).
 */
export default class EnsureActiveUserMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user
    if (user && !user.isActive) {
      await ctx.auth.use('web').logout()
      ctx.session.flash('error', ctx.i18n.t('auth.login.inactive'))
      return ctx.response.redirect('/login')
    }

    return next()
  }
}
