import { WeeklyMenuSchema } from '#database/schema'
import { belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import School from '#models/school'
import MenuItem from '#models/menu_item'
import { addDays } from '#support/dates'

/**
 * The menu of one school week (docs/ERD.md §weekly_menus). Status changes go
 * through MenuStatusService / MenuPublicationService only.
 */
export default class WeeklyMenu extends WeeklyMenuSchema {
  @belongsTo(() => School)
  declare school: BelongsTo<typeof School>

  /** All rows, including items removed by the Phase 6 impact flow. */
  @hasMany(() => MenuItem)
  declare items: HasMany<typeof MenuItem>

  /** Sunday of the menu's week ('YYYY-MM-DD'). */
  get weekEnd() {
    return addDays(this.weekStart, 6)
  }

  get isEditable() {
    return this.status !== 'closed'
  }
}
