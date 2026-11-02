import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as limiterErrors } from '@adonisjs/limiter'
import MealPhoto from '#models/meal_photo'
import MealPhotoService from '#services/meal_photo_service'
import SchoolBoardService from '#services/school_board_service'
import KioskService from '#services/kiosk_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import vine, { errors as vineErrors } from '@vinejs/vine'
import { kioskPinLimiter, kioskKeys } from '#start/limiter'
import type { MealPhotoVariant } from '#enums/meals'
import { sendMealPhoto } from '#support/meal_photo_response'
import { clientTranslations } from '#support/client_translations'
import i18nManager from '@adonisjs/i18n/services/main'
import { boardIpLimiter, boardKeys } from '#start/limiter'

/**
 * School display board (D46): no login, the address is public (it shows the
 * published menu only). An unknown or turned-off address answers 404.
 * Always in English (the school's language), whatever the browser says.
 */
const BOARD_LOCALE = 'en'

const kioskPinValidator = vine.create({
  pin: vine
    .string()
    .trim()
    .regex(/^\d{4}$/),
})
const kioskOrderValidator = vine.create({
  token: vine.string().trim().minLength(10).maxLength(2000),
  subscriptionMealId: vine.number().withoutDecimals().range([1, 2147483647]).nullable().optional(),
  specialMealIds: vine
    .array(vine.number().withoutDecimals().range([1, 2147483647]))
    .maxLength(10)
    .distinct()
    .optional(),
  extraMealIds: vine
    .array(vine.number().withoutDecimals().range([1, 2147483647]))
    .maxLength(10)
    .distinct()
    .optional(),
})

function boardAppName(school: { name: string }) {
  return `Menu board · ${school.name}`
}
@inject()
export default class BoardController {
  constructor(
    protected board: SchoolBoardService,
    protected photos: MealPhotoService,
    protected kiosk: KioskService
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
      slug,
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

  /**
   * D51: the ordering kiosk. JSON answers for the board page's own fetches:
   * 422 with a translated message when a rule refuses (unknown code, closed
   * day, expired session), 429 after too many codes from one address.
   */
  async kioskStart(ctx: HttpContext) {
    const school = await this.school(ctx)
    if (!school) return
    try {
      await kioskPinLimiter().consume(kioskKeys.ip(ctx.request.ip()))
    } catch (error) {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      ctx.response.header('Retry-After', String(error.response.availableIn))
      return ctx.response.tooManyRequests({
        error: i18nManager.locale(BOARD_LOCALE).t('board.kiosk.too_many'),
      })
    }
    return this.kioskAnswer(ctx, async () => {
      const { pin } = await ctx.request.validateUsing(kioskPinValidator)
      return this.kiosk.start(school, pin, String(ctx.params.slug), BOARD_LOCALE)
    })
  }

  async kioskOrder(ctx: HttpContext) {
    const school = await this.school(ctx)
    if (!school) return
    return this.kioskAnswer(ctx, async () => {
      const input = await ctx.request.validateUsing(kioskOrderValidator)
      return this.kiosk.order(
        school,
        input.token,
        {
          subscriptionMealId: input.subscriptionMealId ?? null,
          specialMealIds: input.specialMealIds ?? [],
          extraMealIds: input.extraMealIds ?? [],
        },
        BOARD_LOCALE
      )
    })
  }

  protected async kioskAnswer<T>(ctx: HttpContext, work: () => Promise<T>) {
    ctx.response.header('Cache-Control', 'no-store')
    try {
      return await work()
    } catch (error) {
      // The board (and its kiosk) is always in English, whatever the browser asks.
      const i18n = i18nManager.locale(BOARD_LOCALE)
      if (error instanceof vineErrors.E_VALIDATION_ERROR) {
        return ctx.response.unprocessableEntity({ error: i18n.t('board.kiosk.error') })
      }
      if (!(error instanceof BusinessRuleException)) throw error
      return ctx.response.unprocessableEntity({
        error: i18n.t(error.messageKey, error.options.values ?? {}),
      })
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
