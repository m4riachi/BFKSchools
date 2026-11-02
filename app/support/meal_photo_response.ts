import type { HttpContext } from '@adonisjs/core/http'
import type MealPhoto from '#models/meal_photo'
import type MealPhotoService from '#services/meal_photo_service'
import type { MealPhotoVariant } from '#enums/meals'

/**
 * Sends one meal photo, once the caller has authorized it (MediaController
 * for logged-in users, BoardController for the display board link).
 * - fs disk: streamed with a fixed `image/webp` type, `nosniff`, a sandboxing
 *   CSP and `inline` disposition (the files are WebP re-encoded by sharp);
 * - s3 disk: redirect to a signed URL valid 10 minutes (private bucket).
 */
export async function sendMealPhoto(
  response: HttpContext['response'],
  photos: MealPhotoService,
  photo: MealPhoto,
  variant: MealPhotoVariant
) {
  const key = variant === 'thumb' ? photo.thumbPath : photo.path
  const disk = photos.disk(photo.disk)

  response.header('X-Content-Type-Options', 'nosniff')
  response.header('Cross-Origin-Resource-Policy', 'same-origin')

  if (photo.disk !== 'fs') {
    const url = await disk.getSignedUrl(key, {
      expiresIn: '10 mins',
      contentType: 'image/webp',
      contentDisposition: 'inline',
    })
    response.header('Cache-Control', 'private, max-age=300')
    // clearQs: the app forwards query strings on redirects (config/app.ts);
    // appending our `?v=` to a signed URL breaks its signature (403).
    return response.redirect().clearQs().toPath(url)
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
