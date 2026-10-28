import type User from '#models/user'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { STAFF_ROLES } from '#enums/roles'

/**
 * Back-office family management (Phase 2): admin + manager only; parents
 * and kitchen get nothing. Unlike SchoolPolicy, `school_id = null` never
 * means "all schools" here: staff must belong to a school and only manage
 * parents of that school, and a parent must have a school.
 */
export function staffSchoolId(user: User): number | null {
  return user.isActive && STAFF_ROLES.includes(user.role) && typeof user.schoolId === 'number'
    ? user.schoolId
    : null
}

export default class ParentPolicy extends BasePolicy {
  before(user: User | null) {
    if (user && !user.isActive) return false
  }

  /** List, create, import. */
  viewAny(user: User): AuthorizerResponse {
    return staffSchoolId(user) !== null
  }

  create(user: User): AuthorizerResponse {
    return staffSchoolId(user) !== null
  }

  import(user: User): AuthorizerResponse {
    return staffSchoolId(user) !== null
  }

  /** View, edit, (de)activate, invite a parent and manage their children. */
  manage(user: User, parent: User): AuthorizerResponse {
    const schoolId = staffSchoolId(user)
    return (
      schoolId !== null &&
      parent.role === 'parent' &&
      typeof parent.schoolId === 'number' &&
      parent.schoolId === schoolId
    )
  }
}
