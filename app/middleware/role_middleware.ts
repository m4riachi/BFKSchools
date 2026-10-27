import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { AuthorizationResponse, errors } from '@adonisjs/bouncer'
import type { Role } from '#enums/roles'

/**
 * Restricts a route group to some roles. Use after the `auth` middleware:
 *   .use([middleware.auth(), middleware.role({ roles: ['admin', 'manager'] })])
 *
 * Responds 403 (E_AUTHORIZATION_FAILURE) for any other role. Controllers
 * still authorize resources with Bouncer abilities/policies.
 */
export default class RoleMiddleware {
  async handle(ctx: HttpContext, next: NextFn, options: { roles: Role[] }) {
    const user = ctx.auth.getUserOrFail()

    if (!user.isActive || !options.roles.includes(user.role)) {
      throw new errors.E_AUTHORIZATION_FAILURE(AuthorizationResponse.deny('Access denied', 403))
    }

    return next()
  }
}
