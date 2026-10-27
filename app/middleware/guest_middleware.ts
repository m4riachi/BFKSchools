import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'
import { homePathFor } from '#enums/roles'

/**
 * Guest-only routes (login): a logged-in user is sent to their home.
 */
export default class GuestMiddleware {
  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: { guards?: (keyof Authenticators)[] } = {}
  ) {
    for (const guard of options.guards || [ctx.auth.defaultGuard]) {
      if (await ctx.auth.use(guard).check()) {
        ctx.session.reflash()
        return ctx.response.redirect(homePathFor(ctx.auth.use(guard).user!.role), true)
      }
    }

    return next()
  }
}
