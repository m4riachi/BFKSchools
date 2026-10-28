import type User from '#models/user'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { KITCHEN_ROLES } from '#enums/roles'
import { staffSchoolId } from '#policies/parent_policy'

/**
 * School whose reports the user may read: an **active** admin, manager or
 * kitchen user who belongs to a school (`school_id = null` never means "all
 * schools", as in every policy since Phase 2). Parents: never.
 */
export function reportSchoolId(user: User): number | null {
  return user.isActive && KITCHEN_ROLES.includes(user.role) && typeof user.schoolId === 'number'
    ? user.schoolId
    : null
}

/**
 * Phase 7 reports (production sheet, allergy sheet, labels, exports,
 * dashboard). Everything here is **read-only**: there is no write route
 * in the kitchen area, so the kitchen role can read but never change
 * anything. Money (unit prices, amounts) is for admin + manager only.
 */
export default class ReportPolicy extends BasePolicy {
  before(user: User | null) {
    if (user && !user.isActive) return false
  }

  /** Production / allergy sheets, labels, exports of the user's school. */
  view(user: User): AuthorizerResponse {
    return reportSchoolId(user) !== null
  }

  /** Amounts (dashboard month-to-date, price columns of the exports). */
  viewAmounts(user: User): AuthorizerResponse {
    return staffSchoolId(user) !== null
  }
}
