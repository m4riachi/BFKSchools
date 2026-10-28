import type User from '#models/user'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { KITCHEN_ROLES, STAFF_ROLES } from '#enums/roles'

/**
 * The meal catalog is BFK-wide (no school_id), so access depends on the
 * role only:
 * - admin + manager: read and manage (create, edit, duplicate, delete, photos);
 * - kitchen: read-only (kitchen area);
 * - parents: nothing here (the parent portal shows meals through menus, Phase 6).
 */
export default class MealPolicy extends BasePolicy {
  before(user: User | null) {
    if (user && !user.isActive) return false
  }

  view(user: User): AuthorizerResponse {
    return KITCHEN_ROLES.includes(user.role)
  }

  manage(user: User): AuthorizerResponse {
    return STAFF_ROLES.includes(user.role)
  }
}
