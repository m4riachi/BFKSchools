import type User from '#models/user'
import type { AppLocale } from '#enums/locales'
import { appUrl, BrandedMail, type EmailContent } from '#mails/branded_mail'

export type OrderNoticeContent = EmailContent

/**
 * Order-related notices queued in the outbox (Phase 6): deadline reminder,
 * holiday cancellation, menu change, order changed by staff (single or
 * bulk). The content is built by the outbox registry when sending (from
 * ids in the payload, in the parent's language); this class renders it
 * with the shared branded layout.
 */
export default class OrderNoticeMail extends BrandedMail {
  constructor(
    readonly user: Pick<User, 'email' | 'fullName'>,
    readonly locale: AppLocale,
    readonly content: OrderNoticeContent
  ) {
    super()
  }

  get recipientEmail() {
    return this.user.email
  }

  get mailLocale() {
    return this.locale
  }

  /** Absolute link of the button (the parent portal page of the notice). */
  get url() {
    return appUrl(this.content.action?.path ?? '/')
  }

  buildContent(): EmailContent {
    return this.content
  }
}
