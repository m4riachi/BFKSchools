import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import Meal from '#models/meal'
import MealPhoto from '#models/meal_photo'
import User from '#models/user'
import MealPhotoService from '#services/meal_photo_service'
import type { MealCategory } from '#enums/meals'

/**
 * BFK's restaurant menu (181 dishes and drinks, taken from the BFK ordering
 * site on 2026-10-29) as **inactive** supplements: staff review each one
 * (allergens are unknown — empty — and prices are the restaurant's), then
 * activate the ones the school offers.
 *
 * Data: `database/catalog/bfk_menu.json`; photos: `bfk_menu_photos/`
 * (re-encoded JPEG ≤ 900 px, no metadata; copied into the build).
 * Idempotent by `external_recipe_ref` (`bfk-site:<site id>`): an existing
 * meal is never changed (staff edits win), a deleted one is not recreated,
 * a photo is added only to a meal that has none.
 *
 * Seeded by `node ace bfk:seed catalog` (production) and by the demo
 * catalog seeder (05, development/test, which also activates a few items
 * for the demo menus). Production `db:seed` only creates the school.
 */

export const BFK_MENU_FILE = 'database/catalog/bfk_menu.json'
export const BFK_MENU_PHOTO_DIR = 'database/catalog/bfk_menu_photos'

export type BfkMenuItem = {
  ref: string
  nameFr: string
  nameEn: string
  descriptionFr: string | null
  descriptionEn: string | null
  category: MealCategory
  /** Category on the BFK site (kept for reference only). */
  siteCategory: string
  priceCents: number
  photo: string
}

export async function loadBfkMenu(): Promise<BfkMenuItem[]> {
  return JSON.parse(await readFile(app.makePath(BFK_MENU_FILE), 'utf8'))
}

export async function seedBfkMenu(items: BfkMenuItem[]) {
  const admin = await User.query().where('role', 'admin').orderBy('id').first()
  const photos = await app.container.make(MealPhotoService)

  for (const item of items) {
    // Deleted meals included: a meal staff removed is not brought back.
    let meal = await Meal.query().where('external_recipe_ref', item.ref).first()
    if (meal?.deletedAt) continue
    if (!meal) {
      meal = await Meal.create({
        nameFr: item.nameFr,
        nameEn: item.nameEn,
        descriptionFr: item.descriptionFr,
        descriptionEn: item.descriptionEn,
        type: 'supplement',
        category: item.category,
        priceCents: item.priceCents,
        allergens: [],
        tags: [],
        isActive: false,
        externalRecipeRef: item.ref,
        createdBy: admin?.id ?? null,
        deletedAt: null,
      })
    }
    const hasPhoto = await MealPhoto.query().where('meal_id', meal.id).first()
    if (hasPhoto) continue
    await photos.upload(meal, [
      {
        clientName: item.photo,
        data: await readFile(app.makePath(BFK_MENU_PHOTO_DIR, item.photo)),
        tooLarge: false,
      },
    ])
  }
}
