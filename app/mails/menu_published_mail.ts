import i18nManager from '@adonisjs/i18n/services/main'
import type User from '#models/user'
import type WeeklyMenu from '#models/weekly_menu'
import type School from '#models/school'
import type { AppLocale } from '#enums/locales'
import { appUrl, BrandedMail, type EmailContent } from '#mails/branded_mail'
import { instantLabel, schoolZone, weekRangeLabel } from '#support/menu_display'

/**
 * "The menu of the week is published" (brief §5.4), queued in the outbox by
 * MenuPublicationService and sent by `mail:dispatch`. The button opens the
 * parent portal on that week. Parents can turn this email off (notification
 * center); the footer links to the preferences.
 */
export default class MenuPublishedMail extends BrandedMail {
  constructor(
    readonly user: Pick<User, 'email' | 'fullName'>,
    readonly locale: AppLocale,
    readonly menu: WeeklyMenu,
    readonly school: School
  ) {
    super()
  }

  get recipientEmail() {
    return this.user.email
  }

  get mailLocale() {
    return this.locale
  }

  get path() {
    return `/?week=${this.menu.weekStart}`
  }

  get url() {
    return appUrl(this.path)
  }

  buildContent(): EmailContent {
    const i18n = i18nManager.locale(this.locale)
    const week = weekRangeLabel(this.menu.weekStart, this.school.schoolDays, this.locale)
    const deadline = this.menu.orderDeadlineAt
      ? instantLabel(this.menu.orderDeadlineAt, this.locale, schoolZone(this.school))
      : null
    return {
      subject: i18n.t('emails.menu_published.subject', { week }),
      title: i18n.t('emails.menu_published.title', { week }),
      greeting: i18n.t('emails.greeting', { name: this.user.fullName }),
      paragraphs: [
        i18n.t('emails.menu_published.intro', { week }),
        ...(deadline ? [i18n.t('emails.menu_published.deadline', { date: deadline })] : []),
      ],
      action: { label: i18n.t('emails.menu_published.action'), path: this.path },
      footer: i18n.t('emails.menu_published.footer'),
      preferences: true,
    }
  }
}
