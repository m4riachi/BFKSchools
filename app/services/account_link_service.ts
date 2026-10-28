import { inject } from '@adonisjs/core'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import User from '#models/user'
import Clock from '#services/clock'
import UserTokenService from '#services/user_token_service'
import { revokeRememberMeTokens } from '#services/account_security_service'
import AccountLinkMail from '#mails/account_link_mail'
import BusinessRuleException from '#exceptions/business_rule_exception'
import type { UserTokenType } from '#enums/user_tokens'
import { maskEmail } from '#app/mail/log_transport'

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
   * Sends (or re-sends) an invitation to a parent who has no password yet.
   * Any previous invitation link stops working.
   *
   * @throws BusinessRuleException when the parent is inactive or already has
   * access, or when the email cannot be sent.
   */
  async invite(parent: User, sentBy: User) {
    if (parent.role !== 'parent') throw new BusinessRuleException('families.errors.not_a_parent')
    if (!parent.isActive) throw new BusinessRuleException('families.errors.invite_inactive')
    if (parent.password) throw new BusinessRuleException('families.errors.already_has_access')

    const { token, record } = await db.transaction(async (trx) => {
      parent.useTransaction(trx)
      const issued = await this.tokens.issue(parent, 'invitation', { trx, createdBy: sentBy.id })
      parent.invitedAt = this.clock.now()
      await parent.save()
      return issued
    })

    try {
      await mail.send(
        new AccountLinkMail('invitation', parent, linkUrl('invitation', token), record.expiresAt)
      )
    } catch (error) {
      logger.error({ err: error, to: maskEmail(parent.email) }, 'invitation email failed')
      throw new BusinessRuleException('families.errors.invitation_email_failed')
    }
    return record
  }

  /**
   * "Forgot password". Always resolves the same way, whether or not the
   * email belongs to an account (no user enumeration). For an active
   * account, issues a reset token and queues the email in memory
   * (`sendLater`), so the response does not wait for SMTP either.
   */
  async requestPasswordReset(email: string, ip: string | null) {
    const user = await User.findByEmail(email)
    if (!user || !user.isActive) return

    const { token, record } = await db.transaction(async (trx) => {
      return this.tokens.issue(user, 'password_reset', { trx, ip })
    })

    try {
      await mail.sendLater(
        new AccountLinkMail(
          'password_reset',
          user,
          linkUrl('password_reset', token),
          record.expiresAt
        )
      )
    } catch (error) {
      logger.error({ err: error, to: maskEmail(user.email) }, 'password reset email failed')
    }
  }

  /**
   * Sets the password from an invitation or reset link. Consumes the token,
   * revokes the user's other open links and ends every existing login
   * (credentials version bump + remember-me tokens). Returns null when the
   * link is not usable.
   */
  async setPassword(type: UserTokenType, rawToken: string, password: string): Promise<User | null> {
    return db.transaction(async (trx) => {
      const record = await this.tokens.consume(rawToken, type, trx)
      if (!record) return null

      const user = await User.query({ client: trx }).where('id', record.userId).forUpdate().first()
      if (!user || !user.isActive) return null

      user.password = password
      await user.save()
      await this.tokens.revokeOpen(user.id, trx)
      await revokeRememberMeTokens(user.id, trx)
      return user
    })
  }
}
