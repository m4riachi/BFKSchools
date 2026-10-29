import db from '@adonisjs/lucid/services/db'
import type User from '#models/user'
import type MealPhoto from '#models/meal_photo'
import { BasePolicy } from '@adonisjs/bouncer'
import type { AuthorizerResponse } from '@adonisjs/bouncer/types'
import { KITCHEN_ROLES, STAFF_ROLES } from '#enums/roles'

/**
 * The meal catalog is BFK-wide (no school_id), so access depends on the
 * role only:
 * - admin + manager: read and manage (create, edit, duplicate, delete, photos);
 * - kitchen: read-only (kitchen area);
 * - parents: nothing here (the parent portal shows meals through menus, Phase 6),
 *   except the photos of meals they can see (viewPhoto).
 */
export default class MealPolicy extends BasePolicy {
  before(user: User | null) {
    if (user && !user.isActive) return false
  }

  view(user: User): AuthorizerResponse {
    return KITCHEN_ROLES.includes(user.role)
  }

  manage(user: User): AuthorizerResponse {
    return STAFF_ROLES.includes(user.role)
  }

  /**
   * Meal photos (`/media/meal-photos/:id/:variant`): staff and kitchen see
   * every photo; a parent only the photos of meals on a published (or
   * closed) menu of their school, or in one of their children's orders
   * (order history keeps working after a menu is closed or a meal removed).
   */
  async viewPhoto(user: User, photo: MealPhoto): Promise<AuthorizerResponse> {
    if (KITCHEN_ROLES.includes(user.role)) return true
    if (user.role !== 'parent' || typeof user.schoolId !== 'number') return false

    const onMenu = await db
      .from('menu_items')
      .join('weekly_menus', 'weekly_menus.id', 'menu_items.weekly_menu_id')
      .where('menu_items.meal_id', photo.mealId)
      .where('weekly_menus.school_id', user.schoolId)
      .whereIn('weekly_menus.status', ['published', 'closed'])
      .select(db.raw('1'))
      .first()
    if (onMenu) return true

    const ordered = await db
      .from('meal_order_items')
      .join('meal_orders', 'meal_orders.id', 'meal_order_items.meal_order_id')
      .join('children', 'children.id', 'meal_orders.child_id')
      .where('meal_order_items.meal_id', photo.mealId)
      .where('children.parent_id', user.id)
      .select(db.raw('1'))
      .first()
    return Boolean(ordered)
  }
}
