import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import MealPhoto from '#models/meal_photo'
import MealPhotoService from '#services/meal_photo_service'
import type { MealPhotoVariant } from '#enums/meals'

/**
 * Serves meal photos to logged-in users (any role: parents see meal photos
 * in the portal from Phase 6). Photos of soft-deleted meals stay available
 * for order history.
 *
 * The browser never sees a storage key: the photo is looked up by id and
 * the key comes from the database (no path traversal possible).
 * - fs disk: streamed with a fixed `image/webp` type, `nosniff`, a sandboxing
 *   CSP and `inline` disposition (the files are WebP re-encoded by sharp);
 * - s3 disk: redirect to a signed URL valid 10 minutes (private bucket).
 */
@inject()
export default class MediaController {
  constructor(protected photos: MealPhotoService) {}

  async mealPhoto({ params, response }: HttpContext) {
    const photo = await MealPhoto.findOrFail(Number(params.id))
    const variant = params.variant as MealPhotoVariant
    const key = variant === 'thumb' ? photo.thumbPath : photo.path
    const disk = this.photos.disk(photo.disk)

    response.header('X-Content-Type-Options', 'nosniff')
    response.header('Cross-Origin-Resource-Policy', 'same-origin')

    if (photo.disk !== 'fs') {
      const url = await disk.getSignedUrl(key, {
        expiresIn: '10 mins',
        contentType: 'image/webp',
        contentDisposition: 'inline',
      })
      response.header('Cache-Control', 'private, max-age=300')
      return response.redirect(url)
    }

    if (!(await disk.exists(key))) return response.notFound('Not found')

    const { contentLength } = await disk.getMetaData(key)
    response.header('Content-Type', 'image/webp')
    response.header('Content-Length', String(contentLength))
    response.header('Content-Disposition', 'inline; filename="photo.webp"')
    response.header('Content-Security-Policy', "default-src 'none'; sandbox")
    // A photo's files never change (a new upload is a new id).
    response.header('Cache-Control', 'private, max-age=31536000, immutable')
    return response.stream(await disk.getStream(key))
  }
}
