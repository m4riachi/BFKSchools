import type User from '#models/user'
import type Child from '#models/child'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { staffSchoolId } from '#policies/parent_policy'

/**
 * Child access. Same rule as the `Child.visibleTo()` scope — keep both in
 * sync (D8: a guardians pivot later only changes these two places).
 */
export default class ChildPolicy extends BasePolicy {
  before(user: User | null) {
    if (user && !user.isActive) return false
  }

  /** A parent sees their own children; staff see children of their school. */
  view(user: User, child: Child): AuthorizerResponse {
    if (user.role === 'parent') return child.parentId === user.id
    const schoolId = staffSchoolId(user)
    return schoolId !== null && child.schoolId === schoolId
  }

  /** Back-office changes (details, allergies, subscriptions): staff of the school. */
  manage(user: User, child: Child): AuthorizerResponse {
    const schoolId = staffSchoolId(user)
    return schoolId !== null && child.schoolId === schoolId
  }
}
