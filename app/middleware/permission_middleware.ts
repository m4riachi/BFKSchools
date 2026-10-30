import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { AuthorizationResponse, errors } from '@adonisjs/bouncer'
import { areaOfRoute, PERMISSION_PATHS } from '#enums/permissions'
import StaffRoleService from '#services/staff_role_service'

/**
 * Back-office areas of custom roles (D42). Runs after the role middleware and
 * only narrows it. A route that belongs to no area is for admins only, so a new
 * page stays closed until it is classified (`areaOfRoute`).
 */
@inject()
export default class PermissionMiddleware {
  constructor(protected roles: StaffRoleService) {}

  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.getUserOrFail()
    if (user.role === 'admin') return next()

    const area = areaOfRoute(ctx.route?.pattern)
    const permissions = area ? await this.roles.permissionsOf(user) : []
    if (area && permissions.includes(area)) return next()

    // Staff land on /admin: send them to the first area they may open.
    if (area === 'dashboard' && permissions.length && ctx.request.method() === 'GET') {
      return ctx.response.redirect(PERMISSION_PATHS[permissions[0]])
    }
    throw new errors.E_AUTHORIZATION_FAILURE(AuthorizationResponse.deny('Access denied', 403))
  }
}
