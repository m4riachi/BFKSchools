import type User from '#models/user'
import type Holiday from '#models/holiday'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { staffSchoolId } from '#policies/parent_policy'

/**
 * School holidays (Phase 4): admin + manager of the school manage them
 * (calendar, list, ranges, generation, ICS import); kitchen and parents get
 * nothing here (later phases read holidays through HolidayCalendar).
 * Switching the Moroccan generator on/off is a school setting → admin only
 * (`SchoolPolicy.updateSettings`).
 */
export default class HolidayPolicy extends BasePolicy {
  before(user: User | null) {
    if (user && !user.isActive) return false
  }

  manage(user: User): AuthorizerResponse {
    return staffSchoolId(user) !== null
  }

  edit(user: User, holiday: Holiday): AuthorizerResponse {
    const schoolId = staffSchoolId(user)
    return schoolId !== null && holiday.schoolId === schoolId
  }
}
