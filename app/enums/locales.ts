/**
 * Mirrors the CHECK constraint on `users.locale`. The back-office defaults to French.
 */
export const LOCALES = ['fr', 'en'] as const
export type AppLocale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: AppLocale = 'fr'

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}
