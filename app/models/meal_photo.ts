import { MealPhotoSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Meal from '#models/meal'

/**
 * A photo of a meal: two WebP files on the Drive disk named by `disk`
 * (`path` ≤ 1600 px, `thumbPath` 400 px). Never expose the keys to the
 * browser: URLs go through `mealPhotoUrls()` (#support/meal_display).
 */
export default class MealPhoto extends MealPhotoSchema {
  @belongsTo(() => Meal)
  declare meal: BelongsTo<typeof Meal>
}
