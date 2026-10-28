import logger from '@adonisjs/core/services/logger'

type Translator = { t: (key: string, values?: Record<string, unknown>) => string }

/** Generic message shown when a translation can't be formatted. */
export const FALLBACK_ERROR_KEY = 'errors.action_failed'

/**
 * Formats a translation for an **error response** without ever turning a
 * broken message (invalid ICU syntax, bad parameter) into an HTTP 500: on
 * failure the key — never the parameters, which may carry personal data —
 * is logged and the generic `errors.action_failed` message is returned.
 */
export function safeTranslate(
  i18n: Translator,
  key: string,
  values: Record<string, unknown> = {}
): string {
  try {
    return i18n.t(key, values)
  } catch (error) {
    logger.error(
      { key, error: (error as { name?: string }).name ?? 'Error' },
      'i18n: could not format a message; generic fallback used'
    )
    try {
      return i18n.t(FALLBACK_ERROR_KEY)
    } catch {
      return 'Error'
    }
  }
}
