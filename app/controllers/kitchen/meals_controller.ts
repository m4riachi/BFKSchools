import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import MealService from '#services/meal_service'
import { presentMealDetail, presentMealSummary } from '#support/meal_display'
import { listFilters, mealOptions, presentFilters } from '#support/meal_page_options'

/**
 * Read-only catalog for the kitchen (admin, manager and kitchen roles):
 * descriptions, allergens and photos. No write route lives here.
 */
@inject()
export default class MealsController {
  constructor(protected meals: MealService) {}

  async index({ request, inertia, bouncer, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('view')
    const filters = await listFilters(request.qs())
    const page = await this.meals.list(filters, i18n.locale)
    return inertia.render('kitchen/meals/index', {
      meals: page.all().map((meal) => presentMealSummary(meal, i18n.locale)),
      meta: {
        total: page.total,
        perPage: page.perPage,
        currentPage: page.currentPage,
        lastPage: page.lastPage,
      },
      filters: presentFilters(filters),
      options: mealOptions(),
    })
  }

  async show({ params, inertia, bouncer, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('view')
    const meal = await this.meals.findInCatalog(params.id)
    await meal.load('photos')
    return inertia.render('kitchen/meals/show', { meal: presentMealDetail(meal, i18n.locale) })
  }
}
