import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { errors as limiterErrors } from '@adonisjs/limiter'
import { errors as vineErrors } from '@vinejs/vine'
import PasswordChangeService from '#services/password_change_service'
import { changePasswordValidator } from '#validators/passwords'
import { PASSWORD_MIN_LENGTH } from '#validators/rules'
import { changePasswordLimiter, uploadKeys } from '#start/limiter'
import { CREDENTIALS_SESSION_KEY } from '#support/login_session'
import { rememberKnownDevice } from '#support/known_device'

/**
 * Parent portal — "Account" tab (D30): account details and the change
 * password form. Rate-limited per user (5 attempts / 15 min, then 15 min
 * blocked); a successful change ends every other session (credentials
 * version bump) but keeps this one.
 */
@inject()
export default class AccountController {
  constructor(protected passwords: PasswordChangeService) {}

  /** GET /account */
  async show({ inertia, bouncer, auth, response }: HttpContext) {
    await bouncer.authorize('accessParentPortal')
    const user = auth.getUserOrFail()
    response.header('cache-control', 'no-store')
    return inertia.render('parent/account/index', {
      account: { fullName: user.fullName, email: user.email, phone: user.phone ?? null },
      minLength: PASSWORD_MIN_LENGTH,
    })
  }

  /** PUT /account/password */
  async updatePassword(ctx: HttpContext) {
    const { request, response, session, i18n, bouncer, auth } = ctx
    await bouncer.authorize('accessParentPortal')
    const user = auth.getUserOrFail()

    const fieldError = (field: string, message: string) => {
      // withInput = false: never flash a password back into the session.
      session.flashValidationErrors(
        {
          code: 'E_VALIDATION_ERROR',
          messages: [{ field, message }],
        } as unknown as Parameters<typeof session.flashValidationErrors>[0],
        false
      )
      return response.redirect().withQs(false).toPath('/account')
    }

    const limiter = changePasswordLimiter()
    const key = uploadKeys.changePassword(user.id)
    try {
      await limiter.consume(key)
    } catch (error) {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      const minutes = Math.max(1, Math.ceil(error.response.availableIn / 60))
      session.flash('error', i18n.t('auth.change_password.too_many', { minutes }))
      return response.redirect().withQs(false).toPath('/account')
    }

    let input: { currentPassword: string; password: string }
    try {
      input = await request.validateUsing(changePasswordValidator)
    } catch (error) {
      if (!(error instanceof vineErrors.E_VALIDATION_ERROR)) throw error
      // Same as the default handler, minus the old input (passwords).
      session.flashValidationErrors(error, false)
      return response.redirect().withQs(false).toPath('/account')
    }
    const { currentPassword, password } = input
    const result = await this.passwords.change(user.id, currentPassword, password)
    if (!result.ok) {
      if (result.reason === 'wrong_current') {
        return fieldError('currentPassword', i18n.t('auth.change_password.wrong_current'))
      }
      if (result.reason === 'same_password') {
        return fieldError('password', i18n.t('auth.change_password.same_password'))
      }
      session.flash('error', i18n.t('errors.action_failed'))
      return response.redirect().withQs(false).toPath('/account')
    }

    // Keep this session (bound to the new version) and this browser's
    // known-device entry; every other session and cookie is now stale.
    session.put(CREDENTIALS_SESSION_KEY, result.user.credentialsVersion)
    rememberKnownDevice(ctx, result.user)
    await limiter.delete(key)

    session.flash('success', i18n.t('auth.change_password.done'))
    return response.redirect().withQs(false).toPath('/account')
  }
}
