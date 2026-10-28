import type User from '#models/user'
import type Child from '#models/child'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { staffSchoolId } from '#policies/parent_policy'

/**
 * Orders of a child (Phase 6). Same visibility rule as ChildPolicy /
 * `Child.visibleTo()` (D8: a guardians pivot later changes only those):
 * - a parent reads and orders for their own children only (and only while
 *   active — the parent portal is for parents);
 * - admin + manager of the child's school read and change any child's
 *   orders there (staff changes are audited overrides with a reason);
 * - kitchen and everyone else: nothing (Phase 7 gives the kitchen its
 *   read-only sheets).
 * Controllers look children up through `Child.visibleTo(user)` first, so a
 * foreign id is a 404 before this policy is even asked.
 */
export default class OrderPolicy extends BasePolicy {
  before(user: User | null) {
    if (user && !user.isActive) return false
  }

  /** Parent portal: own child. */
  order(user: User, child: Child): AuthorizerResponse {
    return user.role === 'parent' && child.parentId === user.id
  }

  /** Back-office: staff of the child's school. */
  manage(user: User, child: Child): AuthorizerResponse {
    const schoolId = staffSchoolId(user)
    return schoolId !== null && child.schoolId === schoolId
  }

  /** Back-office order list. */
  viewAny(user: User): AuthorizerResponse {
    return staffSchoolId(user) !== null
  }
}
