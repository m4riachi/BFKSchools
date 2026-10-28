/**
 * Mirrors the CHECK constraints on `meals.type` and `meals.category`
 * (docs/ERD.md §meals). Labels: resources/lang/<locale>/meals.json.
 */
export const MEAL_TYPES = ['subscription', 'supplement'] as const
export type MealType = (typeof MEAL_TYPES)[number]

export const MEAL_CATEGORIES = ['main', 'starter', 'dessert', 'drink', 'snack'] as const
export type MealCategory = (typeof MEAL_CATEGORIES)[number]

/** Catalog list filter on the active flag (deleted meals are never listed). */
export const MEAL_ACTIVE_FILTERS = ['all', 'active', 'inactive'] as const
export type MealActiveFilter = (typeof MEAL_ACTIVE_FILTERS)[number]

/** Photo variants served by MediaController. */
export const MEAL_PHOTO_VARIANTS = ['full', 'thumb'] as const
export type MealPhotoVariant = (typeof MEAL_PHOTO_VARIANTS)[number]
