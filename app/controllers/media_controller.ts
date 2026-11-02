import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import MealPhoto from '#models/meal_photo'
import MealPhotoService from '#services/meal_photo_service'
import type { MealPhotoVariant } from '#enums/meals'
import { sendMealPhoto } from '#support/meal_photo_response'

/**
 * Serves meal photos to logged-in users, authorized by MealPolicy.viewPhoto
 * (staff/kitchen: all; parents: meals on their school's published menus or
 * in their children's orders; otherwise 404 — no hint that the id exists).
 * Photos of soft-deleted meals stay available for order history.
 *
 * The browser never sees a storage key: the photo is looked up by id and
 * the key comes from the database (no path traversal possible). Headers and
 * disks: see sendMealPhoto().
 */
@inject()
export default class MediaController {
  constructor(protected photos: MealPhotoService) {}

  async mealPhoto({ params, response, bouncer }: HttpContext) {
    const photo = await MealPhoto.findOrFail(Number(params.id))
    if (await bouncer.with('MealPolicy').denies('viewPhoto', photo)) {
      return response.notFound('Not found')
    }
    return sendMealPhoto(response, this.photos, photo, params.variant as MealPhotoVariant)
  }
}
