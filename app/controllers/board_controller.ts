import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as limiterErrors } from '@adonisjs/limiter'
import MealPhoto from '#models/meal_photo'
import MealPhotoService from '#services/meal_photo_service'
import SchoolBoardService from '#services/school_board_service'
import type { MealPhotoVariant } from '#enums/meals'
import { sendMealPhoto } from '#support/meal_photo_response'
import { clientTranslations } from '#support/client_translations'
import { boardIpLimiter, boardKeys } from '#start/limiter'

/**
 * School display board (D46): no login, the address is public (it shows the
 * published menu only). An unknown or turned-off address answers 404.
 * Always in English (the school's language), whatever the browser says.
 */
const BOARD_LOCALE = 'en'
@inject()
export default class BoardController {
  constructor(
    protected board: SchoolBoardService,
    protected photos: MealPhotoService
  ) {}

  /** Rate limit, then the school of the link (null = 404 / 429 already sent). */
  protected async school({ request, response, params }: HttpContext) {
    response.header('X-Robots-Tag', 'noindex, nofollow')
    response.header('Referrer-Policy', 'no-referrer')
    try {
      await boardIpLimiter().consume(boardKeys.ip(request.ip()))
    } catch (error) {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      response.header('Retry-After', String(error.response.availableIn))
      response.tooManyRequests('Too many requests')
      return null
    }
    const school = await this.board.findSchool(String(params.slug))
    if (!school) response.notFound('Not found')
    return school
  }

  async show(ctx: HttpContext) {
    const school = await this.school(ctx)
    if (!school) return
    ctx.response.header('Cache-Control', 'no-store')
    // Overrides the locale InertiaMiddleware shared, for this page only.
    ctx.inertia.share({ locale: BOARD_LOCALE, messages: clientTranslations(BOARD_LOCALE) })
    return ctx.inertia.render('board/show', {
      schoolName: school.name,
      board: await this.board.week(school, String(ctx.params.slug), BOARD_LOCALE),
    })
  }

  async photo(ctx: HttpContext) {
    const school = await this.school(ctx)
    if (!school) return
    const photo = await MealPhoto.find(Number(ctx.params.id))
    if (!photo || !(await this.board.canShowPhoto(school, photo))) {
      return ctx.response.notFound('Not found')
    }
    return sendMealPhoto(ctx.response, this.photos, photo, ctx.params.variant as MealPhotoVariant)
  }
}
