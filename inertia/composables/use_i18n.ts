import { computed } from 'vue'
import { usePage } from '@inertiajs/vue3'
import { IntlMessageFormat } from 'intl-messageformat'

/**
 * Client-side translations. The server shares the flat ICU messages of the
 * current locale (`messages`) and the locale itself on every Inertia page;
 * strings are formatted with intl-messageformat (same ICU syntax as the
 * server's @adonisjs/i18n). Unknown keys render the key itself, so missing
 * translations are easy to spot.
 */
const formatters = new Map<string, { message: string; formatter: IntlMessageFormat }>()

export function useI18n() {
  const page = usePage()
  const locale = computed(() => page.props.locale ?? 'fr')

  function t(key: string, values?: Record<string, string | number | boolean | Date>): string {
    const message = page.props.messages?.[key]
    if (message === undefined) return key

    const cacheKey = `${locale.value}:${key}`
    let entry = formatters.get(cacheKey)
    if (!entry || entry.message !== message) {
      entry = { message, formatter: new IntlMessageFormat(message, locale.value) }
      formatters.set(cacheKey, entry)
    }
    return String(entry.formatter.format(values))
  }

  /**
   * Formats a 'YYYY-MM-DD' business day for display (no time-zone shift:
   * the date is interpreted at noon UTC and formatted in UTC).
   */
  function formatDate(iso: string, options: Intl.DateTimeFormatOptions = { dateStyle: 'long' }) {
    const date = new Date(`${iso}T12:00:00Z`)
    return new Intl.DateTimeFormat(locale.value, { ...options, timeZone: 'UTC' }).format(date)
  }

  return { t, locale, formatDate }
}
