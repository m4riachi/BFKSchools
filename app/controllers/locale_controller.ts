import type { HttpContext } from '@adonisjs/core/http'
import { localeValidator } from '#validators/user'
import { LOCALE_COOKIE } from '#middleware/detect_user_locale_middleware'

export default class LocaleController {
  /**
   * Switches the UI language: saved on the user when logged in, and in a
   * cookie (used for guests, e.g. on the login page).
   */
  async update({ request, response, auth }: HttpContext) {
    const { locale } = await request.validateUsing(localeValidator)

    const user = auth.user
    if (user && user.locale !== locale) {
      user.locale = locale
      await user.save()
    }

    response.plainCookie(LOCALE_COOKIE, locale, {
      maxAge: '1 year',
      httpOnly: true,
      sameSite: 'lax',
    })

    return response.redirect().back()
  }
}
