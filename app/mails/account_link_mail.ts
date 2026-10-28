import { BaseMail } from '@adonisjs/mail'
import i18nManager from '@adonisjs/i18n/services/main'
import type { DateTime } from 'luxon'
import type User from '#models/user'
import { isSafeEmail } from '#validators/rules'
import { APP_TIMEZONE } from '#support/time'

export type AccountLinkKind = 'invitation' | 'password_reset'

/**
 * Invitation and password-reset emails (one class, two templates). Sent in
 * the recipient's language. The recipient is the stored, validated address
 * passed as a bare string — never a display name built from user input
 * (nodemailer advisory, see app/validators/rules.ts).
 *
 * The link carries the raw token: these mails are sent directly, never
 * stored in the outbox (D16).
 */
export default class AccountLinkMail extends BaseMail {
  constructor(
    readonly kind: AccountLinkKind,
    readonly user: User,
    readonly url: string,
    readonly expiresAt: DateTime
  ) {
    super()
  }

  prepare() {
    if (!isSafeEmail(this.user.email)) {
      throw new Error('Refusing to send to an address that is not a plain validated email')
    }

    const locale = this.user.locale
    const i18n = i18nManager.locale(locale)
    const prefix = `emails.${this.kind}`
    const expires = this.expiresAt
      .setZone(APP_TIMEZONE)
      .setLocale(locale)
      .toLocaleString({ dateStyle: 'full', timeStyle: 'short' })

    const data = {
      locale,
      url: this.url,
      title: i18n.t(`${prefix}.title`),
      greeting: i18n.t('emails.greeting', { name: this.user.fullName }),
      intro: i18n.t(`${prefix}.intro`),
      action: i18n.t(`${prefix}.action`),
      expiry: i18n.t(`${prefix}.expiry`, { date: expires }),
      ignore: i18n.t(`${prefix}.ignore`),
      fallback: i18n.t('emails.link_fallback'),
      signature: i18n.t('emails.signature'),
    }

    this.message
      .to(this.user.email)
      .subject(i18n.t(`${prefix}.subject`))
      .htmlView('emails/account_link_html', data)
      .textView('emails/account_link_text', data)
  }
}
