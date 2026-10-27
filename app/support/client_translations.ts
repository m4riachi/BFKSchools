import app from '@adonisjs/core/services/app'
import i18nManager from '@adonisjs/i18n/services/main'

/**
 * Namespaces never sent to the browser (server-only messages).
 */
const SERVER_ONLY_PREFIXES = ['validator.', 'emails.']

const cache = new Map<string, Record<string, string>>()

/**
 * Flat ICU messages for `locale` (with the fallback locale underneath),
 * shared with Inertia pages and formatted client-side with intl-messageformat.
 * Cached in production only.
 */
export function clientTranslations(locale: string): Record<string, string> {
  const cached = cache.get(locale)
  if (cached) return cached

  const fallback = i18nManager.getFallbackLocaleFor(locale)
  const merged = {
    ...(fallback && fallback !== locale ? i18nManager.getTranslationsFor(fallback) : {}),
    ...i18nManager.getTranslationsFor(locale),
  }

  const messages: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (!SERVER_ONLY_PREFIXES.some((prefix) => key.startsWith(prefix))) messages[key] = value
  }

  if (app.inProduction) cache.set(locale, messages)
  return messages
}
