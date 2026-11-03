import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import vine from '@vinejs/vine'
import MealService from '#services/meal_service'
import MealIngredientService from '#services/meal_ingredient_service'
import { mealName } from '#support/meal_display'

const idRule = () => vine.number().withoutDecimals().range([1, 2147483647])
const ficheValidator = vine.create({
  ingredients: vine
    .array(vine.object({ ingredientId: idRule(), customerVisible: vine.boolean() }))
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
    await this.fiches.save(meal, ingredients)
    session.flash('success', i18n.t('meals.fiche.saved'))
    return response.redirect(`/admin/meals/${meal.id}/ingredients`)
  }

  /** Ingredient search for the picker (?q=). */
  async search({ request, bouncer }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const q = String(request.input('q', '')).slice(0, 80)
    return { results: await this.fiches.search(q) }
  }
}
