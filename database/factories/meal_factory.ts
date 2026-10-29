import { DateTime } from 'luxon'
import factory from '@adonisjs/lucid/factories'
import Meal from '#models/meal'

let sequence = 0

const DISHES = [
  ['Poulet rôti, riz pilaf', 'Roast chicken, rice pilaf'],
  ['Couscous aux sept légumes', 'Seven-vegetable couscous'],
  ['Tajine de kefta aux œufs', 'Kefta tagine with eggs'],
  ['Lasagnes aux légumes', 'Vegetable lasagne'],
] as const

/**
 * Meals for tests. States: supplement, inactive, deleted. Subscription meals
 * are free (price 0, D31); supplements default to 8,00 MAD.
 */
export const MealFactory = factory
  .define(Meal, () => {
    sequence += 1
    const [fr, en] = DISHES[sequence % DISHES.length]
    return {
      nameFr: `${fr} ${sequence}`,
      nameEn: `${en} ${sequence}`,
      descriptionFr: null,
      descriptionEn: null,
      type: 'subscription' as const,
      category: 'main' as const,
      priceCents: 0, // D31: subscription meals are free
      allergens: [],
      tags: [],
      isActive: true,
      externalRecipeRef: null,
      deletedAt: null,
    }
  })
  .state('supplement', (meal) => {
    meal.type = 'supplement'
    meal.category = 'dessert'
    meal.priceCents = 800
  })
  // D31: a supplement needs a price (> 0, DB CHECK); `merge({ type: 'supplement' })`
  // without a price gets the default supplement price.
  .after('make', (_factory, meal) => {
    if (meal.type === 'supplement' && !meal.priceCents) meal.priceCents = 800
  })
  .state('inactive', (meal) => (meal.isActive = false))
  .state('deleted', (meal) => {
    meal.isActive = false
    meal.deletedAt = DateTime.now()
  })
  .build()
