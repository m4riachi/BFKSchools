import { BaseMail } from '@adonisjs/mail'
import i18nManager from '@adonisjs/i18n/services/main'
import env from '#start/env'
import type User from '#models/user'
import type WeeklyMenu from '#models/weekly_menu'
import type School from '#models/school'
import { isSafeEmail } from '#validators/rules'
import type { AppLocale } from '#enums/locales'
import { instantLabel, schoolZone, weekRangeLabel } from '#support/menu_display'

/**
 * "The menu of the week is published" (brief §5.4), queued in the outbox by
 * MenuPublicationService and sent by `mail:dispatch`. Sent in the parent's
 * language to their stored, validated address (bare string, no display
 * name — see app/validators/rules.ts). The final template set (shared layout)
 * is polished in Phase 8.
 */
export default class MenuPublishedMail extends BaseMail {
  constructor(
    readonly user: Pick<User, 'email' | 'fullName'>,
    readonly locale: AppLocale,
    readonly menu: WeeklyMenu,
    readonly school: School
  ) {
    super()
  }

  get url() {
    return new URL('/', env.get('APP_URL')).toString()
  }

  prepare() {
    if (!isSafeEmail(this.user.email)) {
      throw new Error('Refusing to send to an address that is not a plain validated email')
    }
    const i18n = i18nManager.locale(this.locale)
    const week = weekRangeLabel(this.menu.weekStart, this.school.schoolDays, this.locale)
    const deadline = this.menu.orderDeadlineAt
      ? instantLabel(this.menu.orderDeadlineAt, this.locale, schoolZone(this.school))
      : null

    const data = {
      locale: this.locale,
      title: i18n.t('emails.menu_published.title', { week }),
      greeting: i18n.t('emails.greeting', { name: this.user.fullName }),
      paragraphs: [
        i18n.t('emails.menu_published.intro', { week }),
        ...(deadline ? [i18n.t('emails.menu_published.deadline', { date: deadline })] : []),
      ],
      url: this.url,
      action: i18n.t('emails.menu_published.action'),
      fallback: i18n.t('emails.link_fallback'),
      signature: i18n.t('emails.signature'),
      footer: i18n.t('emails.menu_published.footer'),
    }

    this.message
      .to(this.user.email)
      .subject(i18n.t('emails.menu_published.subject', { week }))
      .htmlView('emails/notification_html', data)
      .textView('emails/notification_text', data)
  }
}
