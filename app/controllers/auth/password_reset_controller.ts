import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as limiterErrors } from '@adonisjs/limiter'
import AccountLinkService from '#services/account_link_service'
import DeferredTasks from '#services/deferred_tasks'
import { forgotPasswordValidator } from '#validators/passwords'
import { passwordLinkKeys, resetRequestEmailLimiter, resetRequestIpLimiter } from '#start/limiter'

/**
 * "Forgot password": same response, and the same work on the request path,
 * whether or not the email has an account — the account lookup, token and
 * email run after the response (DeferredTasks). Rate-limited per IP
 * (visible) and per email (silent), with its own limiters — the login
 * budgets are never consumed here.
 */
@inject()
export default class PasswordResetController {
  constructor(
    protected accountLinks: AccountLinkService,
    protected deferred: DeferredTasks
  ) {}

  async create({ inertia }: HttpContext) {
    return inertia.render('auth/forgot_password', {})
  }

  async store({ request, response, session, i18n }: HttpContext) {
    const ip = request.ip()
    try {
      await resetRequestIpLimiter().consume(passwordLinkKeys.requestIp(ip))
    } catch (error) {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      const minutes = Math.max(1, Math.ceil(error.response.availableIn / 60))
      session.flash('error', i18n.t('auth.forgot.too_many', { minutes }))
      return response.redirect('/password/forgot')
    }

    const { email } = await request.validateUsing(forgotPasswordValidator)

    let withinEmailBudget = true
    try {
      await resetRequestEmailLimiter().consume(passwordLinkKeys.requestEmail(email))
    } catch (error) {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      withinEmailBudget = false
    }
    if (withinEmailBudget) {
      this.deferred.run('password-reset', () => this.accountLinks.requestPasswordReset(email, ip))
    }

    session.flash('success', i18n.t('auth.forgot.sent'))
    return response.redirect('/password/forgot')
  }
}
