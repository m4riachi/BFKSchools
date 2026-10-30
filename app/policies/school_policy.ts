import type User from '#models/user'
import type School from '#models/school'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'

/**
 * Policies live in this folder, one per resource (ChildPolicy, MealPolicy,
 * OrderPolicy… in later phases). The `indexPolicies()` assembler hook
 * registers them in `#generated/policies`; use them with
 * `bouncer.with('SchoolPolicy').authorize('updateSettings', school)`.
 *
 * Every policy starts with the same `before` hook: inactive users are denied.
 */
export default class SchoolPolicy extends BasePolicy {
  before(user: User | null) {
    if (user && !user.isActive) return false
  }

  /**
   * Staff of this school can view it. Like every policy since Phase 2, a
   * staff user without a school sees nothing (null never means "all").
   */
  view(user: User, school: School): AuthorizerResponse {
    if (user.role === 'parent') return false
    return typeof user.schoolId === 'number' && user.schoolId === school.id
  }

  /**
   * Only admins **of this school** change its settings (Phase 5: an admin
   * without a school no longer counts as "all schools" here, like every
   * policy since Phase 2). Managers can't read or change settings.
   */
  manageUsers(user: User, school: School): AuthorizerResponse {
    return user.role === 'admin' && typeof user.schoolId === 'number' && user.schoolId === school.id
  }

  updateSettings(user: User, school: School): AuthorizerResponse {
    return user.role === 'admin' && typeof user.schoolId === 'number' && user.schoolId === school.id
  }
}
