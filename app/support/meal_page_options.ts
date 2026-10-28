import { ALLERGENS } from '#enums/allergens'
import { MEAL_ACTIVE_FILTERS, MEAL_CATEGORIES, MEAL_TYPES } from '#enums/meals'
import { MEAL_PHOTOS, MEAL_TAGS } from '#config/meals'
import type { MealListFilters } from '#services/meal_service'
import { mealListValidator } from '#validators/meals'

/** Option lists shared by the catalog pages (labels are translated on the client). */
export function mealOptions() {
  return {
    types: [...MEAL_TYPES],
    categories: [...MEAL_CATEGORIES],
    activeFilters: [...MEAL_ACTIVE_FILTERS],
    allergens: [...ALLERGENS],
    tags: [...MEAL_TAGS],
  }
}

/** Upload limits shown in the photo manager (the server enforces them). */
export function photoLimits() {
  return {
    maxFileBytes: MEAL_PHOTOS.maxFileBytes,
    maxFilesPerUpload: MEAL_PHOTOS.maxFilesPerUpload,
    maxPerMeal: MEAL_PHOTOS.maxPerMeal,
    accept: 'image/jpeg,image/png,image/webp',
  }
}

/** Filters echoed back to the list page. */
export function presentFilters(filters: MealListQuery) {
  return {
    q: filters.q ?? '',
    type: filters.type ?? 'all',
    category: filters.category ?? 'all',
    active: filters.active ?? 'all',
    view: filters.view ?? 'grid',
  }
}

export type MealListQuery = MealListFilters & { view?: 'grid' | 'list' }

/** Parses the list query string; invalid values fall back to "no filter". */
export async function listFilters(qs: Record<string, unknown>): Promise<MealListQuery> {
  try {
    return await mealListValidator.validate(qs)
  } catch {
    return {}
  }
}
