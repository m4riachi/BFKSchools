/**
 * Shapes of the meal catalog props (see app/support/meal_display.ts and
 * app/support/meal_page_options.ts).
 */
export type MealPhotoUrls = { url: string; thumbUrl: string }

export type MealSummary = {
  id: number
  name: string
  nameFr: string
  nameEn: string
  type: string
  category: string
  priceCents: number
  /** Null for subscription meals (D31: included, no price). */
  price: string | null
  allergens: string[]
  tags: string[]
  isActive: boolean
  cover: MealPhotoUrls | null
  photosCount: number
}

export type MealPhotoRow = MealPhotoUrls & {
  id: number
  position: number
  isCover: boolean
  width: number | null
  height: number | null
  sizeBytes: number | null
}

export type MealDetail = MealSummary & {
  description: string | null
  descriptionFr: string | null
  descriptionEn: string | null
  priceInput: string
  externalRecipeRef: string | null
  photos: MealPhotoRow[]
  updatedAt: string | null
}

export type MealOptions = {
  types: string[]
  categories: string[]
  activeFilters: string[]
  allergens: string[]
  tags: string[]
}

export type MealFilters = {
  q: string
  type: string
  category: string
  active: string
  view: string
}

export type PhotoLimits = {
  maxFileBytes: number
  maxFilesPerUpload: number
  maxPerMeal: number
  accept: string
}
