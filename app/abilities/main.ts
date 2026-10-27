/*
|--------------------------------------------------------------------------
| Bouncer abilities (role-level checks)
|--------------------------------------------------------------------------
|
| Role abilities used by every route group. Resource-level checks (a parent
| may only reach their own children, orders, …) live in policies under
| app/policies (indexed automatically into #generated/policies).
|
| Inactive users never pass any ability.
|
*/

import { Bouncer } from '@adonisjs/bouncer'
import type User from '#models/user'
import { KITCHEN_ROLES, STAFF_ROLES } from '#enums/roles'

/** admin + manager: the back-office. */
export const accessBackOffice = Bouncer.ability((user: User) => {
  return user.isActive && STAFF_ROLES.includes(user.role)
})

/** admin + manager + kitchen: production sheets, allergy sheet, labels, exports (read-only for kitchen). */
export const accessKitchen = Bouncer.ability((user: User) => {
  return user.isActive && KITCHEN_ROLES.includes(user.role)
})

/** parents only: the parent portal. */
export const accessParentPortal = Bouncer.ability((user: User) => {
  return user.isActive && user.role === 'parent'
})

/** admin only: staff users management. */
export const manageUsers = Bouncer.ability((user: User) => {
  return user.isActive && user.role === 'admin'
})

/** admin only: school settings. */
export const manageSettings = Bouncer.ability((user: User) => {
  return user.isActive && user.role === 'admin'
})
