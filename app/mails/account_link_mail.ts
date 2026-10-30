import i18nManager from '@adonisjs/i18n/services/main'
import type { DateTime } from 'luxon'
import type User from '#models/user'
import { BrandedMail, type EmailContent } from '#mails/branded_mail'
import { APP_TIMEZONE } from '#support/time'

export type AccountLinkKind = 'invitation' | 'password_reset'

/**
 * Invitation and password-reset emails (shared branded layout). Sent in
 * the recipient's language to their stored, validated address.
 *
 * The link carries the raw token: these mails are sent directly, never
 * stored in the outbox (D16).
 */
export default class AccountLinkMail extends BrandedMail {
  constructor(
    readonly kind: AccountLinkKind,
    readonly user: User,
    readonly url: string,
    readonly expiresAt: DateTime
  ) {
    super()
  }

  get recipientEmail() {
    return this.user.email
  }

  get mailLocale() {
    return this.user.locale
  }

  buildContent(): EmailContent {
    const locale = this.user.locale
    const i18n = i18nManager.locale(locale)
    const prefix = `emails.${this.kind}`
    // D42: a staff member has no children to feed.
    const forStaff = this.kind === 'invitation' && this.user.role !== 'parent'
    const expires = this.expiresAt
      .setZone(APP_TIMEZONE)
      .setLocale(locale)
      .toLocaleString({ dateStyle: 'full', timeStyle: 'short' })
    return {
      subject: i18n.t(`${prefix}.subject`),
      title: i18n.t(`${prefix}.title`),
      greeting: i18n.t('emails.greeting', { name: this.user.fullName }),
      paragraphs: [i18n.t(`${prefix}.${forStaff ? 'intro_staff' : 'intro'}`)],
      action: { label: i18n.t(`${prefix}.action`), path: this.url },
      notes: [i18n.t(`${prefix}.expiry`, { date: expires }), i18n.t(`${prefix}.ignore`)],
      footer: i18n.t(`${prefix}.${forStaff ? 'footer_staff' : 'footer'}`),
    }
  }
}
