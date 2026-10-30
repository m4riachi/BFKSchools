import { BaseMail } from '@adonisjs/mail'
import i18nManager from '@adonisjs/i18n/services/main'
import env from '#start/env'
import { isSafeEmail } from '#validators/rules'
import type { AppLocale } from '#enums/locales'

/**
 * Every email of the app shares one branded layout (British Academy × Beldi Fusion ×
 * Britech School): `resources/views/emails/layout_html.edge` (escaped with
 * `{{ }}` only) and `layout_text.edge` (plain-text part). A mail class only
 * builds an `EmailContent` in the recipient's language; the layout adds
 * the header, the button + fallback link, the signature and the footer
 * (with the "email preferences" link for emails a parent can turn off).
 */
export type EmailContent = {
  subject: string
  title: string
  greeting: string
  paragraphs: string[]
  /** Bulleted list (e.g. "Adam — Monday 23 November"). */
  items?: string[]
  /** Main button: label + an app path ("/orders/history") or an absolute link. */
  action?: { label: string; path: string } | null
  /** Small print under the button (link expiry, "ignore this email"…). */
  notes?: string[]
  /** Why the recipient receives this email. */
  footer?: string | null
  /** Shows the "manage email preferences" link (emails a parent can turn off). */
  preferences?: boolean
}

/** Absolute link into the app (APP_URL + path). Absolute URLs are kept as they are. */
export function appUrl(path: string): string {
  return new URL(path, env.get('APP_URL')).toString()
}

/** Path of the parent's email preferences (notification center). */
export const PREFERENCES_PATH = '/notifications#preferences'

/** Everything the layout templates read. */
export function layoutData(content: EmailContent, locale: AppLocale) {
  const i18n = i18nManager.locale(locale)
  const url = content.action ? appUrl(content.action.path) : null
  return {
    locale,
    subject: content.subject,
    preheader: content.paragraphs[0] ?? content.title,
    brand: 'British Academy × Beldi Fusion',
    partner: i18n.t('emails.layout.partner'),
    title: content.title,
    greeting: content.greeting,
    paragraphs: content.paragraphs,
    items: content.items ?? [],
    url,
    action: content.action?.label ?? null,
    fallback: i18n.t('emails.link_fallback'),
    notes: content.notes ?? [],
    signature: i18n.t('emails.signature'),
    footer: content.footer ?? null,
    preferencesUrl: content.preferences ? appUrl(PREFERENCES_PATH) : null,
    preferencesLabel: i18n.t('emails.layout.preferences'),
    automatic: i18n.t('emails.layout.automatic'),
    homeUrl: appUrl('/'),
    logoUrl: appUrl('/logo-bfk.png'),
  }
}

/**
 * Base class: checks the recipient (a stored, validated address passed as
 * a bare string — never a display name built from user input, see
 * app/validators/rules.ts) and renders the shared layout.
 */
export abstract class BrandedMail extends BaseMail {
  abstract get recipientEmail(): string
  abstract get mailLocale(): AppLocale
  abstract buildContent(): EmailContent

  /** The rendered content (after `prepare`), for tests and logs. */
  declare content: EmailContent

  prepare() {
    if (!isSafeEmail(this.recipientEmail)) {
      throw new Error('Refusing to send to an address that is not a plain validated email')
    }
    const content = this.buildContent()
    this.content = content
    const data = layoutData(content, this.mailLocale)
    this.message
      .to(this.recipientEmail)
      .subject(content.subject)
      .htmlView('emails/layout_html', data)
      .textView('emails/layout_text', data)
  }
}
