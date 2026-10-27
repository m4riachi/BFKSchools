import { I18n } from '@adonisjs/i18n'
import i18nManager from '@adonisjs/i18n/services/main'
import type { NextFn } from '@adonisjs/core/types/http'
import { type HttpContext, RequestValidator } from '@adonisjs/core/http'
import { DEFAULT_LOCALE, isAppLocale } from '#enums/locales'

export const LOCALE_COOKIE = 'bfk_locale'

/**
 * Picks the request locale: the logged-in user's `locale`, then the locale
 * cookie (guests), then the Accept-Language header, then French.
 */
export default class DetectUserLocaleMiddleware {
  /**
   * VineJS messages come from resources/lang/<locale>/validator.json.
   */
  static {
    RequestValidator.messagesProvider = (ctx) => {
      return ctx.i18n.createMessagesProvider()
    }
  }

  protected getRequestLocale(ctx: HttpContext): string {
    const user = ctx.auth?.user
    if (user && isAppLocale(user.locale)) return user.locale

    const cookie = ctx.request.plainCookie(LOCALE_COOKIE)
    if (isAppLocale(cookie)) return cookie

    return i18nManager.getSupportedLocaleFor(ctx.request.languages()) ?? DEFAULT_LOCALE
  }

  async handle(ctx: HttpContext, next: NextFn) {
    ctx.i18n = i18nManager.locale(this.getRequestLocale(ctx))
    ctx.containerResolver.bindValue(I18n, ctx.i18n)

    if ('view' in ctx) {
      ctx.view.share({ i18n: ctx.i18n })
    }

    return next()
  }
}

declare module '@adonisjs/core/http' {
  export interface HttpContext {
    i18n: I18n
  }
}
