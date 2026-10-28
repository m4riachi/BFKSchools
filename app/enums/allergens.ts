/**
 * The 14 EU allergens (Regulation 1169/2011, annex II). Mirrors the CHECK
 * constraints on `children.allergies` (Phase 2) and `meals.allergens`
 * (Phase 3) — see docs/ERD.md §0. Labels: resources/lang/<locale>/allergens.json.
 */
export const ALLERGENS = [
  'gluten',
  'crustaceans',
  'eggs',
  'fish',
  'peanuts',
  'soybeans',
  'milk',
  'nuts',
  'celery',
  'mustard',
  'sesame',
  'sulphites',
  'lupin',
  'molluscs',
] as const

export type AllergenCode = (typeof ALLERGENS)[number]

export function isAllergenCode(value: unknown): value is AllergenCode {
  return typeof value === 'string' && (ALLERGENS as readonly string[]).includes(value)
}

/** SQL literal used by the CHECK constraints (keep in sync with ALLERGENS). */
export const ALLERGENS_SQL_ARRAY = `ARRAY[${ALLERGENS.map((code) => `'${code}'`).join(',')}]::text[]`
