import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import MealService from '#services/meal_service'
import MealPhotoService, { type UploadedPhoto } from '#services/meal_photo_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { mealPhotoOrderValidator } from '#validators/meals'
import { MEAL_PHOTOS } from '#config/meals'

/** Multipart field of the files: `photos`, `photos[]` or `photos[n]`. */
const PHOTO_FIELD = /^photos(\[\d{0,2}\])?$/

/**
 * Photos of a meal (admin + manager). The upload route is excluded from the
 * bodyparser's automatic multipart processing (config/bodyparser.ts
 * `processManually`), so:
 * - authorization and the meal lookup run before any byte of the body is read;
 * - the whole body is capped by MEAL_PHOTOS.routeLimit (413 above it);
 * - files are buffered in memory, each capped at maxFileBytes (extra bytes
 *   are drained and dropped), so no tmp file is ever written.
 */
@inject()
export default class MealPhotosController {
  constructor(
    protected meals: MealService,
    protected photos: MealPhotoService
  ) {}

  async store({ params, request, response, bouncer, session, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const meal = await this.meals.findInCatalog(params.id)

    const files = await this.readPhotos(request)
    const created = await this.photos.upload(meal, files)

    session.flash('success', i18n.t('meals.photos.flash.uploaded', { count: created.length }))
    return response.redirect(`/admin/meals/${meal.id}/edit`)
  }

  async reorder({ params, request, response, bouncer, session, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const meal = await this.meals.findInCatalog(params.id)
    const { ids } = await request.validateUsing(mealPhotoOrderValidator)
    await this.photos.reorder(meal, ids)
    session.flash('success', i18n.t('meals.photos.flash.reordered'))
    return response.redirect(`/admin/meals/${meal.id}/edit`)
  }

  async cover({ params, response, bouncer, session, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const meal = await this.meals.findInCatalog(params.id)
    await this.photos.setCover(meal, Number(params.photoId))
    session.flash('success', i18n.t('meals.photos.flash.cover'))
    return response.redirect(`/admin/meals/${meal.id}/edit`)
  }

  async destroy({ params, response, bouncer, session, i18n }: HttpContext) {
    await bouncer.with('MealPolicy').authorize('manage')
    const meal = await this.meals.findInCatalog(params.id)
    await this.photos.delete(meal, Number(params.photoId))
    session.flash('success', i18n.t('meals.photos.flash.deleted'))
    return response.redirect(`/admin/meals/${meal.id}/edit`)
  }

  /**
   * Streams the multipart body into memory buffers. Every byte goes through
   * the bodyparser's reporter, which enforces the route limit.
   */
  protected async readPhotos(request: HttpContext['request']): Promise<UploadedPhoto[]> {
    const multipart = request.multipart
    if (!multipart || !request.is(['multipart/form-data'])) {
      throw new BusinessRuleException('meals.photos.errors.none')
    }

    const files: UploadedPhoto[] = []
    let tooMany = false

    multipart.onFile('*', { deferValidations: true }, async (part, reporter) => {
      // Reserve the slot when the part starts (keeps the client's order).
      let entry: UploadedPhoto | null = null
      if (PHOTO_FIELD.test(part.name)) {
        if (files.length < MEAL_PHOTOS.maxFilesPerUpload) {
          entry = { clientName: part.filename ?? '', data: Buffer.alloc(0), tooLarge: false }
          files.push(entry)
        } else {
          tooMany = true
        }
      }

      const chunks: Buffer[] = []
      let bytes = 0
      for await (const chunk of part as AsyncIterable<Buffer>) {
        await reporter(chunk)
        if (!entry || entry.tooLarge) continue
        bytes += chunk.length
        if (bytes > MEAL_PHOTOS.maxFileBytes) {
          entry.tooLarge = true
          chunks.length = 0
        } else {
          chunks.push(chunk)
        }
      }
      if (entry && !entry.tooLarge) entry.data = Buffer.concat(chunks)
      return {}
    })

    try {
      await multipart.process({ limit: MEAL_PHOTOS.routeLimit, maxFields: 10 })
    } catch (error) {
      if ((error as { status?: number }).status === 413) {
        throw new BusinessRuleException('meals.photos.errors.request_too_large', {
          values: { max: MEAL_PHOTOS.maxFilesPerUpload },
        })
      }
      throw error
    }

    if (tooMany) {
      throw new BusinessRuleException('meals.photos.errors.too_many_files', {
        values: { max: MEAL_PHOTOS.maxFilesPerUpload },
      })
    }
    return files
  }
}
