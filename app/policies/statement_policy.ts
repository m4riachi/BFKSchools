import type User from '#models/user'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { staffSchoolId } from '#policies/parent_policy'

/**
 * Monthly statements (Phase 8, D11: statements only — no payment tracking).
 * - a parent reads their own family's statement only (the children come
 *   from `Child.visibleTo`, so another family's child id is a 404);
 * - admin + manager read every family of their school (and export them);
 * - kitchen and everyone else: nothing.
 */
export default class StatementPolicy extends BasePolicy {
  before(user: User | null) {
    if (user && !user.isActive) return false
  }

  /** Parent portal: the logged-in parent's own statement. */
  viewOwn(user: User): AuthorizerResponse {
    return user.role === 'parent'
  }

  /** Back-office overview and export of the school's statements. */
  viewAny(user: User): AuthorizerResponse {
    return staffSchoolId(user) !== null
  }

  /** Back-office: one family of the staff member's school. */
  viewFamily(user: User, parent: User): AuthorizerResponse {
    const schoolId = staffSchoolId(user)
    return (
      schoolId !== null &&
      parent.role === 'parent' &&
      typeof parent.schoolId === 'number' &&
      parent.schoolId === schoolId
    )
  }
}
