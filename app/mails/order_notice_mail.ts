import { BaseMail } from '@adonisjs/mail'
import env from '#start/env'
import type User from '#models/user'
import { isSafeEmail } from '#validators/rules'
import type { AppLocale } from '#enums/locales'

export type OrderNoticeContent = {
  subject: string
  title: string
  greeting: string
  paragraphs: string[]
  action: string
  fallback: string
  signature: string
  footer: string | null
  /** Path in the app the button opens (default: the parent portal). */
  path?: string
}

/**
 * Order-related notices queued in the outbox (Phase 6): deadline reminder,
 * holiday cancellation, menu change, order changed by staff. The text is
 * built by the outbox registry when sending (from ids in the payload, in
 * the parent's language); this class only renders it with the shared
 * notification template. Final templates are polished in Phase 8.
 */
export default class OrderNoticeMail extends BaseMail {
  constructor(
    readonly user: Pick<User, 'email' | 'fullName'>,
    readonly locale: AppLocale,
    readonly content: OrderNoticeContent
  ) {
    super()
  }

  get url() {
    return new URL(this.content.path ?? '/', env.get('APP_URL')).toString()
  }

  prepare() {
    if (!isSafeEmail(this.user.email)) {
      throw new Error('Refusing to send to an address that is not a plain validated email')
    }
    const data = {
      locale: this.locale,
      title: this.content.title,
      greeting: this.content.greeting,
      paragraphs: this.content.paragraphs,
      url: this.url,
      action: this.content.action,
      fallback: this.content.fallback,
      signature: this.content.signature,
      footer: this.content.footer,
    }
    this.message
      .to(this.user.email)
      .subject(this.content.subject)
      .htmlView('emails/notification_html', data)
      .textView('emails/notification_text', data)
  }
}
