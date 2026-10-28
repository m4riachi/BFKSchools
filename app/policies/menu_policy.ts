import type User from '#models/user'
import type WeeklyMenu from '#models/weekly_menu'
import type MenuTemplate from '#models/menu_template'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { staffSchoolId } from '#policies/parent_policy'

/**
 * Weekly menus and menu templates (Phase 5): admin + manager of the school
 * build, schedule and publish menus; kitchen and parents get nothing here
 * (the parent portal reads published menus in Phase 6, the kitchen reads
 * orders in Phase 7). Rows of another school are refused (and looked up by
 * school, so they 404 first).
 */
export default class MenuPolicy extends BasePolicy {
  before(user: User | null) {
    if (user && !user.isActive) return false
  }

  manage(user: User): AuthorizerResponse {
    return staffSchoolId(user) !== null
  }

  edit(user: User, menu: WeeklyMenu): AuthorizerResponse {
    const schoolId = staffSchoolId(user)
    return schoolId !== null && menu.schoolId === schoolId
  }

  editTemplate(user: User, template: MenuTemplate): AuthorizerResponse {
    const schoolId = staffSchoolId(user)
    return schoolId !== null && template.schoolId === schoolId
  }
}
