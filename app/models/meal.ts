import { MealSchema } from '#database/schema'
import { belongsTo, hasMany, scope } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from '#models/user'
import MealPhoto from '#models/meal_photo'

/**
 * A meal of the BFK-wide catalog (docs/ERD.md §meals). Prices are integer
 * centimes (`priceCents`); orders snapshot them (Phase 6).
 *
 * Soft delete — there is NO global hook hiding deleted meals:
 * - catalog screens and the menu builder use `Meal.query().withScopes((s) => s.catalog())`
 *   (or `offerable()` = catalog + active) and `MealService.findInCatalog()`;
 * - order history and statements reach meals through plain relations
 *   (`belongsTo(() => Meal)`) so deleted meals stay readable there.
 */
export default class Meal extends MealSchema {
  @hasMany(() => MealPhoto)
  declare photos: HasMany<typeof MealPhoto>

  @belongsTo(() => User, { foreignKey: 'createdBy' })
  declare creator: BelongsTo<typeof User>

  /** Not soft-deleted: the back-office catalog (active and inactive). */
  static catalog = scope((query) => {
    query.whereNull('meals.deleted_at')
  })

  /** What menu pickers may offer: not deleted and active. */
  static offerable = scope((query) => {
    query.whereNull('meals.deleted_at').where('meals.is_active', true)
  })

  get isDeleted() {
    return this.deletedAt !== null && this.deletedAt !== undefined
  }
}
