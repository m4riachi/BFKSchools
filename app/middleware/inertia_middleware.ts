import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import type { NextFn } from '@adonisjs/core/types/http'
import UserTransformer from '#transformers/user_transformer'
import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware'
import { clientTranslations } from '#support/client_translations'
import { zoneOffsets } from '#support/time'
import NotificationCenterService from '#services/notification_center_service'
import SchoolSettingsService from '#services/school_settings_service'
import StaffRoleService from '#services/staff_role_service'
import School from '#models/school'
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
    const school = await this.userSchool(ctx)
    const settings = new SchoolSettingsService()

    return {
      errors: ctx.inertia.always(this.getValidationErrors(ctx)),
      user: ctx.inertia.always(user ? UserTransformer.transform(user) : undefined),
      locale: ctx.inertia.always(locale),
      messages: ctx.inertia.always(clientTranslations(locale)),
      /** D41: so hours follow the server's time zone data, not the browser's. */
      zoneOffsets: ctx.inertia.always(zoneOffsets()),
      /** Parents: unread notifications for the header bell (null for staff / guests). */
      unreadNotifications: ctx.inertia.always(await this.unreadNotifications(ctx)),
      /** D42: what a staff user may open, for the menu (the server checks each route). */
      access: ctx.inertia.always(await this.access(ctx)),
      /** D33: optional modules of the user's school (everything off for guests). */
      features: ctx.inertia.always(
        school
          ? settings.features(school)
          : { allergens: false, labels: false, grade: false, className: false }
      ),
      /** D37: link of the "Commande à domicile" button (parents only, null otherwise). */
      deliveryOrderUrl: ctx.inertia.always(
        school && user?.role === 'parent' ? settings.get(school).delivery_order_url : null
      ),
      glovoUrl: ctx.inertia.always(
        school && user?.role === 'parent' ? settings.get(school).glovo_url : null
      ),
      /** D34: WhatsApp number of the support (parents only, null otherwise). */
      supportWhatsapp: ctx.inertia.always(
        school && user?.role === 'parent' ? settings.get(school).support_whatsapp : null
      ),
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

  protected async access(ctx: HttpContext) {
    const user = (ctx as Partial<HttpContext>).auth?.user
    if (!user || user.role === 'parent') return null
    try {
      return await new StaffRoleService().accessOf(user)
    } catch (error) {
      logger.warn({ error: (error as Error)?.name ?? 'Error' }, 'staff access read failed')
      return null
    }
  }

  /** One primary-key read; a database hiccup hides the modules, not the page. */
  protected async userSchool(ctx: HttpContext) {
    const schoolId = (ctx as Partial<HttpContext>).auth?.user?.schoolId
    if (typeof schoolId !== 'number') return null
    try {
      return await School.find(schoolId)
    } catch (error) {
      logger.warn({ error: (error as Error)?.name ?? 'Error' }, 'school features read failed')
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
