import { MenuItemSchema } from '#database/schema'
import { belongsTo, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Meal from '#models/meal'
import WeeklyMenu from '#models/weekly_menu'

/**
 * A meal offered on one day of a weekly menu (docs/ERD.md §menu_items).
 * The meal relation is a plain belongsTo: deleted meals stay readable.
 */
export default class MenuItem extends MenuItemSchema {
  @belongsTo(() => WeeklyMenu)
  declare weeklyMenu: BelongsTo<typeof WeeklyMenu>

  @belongsTo(() => Meal)
  declare meal: BelongsTo<typeof Meal>

  /** Not removed by the Phase 6 impact flow. */
  static current = scope((query) => {
    query.whereNull('menu_items.removed_at')
  })
}
