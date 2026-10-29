import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import type { NextFn } from '@adonisjs/core/types/http'
import UserTransformer from '#transformers/user_transformer'
import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware'
import { clientTranslations } from '#support/client_translations'
import NotificationCenterService from '#services/notification_center_service'
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from '#enums/locales'

export default class InertiaMiddleware extends BaseInertiaMiddleware {
  async share(ctx: HttpContext) {
    /**
     * A page may be rendered before the router middleware ran (e.g. a 404),
     * so every HttpContext property is treated as optional here.
     */
    const { auth, i18n } = ctx as Partial<HttpContext>
    const user = auth?.user

    const locale: AppLocale = isAppLocale(i18n?.locale) ? i18n.locale : DEFAULT_LOCALE

    return {
      errors: ctx.inertia.always(this.getValidationErrors(ctx)),
      user: ctx.inertia.always(user ? UserTransformer.transform(user) : undefined),
      locale: ctx.inertia.always(locale),
      messages: ctx.inertia.always(clientTranslations(locale)),
      /** Parents: unread notifications for the header bell (null for staff / guests). */
      unreadNotifications: ctx.inertia.always(await this.unreadNotifications(ctx)),
    }
  }

  /**
   * Unread count of a parent (one indexed count query); null for staff and
   * guests — and null when the query fails: the badge is not worth breaking
   * every parent page (and the error page itself, which renders through
   * this middleware) over a database hiccup.
   */
  protected async unreadNotifications(ctx: HttpContext): Promise<number | null> {
    const user = (ctx as Partial<HttpContext>).auth?.user
    if (!user || user.role !== 'parent' || !user.isActive) return null
    try {
      const center = await ctx.containerResolver.make(NotificationCenterService)
      return await center.unreadCount(user.id)
    } catch (error) {
      logger.warn({ error: (error as Error)?.name ?? 'Error' }, 'unread notifications count failed')
      return null
    }
  }

  flash(ctx: HttpContext) {
    const { session } = ctx as Partial<HttpContext>

    const success: string | undefined = session?.flashMessages.get('success')
    const error: string | undefined = session?.flashMessages.get('error')

    return { success, error }
  }

  async handle(ctx: HttpContext, next: NextFn) {
    await this.init(ctx)

    const output = await next()
    this.dispose(ctx)

    return output
  }
}

declare module '@adonisjs/inertia/types' {
  type MiddlewareSharedProps = InferSharedProps<InertiaMiddleware>
  export interface SharedProps extends MiddlewareSharedProps {}
}
