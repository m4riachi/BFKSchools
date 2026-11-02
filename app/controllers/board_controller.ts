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

function boardAppName(school: { name: string }) {
  return `Menu board · ${school.name}`
}
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
    const slug = String(ctx.params.slug)
    // Overrides the locale InertiaMiddleware shared, for this page only, and
    // installs as its own app (inertia_layout.edge reads manifestUrl / appTitle).
    ctx.inertia.share({
      locale: BOARD_LOCALE,
      messages: clientTranslations(BOARD_LOCALE),
      manifestUrl: `/board/${slug}/manifest.webmanifest`,
      appTitle: boardAppName(school),
    })
    return ctx.inertia.render('board/show', {
      schoolName: school.name,
      board: await this.board.week(school, slug, BOARD_LOCALE),
    })
  }

  /**
   * Web app manifest of the board: installed from the board page, the app
   * opens on the board itself (not on the login page like the main app).
   */
  async manifest(ctx: HttpContext) {
    const school = await this.school(ctx)
    if (!school) return
    const path = `/board/${String(ctx.params.slug)}`
    ctx.response.header('Cache-Control', 'no-store')
    ctx.response.type('application/manifest+json')
    return {
      name: boardAppName(school),
      short_name: 'Menu board',
      description: `The menu of the week at ${school.name}`,
      lang: BOARD_LOCALE,
      id: path,
      start_url: path,
      scope: `${path}/`,
      display: 'fullscreen',
      orientation: 'portrait',
      theme_color: '#ffffff',
      background_color: '#ffffff',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        {
          src: '/icons/icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    }
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
