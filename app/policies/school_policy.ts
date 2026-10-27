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

  /** Staff of all schools (school_id null) or of this school can view it. */
  view(user: User, school: School): AuthorizerResponse {
    if (user.role === 'parent') return false
    return user.schoolId === null || user.schoolId === school.id
  }

  /** Only admins change school settings. */
  updateSettings(user: User, school: School): AuthorizerResponse {
    return user.role === 'admin' && (user.schoolId === null || user.schoolId === school.id)
  }
}
