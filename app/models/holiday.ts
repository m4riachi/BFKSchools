import { HolidaySchema } from '#database/schema'
import { belongsTo, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import School from '#models/school'

/**
 * A closed school day (docs/ERD.md §holidays). There is NO global hook:
 * - "is it a holiday" → `effective()` (enabled and not deleted), or better
 *   `HolidayCalendar.isHoliday()` / `holidaysBetween()`;
 * - back-office screens → `listed()` (not deleted; disabled rows are shown greyed);
 * - tombstones (`deleted_at` set) are only read by the generator/importer
 *   through their `rule_key` (they must never come back).
 */
export default class Holiday extends HolidaySchema {
  @belongsTo(() => School)
  declare school: BelongsTo<typeof School>

  static listed = scope((query) => {
    query.whereNull('holidays.deleted_at')
  })

  static effective = scope((query) => {
    query.whereNull('holidays.deleted_at').where('holidays.is_active', true)
  })

  /** Generated/imported rows are tombstoned on delete; manual rows are hard-deleted. */
  get keepsTombstone() {
    return this.ruleKey !== null && this.ruleKey !== undefined
  }
}
