import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import Ingredient from '#models/ingredient'
import MealIngredient from '#models/meal_ingredient'
import type Meal from '#models/meal'
import Clock from '#services/clock'

export type FicheLine = {
  ingredientId: number
  code: string
  label: string
  famille: string | null
  customerVisible: boolean
}

export type FicheInput = { ingredientId: number; customerVisible: boolean }[]

/**
 * D55: a meal's fiche technique — the ingredients it contains, in order,
 * each flagged whether parents see it. The catalog of ingredients comes from
 * the kitchen's article list (IngredientImportService).
 */
@inject()
export default class MealIngredientService {
  constructor(protected clock: Clock) {}

  /** The meal's fiche technique, ingredient details included, in order. */
  async fiche(mealId: number): Promise<FicheLine[]> {
    const rows = await MealIngredient.query()
      .where('meal_id', mealId)
      .preload('ingredient')
      .orderBy('position', 'asc')
      .orderBy('id', 'asc')
    return rows.map((row) => ({
      ingredientId: row.ingredientId,
      code: row.ingredient.code,
      label: row.ingredient.label,
      famille: row.ingredient.famille,
      customerVisible: row.customerVisible,
    }))
  }

  /** Visible ingredients {id,label} of several meals at once (parent ordering). */
  async visibleByMeal(mealIds: number[]): Promise<Map<number, { id: number; label: string }[]>> {
    const result = new Map<number, { id: number; label: string }[]>()
    if (!mealIds.length) return result
    const rows = await MealIngredient.query()
      .whereIn('meal_id', [...new Set(mealIds)])
      .where('customer_visible', true)
      .preload('ingredient')
      .orderBy('position', 'asc')
      .orderBy('id', 'asc')
    for (const row of rows) {
      const list = result.get(row.mealId) ?? []
      list.push({ id: row.ingredientId, label: row.ingredient.label })
      result.set(row.mealId, list)
    }
    return result
  }

  /** Replaces a meal's fiche technique with `input` (only known ingredient ids). */
  async save(meal: Meal, input: FicheInput): Promise<void> {
    const ids = [...new Set(input.map((line) => line.ingredientId))]
    const knownRows = ids.length ? await Ingredient.query().whereIn('id', ids).select('id') : []
    const known = new Set(knownRows.map((i) => i.id))
    const lines = input.filter((line) => known.has(line.ingredientId))
    const now = this.clock.now().toISO()!
    await db.transaction(async (trx) => {
      await MealIngredient.query({ client: trx }).where('meal_id', meal.id).delete()
      if (lines.length) {
        const seen = new Set<number>()
        const rows = lines
          .filter((line) => !seen.has(line.ingredientId) && seen.add(line.ingredientId))
          .map((line, position) => ({
            mealId: meal.id,
            ingredientId: line.ingredientId,
            customerVisible: line.customerVisible,
            position,
            createdAt: now,
            updatedAt: now,
          }))
        await trx.table('meal_ingredients').insert(
          rows.map((row) => ({
            meal_id: row.mealId,
            ingredient_id: row.ingredientId,
            customer_visible: row.customerVisible,
            position: row.position,
            created_at: row.createdAt,
            updated_at: row.updatedAt,
          }))
        )
      }
    })
  }

  /** Ingredient search for the picker (label or code), capped. */
  async search(query: string, limit = 30): Promise<FicheLine[]> {
    const q = query.trim()
    const builder = Ingredient.query().orderBy('label', 'asc').limit(limit)
    if (q) {
      builder.where((sub) => {
        sub.whereILike('label', `%${q}%`).orWhereILike('code', `%${q}%`)
      })
    }
    const rows = await builder
    return rows.map((row) => ({
      ingredientId: row.id,
      code: row.code,
      label: row.label,
      famille: row.famille,
      customerVisible: true,
    }))
  }
}
