/**
 * Meal catalog settings (Phase 3). Not stored in the database: changing a
 * value here is a code change (reviewed, tested).
 */

/**
 * Tags offered in the meal form (`meals.tags`, text[] without a DB check —
 * docs/ERD.md §0). Adding a tag = add it here + its labels in
 * resources/lang/<locale>/meals.json (`meals.tags.<code>`).
 */
export const MEAL_TAGS = ['vegetarian', 'vegan', 'halal', 'spicy', 'gluten_free'] as const
export type MealTag = (typeof MEAL_TAGS)[number]

/** Highest accepted price: 10 000,00 MAD (in centimes). */
export const MEAL_MAX_PRICE_CENTS = 1_000_000

export const MEAL_NAME_MAX_LENGTH = 120
export const MEAL_DESCRIPTION_MAX_LENGTH = 2000
export const MEAL_RECIPE_REF_MAX_LENGTH = 120

/** Catalog page size (grid and list). */
export const MEALS_PER_PAGE = 24

/**
 * Photo uploads. Files are buffered in memory (never written to a tmp
 * folder), checked by magic bytes, then decoded and re-encoded by sharp.
 */
export const MEAL_PHOTOS = {
  /** Accepted inputs (by content, not by extension). */
  formats: ['jpeg', 'png', 'webp'] as const,
  /** Per-file limit. */
  maxFileBytes: 8 * 1024 * 1024,
  /** Files per upload request. */
  maxFilesPerUpload: 6,
  /** Photos per meal. */
  maxPerMeal: 12,
  /**
   * Whole multipart body of the upload route (bodyparser `process({ limit })`):
   * maxFilesPerUpload × maxFileBytes + 1 MB of multipart overhead.
   */
  routeLimit: '49mb',
  /** Decompression-bomb guard (sharp `limitInputPixels`): ~50 megapixels. */
  maxInputPixels: 50_000_000,
  /** Smallest accepted side, in pixels. */
  minSide: 64,
  /** Re-encoded original: longest side ≤ 1600 px, WebP. */
  fullSize: 1600,
  /** Thumbnail: longest side ≤ 400 px, WebP. */
  thumbSize: 400,
  webpQuality: 82,
  thumbQuality: 78,
} as const
