import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import logger from '@adonisjs/core/services/logger'
import i18nManager from '@adonisjs/i18n/services/main'
import env from '#start/env'
import User from '#models/user'
import Clock from '#services/clock'
import UserTokenService from '#services/user_token_service'
import { revokeRememberMeTokens } from '#services/account_security_service'
import AccountLinkMail from '#mails/account_link_mail'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { UserTokenType } from '#enums/user_tokens'
import { maskEmail } from '#app/mail/log_transport'
import { safeMailError } from '#services/outbox_service'
import { APP_TIMEZONE } from '#support/time'
import { whatsappNumber } from '#support/whatsapp'

/** Public paths of the links (also used by start/routes.ts). */
export const LINK_PATHS: Record<UserTokenType, string> = {
  invitation: '/invitation',
  password_reset: '/password/reset',
}

export function linkUrl(type: UserTokenType, token: string) {
  return new URL(`${LINK_PATHS[type]}/${token}`, env.get('APP_URL')).toString()
}

/**
 * Invitations ("give access") and password resets. Both use a single-use
 * hashed token (UserTokenService) and end on the same set-password page.
 * Emails are sent directly after the token's transaction commits (D16).
 */
@inject()
export default class AccountLinkService {
  constructor(
    protected clock: Clock,
    protected tokens: UserTokenService
  ) {}

  /**
   * Sends (or re-sends) an invitation to a parent (or a staff user, D42) who
   * has no password yet.
   * Any previous invitation link stops working.
   *
   * @throws BusinessRuleException when the parent is inactive or already has
   * access, or when the email cannot be sent.
   */
  async invite(parent: User, sentBy: User, audience: 'parent' | 'staff' = 'parent') {
    const { token, record, locked } = await this.issueInvitation(parent, sentBy, audience)

    try {
      await mail.send(
        new AccountLinkMail('invitation', locked, linkUrl('invitation', token), record.expiresAt)
      )
    } catch (error) {
      logger.error(
        { error: safeMailError(error), to: maskEmail(parent.email) },
        'invitation email failed'
      )
      throw new BusinessRuleException('families.errors.invitation_email_failed')
    }
    return record
  }

  /**
   * The same invitation, for a parent reached on WhatsApp (D43): returns the
   * wa.me link that opens a chat with the message ready. Staff press send
   * themselves, so nothing is sent from here and no email goes out.
   */
  async whatsappInvitation(parent: User, sentBy: User) {
    const number = whatsappNumber(parent.phone)
    if (!number) throw new BusinessRuleException('families.errors.no_whatsapp_number')
    const { token, record, locked } = await this.issueInvitation(parent, sentBy, 'parent')
    const locale = locked.locale
    const message = i18nManager.locale(locale).t('emails.invitation.whatsapp', {
      name: locked.fullName,
      url: linkUrl('invitation', token),
      date: record.expiresAt
        .setZone(APP_TIMEZONE)
        .setLocale(locale)
        .toLocaleString({ dateStyle: 'long', timeStyle: 'short' }),
    })
    return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
  }

  protected async issueInvitation(parent: User, sentBy: User, audience: 'parent' | 'staff') {
    const assertInvitable = (user: User) => {
      if ((user.role === 'parent') !== (audience === 'parent')) {
        throw new BusinessRuleException('families.errors.not_a_parent')
      }
      if (!user.isActive) throw new BusinessRuleException('families.errors.invite_inactive')
      if (user.password) throw new BusinessRuleException('families.errors.already_has_access')
    }
    assertInvitable(parent)

    const { token, record, locked } = await db.transaction(async (trx) => {
      // Re-check on the locked row: the parent may have accepted an earlier
      // invitation or been deactivated since the caller loaded it.
      const current = await User.query({ client: trx }).where('id', parent.id).forUpdate().first()
      if (!current) throw new BusinessRuleException('families.errors.not_a_parent')
      assertInvitable(current)
      const issued = await this.tokens.issue(current, 'invitation', { trx, createdBy: sentBy.id })
      current.invitedAt = this.clock.now()
      await current.save()
      return { ...issued, locked: current }
    })
    parent.invitedAt = locked.invitedAt
    return { token, record, locked }
  }

  /**
   * "Forgot password" — the deferred part (see PasswordResetController,
   * which schedules it after the response so known and unknown emails cost
   * the same). Sends a reset link only to an active account that already
   * set a password (D17: never-invited / not-yet-accepted accounts get
   * nothing). Never throws for "no such account".
   */
  async requestPasswordReset(email: string, ip: string | null) {
    const user = await User.findByEmail(email)
    if (!user || !user.isActive || !user.password) return

    const { token, record } = await db.transaction(async (trx) => {
      return this.tokens.issue(user, 'password_reset', { trx, ip })
    })

    try {
      await mail.send(
        new AccountLinkMail(
          'password_reset',
          user,
          linkUrl('password_reset', token),
          record.expiresAt
        )
      )
    } catch (error) {
      logger.error(
        { error: safeMailError(error), to: maskEmail(user.email) },
        'password reset email failed'
      )
    }
  }

  /**
   * Sets the password from an invitation or reset link. Consumes the token,
   * revokes the user's other open links and ends every existing login
   * (credentials version bump + remember-me tokens). Returns null when the
   * link is not usable.
   */
  async setPassword(type: UserTokenType, rawToken: string, password: string): Promise<User | null> {
    // Lock order = user row, then its tokens — the same order as
    // UserTokenService.issue() (resend / new reset request), so the two can
    // never deadlock. The token is looked up without a lock first to find
    // its user, then consumed (locked) after the user row.
    const owner = await this.tokens.findOwner(rawToken, type)
    if (owner === null) return null

    return db.transaction(async (trx) => {
      const user = await User.query({ client: trx }).where('id', owner).forUpdate().first()
      if (!user || !user.isActive) return null

      const record = await this.tokens.consume(rawToken, type, trx)
      if (!record || record.userId !== user.id) return null

      user.password = password
      await user.save()
      await this.tokens.revokeOpen(user.id, trx)
      await revokeRememberMeTokens(user.id, trx)
      return user
    })
  }
}
