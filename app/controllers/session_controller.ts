import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import { loginValidator } from '#validators/user'
import { loginLimiter } from '#start/limiter'
import { homePathFor } from '#enums/roles'
import LoginService from '#services/login_service'
import InactiveAccountException from '#exceptions/inactive_account_exception'

export default class SessionController {
  async create({ inertia }: HttpContext) {
    return inertia.render('auth/login', {})
  }

  @inject()
  async store({ request, auth, response, session, i18n }: HttpContext, loginService: LoginService) {
    const { email, password, remember } = await request.validateUsing(loginValidator)
    const key = `login:${request.ip()}:${email}`

    const fail = (message: string) => {
      session.flashExcept(['password'])
      session.flash('error', message)
      return response.redirect('/login')
    }

    try {
      const [throttled, user] = await loginLimiter().penalize(key, () =>
        loginService.verifyCredentials(email, password)
      )

      if (throttled) {
        const minutes = Math.max(1, Math.ceil(throttled.response.availableIn / 60))
        return fail(i18n.t('auth.login.too_many_attempts', { minutes }))
      }

      await auth.use('web').login(user, remember === true)
      await loginService.recordLogin(user)

      return response.redirect(homePathFor(user.role))
    } catch (error) {
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
