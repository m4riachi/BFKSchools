import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import UserTransformer from '#transformers/user_transformer'
import BaseInertiaMiddleware from '@adonisjs/inertia/inertia_middleware'
import { clientTranslations } from '#support/client_translations'
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from '#enums/locales'

export default class InertiaMiddleware extends BaseInertiaMiddleware {
  share(ctx: HttpContext) {
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
