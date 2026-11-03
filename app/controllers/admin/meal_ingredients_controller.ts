import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import MealService from '#services/meal_service'
import MealIngredientService from '#services/meal_ingredient_service'
import { mealName } from '#support/meal_display'
import { ingredientIcon } from '#support/ingredient_icon'

const idRule = () => vine.number().withoutDecimals().range([1, 2147483647])
const newIngredientValidator = vine.create({
  label: vine.string().trim().minLength(1).maxLength(200),
  unit: vine.string().trim().maxLength(40).nullable().optional(),
})
const ficheValidator = vine.create({
  ingredients: vine
    .array(
      vine.object({
        ingredientId: idRule(),
        customerVisible: vine.boolean(),
        quantityPerMeal: vine.number().min(0).max(100000).optional(),
      })
    )
    .maxLength(100),
})

/**
 * D55: the fiche technique of a meal (a page per meal): pick ingredients from
 * the catalog and tick which ones parents see. Admin/manager (MealPolicy.manage).
 */
@inject()
export default class MealIngredientsController {
  constructor(
    protected meals: MealService,
    protected fiches: MealIngredientService
  ) {}

  async show({ params, inertia, bouncer, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const meal = await this.meals.findInCatalog(params.id)
    return inertia.render('admin/meals/ingredients', {
      meal: { id: meal.id, name: mealName(meal, i18n.locale) },
      fiche: await this.fiches.fiche(meal.id),
    })
  }

  async update({ params, request, response, bouncer, session, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const meal = await this.meals.findInCatalog(params.id)
    const { ingredients } = await request.validateUsing(ficheValidator)
    await this.fiches.save(
      meal,
      ingredients.map((line) => ({ ...line, quantityPerMeal: line.quantityPerMeal ?? 0 }))
    )
    session.flash('success', i18n.t('meals.fiche.saved'))
    return response.redirect(`/admin/meals/${meal.id}/ingredients`)
  }

  /** Ingredient search for the picker (?q=). */
  async search({ request, bouncer }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const q = String(request.input('q', '')).slice(0, 80)
    return { results: await this.fiches.search(q) }
  }

  /** D56: add a brand-new article to the catalog (not found in the picker). */
  async createIngredient({ request, bouncer }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const { label, unit } = await request.validateUsing(newIngredientValidator)
    const ingredient = await this.fiches.createIngredient(label, unit ?? null)
    return {
      ingredient: {
        ingredientId: ingredient.id,
        code: ingredient.code,
        label: ingredient.label,
        icon: ingredientIcon(ingredient.label),
        famille: ingredient.famille,
        unit: ingredient.unit,
        customerVisible: true,
        quantityPerMeal: 0,
      },
    }
  }
}
