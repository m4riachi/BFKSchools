import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as limiterErrors } from '@adonisjs/limiter'
import AccountLinkService, { LINK_PATHS } from '#services/account_link_service'
import UserTokenService from '#services/user_token_service'
import LoginService from '#services/login_service'
import { setPasswordValidator } from '#validators/passwords'
import { passwordLinkConfirmLimiter, passwordLinkKeys } from '#start/limiter'
import { endSession, startUserSession } from '#support/login_session'
import { homePathFor } from '#enums/roles'
import { PASSWORD_MIN_LENGTH } from '#validators/rules'
import type { UserTokenType } from '#enums/user_tokens'

/**
 * The set-password page reached from an invitation or a password-reset
 * email. The token is checked (not consumed) on GET and consumed on POST;
 * on success the user is logged in.
 */
@inject()
export default class AccountLinksController {
  constructor(
    protected accountLinks: AccountLinkService,
    protected tokens: UserTokenService,
    protected loginService: LoginService
  ) {}

  showInvitation(ctx: HttpContext) {
    return this.show(ctx, 'invitation')
  }

  acceptInvitation(ctx: HttpContext) {
    return this.submit(ctx, 'invitation')
  }

  showReset(ctx: HttpContext) {
    return this.show(ctx, 'password_reset')
  }

  submitReset(ctx: HttpContext) {
    return this.submit(ctx, 'password_reset')
  }

  protected async show({ params, inertia, response }: HttpContext, type: UserTokenType) {
    const token = String(params.token ?? '')
    const record = await this.tokens.findUsable(token, type)
    response.header('cache-control', 'no-store')
    return inertia.render('auth/set_password', {
      mode: type,
      valid: record !== null,
      action: `${LINK_PATHS[type]}/${token}`,
      fullName: record?.user.fullName ?? null,
      email: record?.user.email ?? null,
      minLength: PASSWORD_MIN_LENGTH,
    })
  }

  protected async submit(ctx: HttpContext, type: UserTokenType) {
    const { params, request, response, session, i18n, auth } = ctx
    const token = String(params.token ?? '')
    const back = `${LINK_PATHS[type]}/${token}`

    try {
      await passwordLinkConfirmLimiter().consume(passwordLinkKeys.confirmIp(request.ip()))
    } catch (error) {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      const minutes = Math.max(1, Math.ceil(error.response.availableIn / 60))
      session.flash('error', i18n.t('auth.set_password.too_many', { minutes }))
      return response.redirect(back)
    }

    const { password } = await request.validateUsing(setPasswordValidator)
    const user = await this.accountLinks.setPassword(type, token, password)
    if (!user) {
      session.flash('error', i18n.t('auth.set_password.invalid_link'))
      return response.redirect(back)
    }

    if (auth.user) await endSession(ctx)
    await startUserSession(ctx, user)
    await this.loginService.recordLogin(user)

    session.flash(
      'success',
      i18n.t(type === 'invitation' ? 'auth.set_password.welcome' : 'auth.set_password.reset_done')
    )
    return response.redirect(homePathFor(user.role))
  }
}
