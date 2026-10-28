import i18nManager from '@adonisjs/i18n/services/main'
import type Meal from '#models/meal'
import type MealPhoto from '#models/meal_photo'
import type { AllergenCode } from '#enums/allergens'
import type { MealPhotoVariant } from '#enums/meals'
import type { AppLocale } from '#enums/locales'
import { centsToInput, formatMad } from '#support/money'

/**
 * Display helpers for meals, shared by the catalog (Phase 3), the menu
 * builder (5), the parent portal (6), kitchen sheets (7) and statements (8).
 * They work on deleted meals too (history must still render them).
 */

type Localized = Pick<Meal, 'nameFr' | 'nameEn' | 'descriptionFr' | 'descriptionEn'>

/** Name in the given locale (both names are required, no fallback needed). */
export function mealName(meal: Pick<Meal, 'nameFr' | 'nameEn'>, locale: string): string {
  return locale === 'en' ? meal.nameEn : meal.nameFr
}

/** Description in the given locale, falling back to the other language. */
export function mealDescription(meal: Localized, locale: string): string | null {
  const [preferred, other] =
    locale === 'en'
      ? [meal.descriptionEn, meal.descriptionFr]
      : [meal.descriptionFr, meal.descriptionEn]
  return preferred || other || null
}

/** Base path of the photo route (MediaController). */
export const MEAL_PHOTO_PATH = '/media/meal-photos'

/**
 * Browser URLs of a photo. They never contain the storage key: the route
 * looks the photo up by id, checks the session, then streams the file (fs)
 * or redirects to a short-lived signed URL (s3). A photo's files never
 * change (new upload = new row), so the URLs can be cached.
 */
export function mealPhotoUrl(photo: Pick<MealPhoto, 'id'>, variant: MealPhotoVariant): string {
  return `${MEAL_PHOTO_PATH}/${photo.id}/${variant}`
}

export function mealPhotoUrls(photo: Pick<MealPhoto, 'id'>) {
  return { url: mealPhotoUrl(photo, 'full'), thumbUrl: mealPhotoUrl(photo, 'thumb') }
}

/** The cover among loaded photos (or the first by position as a fallback). */
export function coverPhoto<T extends Pick<MealPhoto, 'isCover' | 'position' | 'id'>>(
  photos: T[] | undefined | null
): T | null {
  if (!photos?.length) return null
  return (
    photos.find((photo) => photo.isCover) ??
    [...photos].sort((a, b) => a.position - b.position || a.id - b.id)[0]
  )
}

/** Cover URLs of a meal whose `photos` are preloaded, or null. */
export function mealCoverUrls(meal: Pick<Meal, 'photos'>) {
  const cover = coverPhoto(meal.photos)
  return cover ? mealPhotoUrls(cover) : null
}

/** Label of one allergen code in the given locale (allergens.<code>). */
export function allergenLabel(code: AllergenCode, locale: AppLocale | string): string {
  return i18nManager.locale(locale).t(`allergens.${code}`)
}

/** Labels of allergen codes, in the order given. */
export function allergenLabels(codes: readonly AllergenCode[], locale: AppLocale | string) {
  const i18n = i18nManager.locale(locale)
  return codes.map((code) => ({ code, label: i18n.t(`allergens.${code}`) }))
}

/** Formatted current price ("45,00 MAD" / "45.00 MAD"). */
export function mealPrice(meal: Pick<Meal, 'priceCents'>, locale: string): string {
  return formatMad(meal.priceCents, locale === 'en' ? 'en' : 'fr')
}

/* ---------------------------------------------------------------------- */
/* Inertia presenters (plain objects; never storage keys or disk names)   */
/* ---------------------------------------------------------------------- */

export function presentMealPhoto(photo: MealPhoto) {
  return {
    id: photo.id,
    ...mealPhotoUrls(photo),
    position: photo.position,
    isCover: photo.isCover,
    width: photo.width,
    height: photo.height,
    sizeBytes: photo.sizeBytes,
  }
}
export type MealPhotoView = ReturnType<typeof presentMealPhoto>

/** A catalog card / row. Needs `photos` preloaded (at least the cover). */
export function presentMealSummary(meal: Meal, locale: string) {
  return {
    id: meal.id,
    name: mealName(meal, locale),
    nameFr: meal.nameFr,
    nameEn: meal.nameEn,
    type: meal.type,
    category: meal.category,
    priceCents: meal.priceCents,
    price: mealPrice(meal, locale),
    allergens: [...meal.allergens],
    tags: [...meal.tags],
    isActive: meal.isActive,
    cover: mealCoverUrls(meal),
    photosCount: Number(meal.$extras.photos_count ?? meal.photos?.length ?? 0),
  }
}
export type MealSummaryView = ReturnType<typeof presentMealSummary>

/** Full meal for the edit form and the kitchen detail page. */
export function presentMealDetail(meal: Meal, locale: string) {
  const photos = [...(meal.photos ?? [])].sort((a, b) => a.position - b.position || a.id - b.id)
  return {
    ...presentMealSummary(meal, locale),
    description: mealDescription(meal, locale),
    descriptionFr: meal.descriptionFr,
    descriptionEn: meal.descriptionEn,
    priceInput: centsToInput(meal.priceCents, locale === 'en' ? 'en' : 'fr'),
    externalRecipeRef: meal.externalRecipeRef,
    photos: photos.map(presentMealPhoto),
    updatedAt: meal.updatedAt?.toISO() ?? null,
  }
}
export type MealDetailView = ReturnType<typeof presentMealDetail>
