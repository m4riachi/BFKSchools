import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import MealService from '#services/meal_service'
import { mealValidator } from '#validators/meals'
import { presentMealDetail, presentMealSummary, mealName } from '#support/meal_display'
import { listFilters, mealOptions, photoLimits, presentFilters } from '#support/meal_page_options'

/**
 * Back-office meal catalog (admin + manager). Deleted meals are a 404 here.
 */
@inject()
export default class MealsController {
  constructor(protected meals: MealService) {}

  async index({ request, inertia, bouncer, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const filters = await listFilters(request.qs())
    const page = await this.meals.list(filters, i18n.locale)

    return inertia.render('admin/meals/index', {
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

  async create({ inertia, bouncer }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    return inertia.render('admin/meals/form', {
      meal: null,
      options: mealOptions(),
      photoLimits: photoLimits(),
    })
  }

  async store({ request, response, bouncer, auth, session, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const input = await request.validateUsing(mealValidator)
    const meal = await this.meals.create(input, auth.getUserOrFail())
    session.flash('success', i18n.t('meals.flash.created', { name: mealName(meal, i18n.locale) }))
    return response.redirect(`/admin/meals/${meal.id}/edit`)
  }

  async edit({ params, inertia, bouncer, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const meal = await this.meals.findInCatalog(params.id)
    await meal.load('photos')
    return inertia.render('admin/meals/form', {
      meal: presentMealDetail(meal, i18n.locale),
      options: mealOptions(),
      photoLimits: photoLimits(),
    })
  }

  async update({ params, request, response, bouncer, session, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const meal = await this.meals.findInCatalog(params.id)
    const input = await request.validateUsing(mealValidator)
    await this.meals.update(meal, input)
    session.flash('success', i18n.t('meals.flash.updated', { name: mealName(meal, i18n.locale) }))
    return response.redirect(`/admin/meals/${meal.id}/edit`)
  }

  async duplicate({ params, response, bouncer, auth, session, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const meal = await this.meals.findInCatalog(params.id)
    const copy = await this.meals.duplicate(meal, auth.getUserOrFail())
    session.flash(
      'success',
      i18n.t('meals.flash.duplicated', { name: mealName(copy, i18n.locale) })
    )
    return response.redirect(`/admin/meals/${copy.id}/edit`)
  }

  /** Soft delete (golden rule 7). */
  async destroy({ params, response, bouncer, session, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const meal = await this.meals.findInCatalog(params.id)
    await this.meals.softDelete(meal)
    session.flash('success', i18n.t('meals.flash.deleted', { name: mealName(meal, i18n.locale) }))
    return response.redirect('/admin/meals')
  }
}
