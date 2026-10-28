import { inject } from '@adonisjs/core'
import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import { errors as limiterErrors } from '@adonisjs/limiter'
import { loginValidator } from '#validators/user'
import {
  LOGIN_LIMITS,
  loginEmailLimiter,
  loginIpEmailLimiter,
  loginIpLimiter,
  loginKeys,
} from '#start/limiter'
import { homePathFor } from '#enums/roles'
import LoginService from '#services/login_service'
import InactiveAccountException from '#exceptions/inactive_account_exception'
import { isKnownDevice } from '#support/known_device'
import { startUserSession } from '#support/login_session'
import { maskEmail } from '#app/mail/log_transport'

export default class SessionController {
  async create({ inertia }: HttpContext) {
    return inertia.render('auth/login', {})
  }

  /**
   * Every limiter is consumed atomically BEFORE the password is checked, so
   * parallel requests cannot all slip through on the same remaining budget.
   * Unknown emails and wrong passwords consume and respond identically.
   */
  @inject()
  async store(ctx: HttpContext, loginService: LoginService) {
    const { request, response, session, i18n } = ctx
    const ip = request.ip()

    const fail = (message: string) => {
      session.flashExcept(['password'])
      session.flash('error', message)
      return response.redirect('/login')
    }

    try {
      await loginIpLimiter().consume(loginKeys.ip(ip))

      const { email, password, remember } = await request.validateUsing(loginValidator)
      const ipEmailKey = loginKeys.ipEmail(ip, email)
      const emailKey = loginKeys.email(email)

      await loginIpEmailLimiter().consume(ipEmailKey)
      // A browser that already signed in to this account (with its current
      // credentials) skips the per-email limit, so exhausting it cannot lock
      // the real user out. Unknown emails never match.
      const candidate = await loginService.findUser(email)
      if (!candidate || !isKnownDevice(request, candidate)) {
        try {
          await loginEmailLimiter().consume(emailKey)
        } catch (error) {
          const limit = LOGIN_LIMITS.email.requests
          if (
            error instanceof limiterErrors.E_TOO_MANY_REQUESTS &&
            error.response.consumed === limit + 1
          ) {
            logger.warn({ email: maskEmail(email) }, 'login: per-email limit reached')
          }
          throw error
        }
      }

      const user = await loginService.verifyCredentials(email, password, candidate)

      await loginIpEmailLimiter().delete(ipEmailKey)
      await loginEmailLimiter().delete(emailKey)

      await startUserSession(ctx, user, remember === true)
      await loginService.recordLogin(user)

      return response.redirect(homePathFor(user.role))
    } catch (error) {
      if (error instanceof limiterErrors.E_TOO_MANY_REQUESTS) {
        const minutes = Math.max(1, Math.ceil(error.response.availableIn / 60))
        return fail(i18n.t('auth.login.too_many_attempts', { minutes }))
      }
      if (error instanceof authErrors.E_INVALID_CREDENTIALS) {
        return fail(i18n.t('auth.login.invalid'))
      }
      if (error instanceof InactiveAccountException) {
        return fail(i18n.t('auth.login.inactive'))
      }
      throw error
    }
  }

  async destroy({ auth, response }: HttpContext) {
    await auth.use('web').logout()
    return response.redirect('/login')
  }
}
