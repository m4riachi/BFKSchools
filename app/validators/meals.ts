import vine from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import { ALLERGENS } from '#enums/allergens'
import { MEAL_ACTIVE_FILTERS, MEAL_CATEGORIES, MEAL_TYPES } from '#enums/meals'
import {
  MEAL_DESCRIPTION_MAX_LENGTH,
  MEAL_MAX_PRICE_CENTS,
  MEAL_NAME_MAX_LENGTH,
  MEAL_PHOTOS,
  MEAL_RECIPE_REF_MAX_LENGTH,
  MEAL_TAGS,
} from '#config/meals'
import { parseMadToCents } from '#support/money'
import { nameRule } from '#validators/rules'

/**
 * A MAD amount typed by staff ("12", "12,5", "12.50", "1 234,50") with at
 * most 2 decimals, strictly positive and ≤ MEAL_MAX_PRICE_CENTS. Parsed with
 * the integer-centime helper (no floats); the output is the amount in
 * centimes.
 */
const madPrice = vine.createRule((value: unknown, _options: undefined, field: FieldContext) => {
  if (!field.isValid) return
  const cents = typeof value === 'string' ? parseMadToCents(value) : null
  if (cents === null) {
    field.report(
      'The {{ field }} field must be an amount with at most 2 decimals',
      'madAmount',
      field
    )
    return
  }
  if (cents <= 0 || cents > MEAL_MAX_PRICE_CENTS) {
    field.report('The {{ field }} field is out of range', 'madRange', field)
  }
})

export function madPriceRule() {
  return vine
    .string()
    .trim()
    .maxLength(20)
    .use(madPrice())
    .transform((value) => parseMadToCents(value)!)
}

/** Multi-line free text (descriptions): trimmed, no control characters except newlines/tabs. */
function descriptionRule() {
  return vine
    .string()
    .trim()
    .maxLength(MEAL_DESCRIPTION_MAX_LENGTH)
    .transform((value) => value.replace(/\r\n?/g, '\n').replace(/[^\P{Cc}\n\t]/gu, ''))
}

/** Catalog list query string. Invalid values fall back to the defaults. */
export const mealListValidator = vine.create({
  q: vine.string().trim().maxLength(100).optional(),
  type: vine.enum(MEAL_TYPES).optional(),
  category: vine.enum(MEAL_CATEGORIES).optional(),
  active: vine.enum(MEAL_ACTIVE_FILTERS).optional(),
  view: vine.enum(['grid', 'list'] as const).optional(),
  page: vine.number().withoutDecimals().min(1).max(10_000).optional(),
})

/** Create / edit a meal. */
export const mealValidator = vine.create({
  nameFr: nameRule(MEAL_NAME_MAX_LENGTH),
  nameEn: nameRule(MEAL_NAME_MAX_LENGTH),
  descriptionFr: descriptionRule().optional(),
  descriptionEn: descriptionRule().optional(),
  type: vine.enum(MEAL_TYPES),
  category: vine.enum(MEAL_CATEGORIES),
  price: madPriceRule(),
  allergens: vine.array(vine.enum(ALLERGENS)).maxLength(ALLERGENS.length).distinct().optional(),
  tags: vine.array(vine.enum(MEAL_TAGS)).maxLength(MEAL_TAGS.length).distinct().optional(),
  isActive: vine.boolean().optional(),
  externalRecipeRef: vine
    .string()
    .trim()
    .maxLength(MEAL_RECIPE_REF_MAX_LENGTH)
    .regex(/^[^\p{C}]+$/u)
    .optional(),
})

/** New photo order: every photo id of the meal, exactly once. */
export const mealPhotoOrderValidator = vine.create({
  ids: vine
    .array(vine.number().withoutDecimals().min(1))
    .minLength(1)
    .maxLength(MEAL_PHOTOS.maxPerMeal)
    .distinct(),
})
