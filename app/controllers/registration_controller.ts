import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'
import { errors as limiterErrors } from '@adonisjs/limiter'
import ParentRegistrationService, { registrationPath } from '#services/parent_registration_service'
import SchoolSettingsService from '#services/school_settings_service'
import { registrationValidator } from '#validators/families'
import {
  passwordLinkConfirmLimiter,
  passwordLinkKeys,
  registrationKeys,
  registrationSchoolLimiter,
  registrationSubmitLimiter,
  registrationViewLimiter,
} from '#start/limiter'
import RegistrationTaskQueue from '#services/registration_task_queue'
import { LINK_PATHS } from '#services/account_link_service'
import { PASSWORD_MIN_LENGTH } from '#validators/rules'
import { ALLERGENS } from '#enums/allergens'
import { REGISTRATION_MAX_CHILDREN } from '#enums/parents'

/** Flash key of the "request received" state (same for a new or a known email). */
const SENT_FLASH = 'registrationSent'

/**
 * D59: the public sign-up form reached from the school's QR code
 * (`/inscription/<token>`, no login). An unknown token, or sign-ups turned
 * off, is a 404. Every answer after a valid submission is the same
 * "awaiting validation" page, whether the email was new or not.
 */
@inject()
export default class RegistrationController {
  constructor(
    protected registrations: ParentRegistrationService,
    protected settings: SchoolSettingsService,
    protected signUps: RegistrationTaskQueue
  ) {}

  protected async school(ctx: HttpContext) {
    ctx.response.header('Cache-Control', 'no-store')
    ctx.response.header('X-Robots-Tag', 'noindex, nofollow')
    ctx.response.header('Referrer-Policy', 'no-referrer')
    const school = await this.registrations.findSchool(String(ctx.params.token ?? ''))
    if (!school) throw new Exception('Not found', { status: 404, code: 'E_NOT_FOUND' })
    return school
  }

  async show(ctx: HttpContext) {
    try {
      await registrationViewLimiter().consume(registrationKeys.viewIp(ctx.request.ip()))
    } catch (error) {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      ctx.response.header('Retry-After', String(error.response.availableIn))
      return ctx.response.tooManyRequests(ctx.i18n.t('errors.busy'))
    }
    const school = await this.school(ctx)
    const features = this.settings.features(school)
    return ctx.inertia.render('auth/register', {
      action: registrationPath(String(ctx.params.token)),
      schoolName: school.name,
      sent: ctx.session.flashMessages.get(SENT_FLASH) === true,
      fields: {
        grade: features.grade,
        className: features.className,
        allergens: features.allergens,
      },
      allergens: features.allergens ? [...ALLERGENS] : [],
      maxChildren: REGISTRATION_MAX_CHILDREN,
      minLength: PASSWORD_MIN_LENGTH,
    })
  }

  async store(ctx: HttpContext) {
    const { request, response, session, i18n } = ctx
    const back = registrationPath(String(ctx.params.token))
    const tooMany = (error: unknown) => {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      const minutes = Math.max(1, Math.ceil(error.response.availableIn / 60))
      session.flashExcept(['password', 'password_confirmation'])
      session.flash('error', i18n.t('families.registration.too_many', { minutes }))
      return response.redirect(back)
    }

    // Per address first, before any database lookup (L1)…
    try {
      await registrationSubmitLimiter().consume(registrationKeys.submitIp(request.ip()))
    } catch (error) {
      return tooMany(error)
    }
    const school = await this.school(ctx)
    const { website, ...input } = await request.validateUsing(registrationValidator)
    // …then per school, whatever the address (M1); invalid posts do not count.
    try {
      await registrationSchoolLimiter().consume(registrationKeys.school(school.id))
    } catch (error) {
      return tooMany(error)
    }
    // After the response, in the sign-ups' own small queue, so a new email, a
    // known one (nothing created) and a full waiting list all cost the same.
    // Honeypot filled: nothing at all.
    if (!website) {
      this.signUps.run('parent-registration', () => this.registrations.register(school, input))
    }

    session.flash(SENT_FLASH, true)
    return response.redirect(back)
  }

  /** D59: the link of the confirmation email — a page with one button (nothing consumed on GET). */
  async showConfirmation(ctx: HttpContext) {
    try {
      await registrationViewLimiter().consume(registrationKeys.viewIp(ctx.request.ip()))
    } catch (error) {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      ctx.response.header('Retry-After', String(error.response.availableIn))
      return ctx.response.tooManyRequests(ctx.i18n.t('errors.busy'))
    }
    ctx.response.header('Cache-Control', 'no-store')
    ctx.response.header('Referrer-Policy', 'no-referrer')
    ctx.response.header('X-Robots-Tag', 'noindex, nofollow')
    const token = String(ctx.params.token ?? '')
    const done = ctx.session.flashMessages.get('emailConfirmation') as
      'confirmed' | 'declined' | undefined
    // M2: what was submitted, so the owner of the address can tell whether
    // the request is theirs (phone masked, first names only).
    const summary = done ? null : await this.registrations.confirmationSummary(token)
    return ctx.inertia.render('auth/confirm_email', {
      action: `${LINK_PATHS.email_confirmation}/${token}`,
      state: done ?? (summary ? 'valid' : 'invalid'),
      summary,
    })
  }

  async confirm(ctx: HttpContext) {
    const { request, response, session, i18n } = ctx
    const token = String(ctx.params.token ?? '')
    const back = `${LINK_PATHS.email_confirmation}/${token}`
    try {
      await passwordLinkConfirmLimiter().consume(passwordLinkKeys.confirmIp(request.ip()))
    } catch (error) {
      if (!(error instanceof limiterErrors.E_TOO_MANY_REQUESTS)) throw error
      const minutes = Math.max(1, Math.ceil(error.response.availableIn / 60))
      session.flash('error', i18n.t('auth.set_password.too_many', { minutes }))
      return response.redirect(back)
    }
    // "Ce n'est pas moi": the same single-use link refuses the sign-up instead.
    const decline = request.input('decision') === 'decline'
    const done = decline
      ? await this.registrations.declineByEmail(token)
      : await this.registrations.confirmEmail(token)
    if (done) session.flash('emailConfirmation', decline ? 'declined' : 'confirmed')
    return response.redirect(back)
  }
}
