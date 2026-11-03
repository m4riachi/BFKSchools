import { MealIngredientSchema } from '#database/schema'
import { belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Ingredient from '#models/ingredient'

/** D55: one line of a meal's fiche technique (meal ↔ ingredient). */
export default class MealIngredient extends MealIngredientSchema {
  @belongsTo(() => Ingredient)
  declare ingredient: BelongsTo<typeof Ingredient>
}
