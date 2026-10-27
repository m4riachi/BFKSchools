/**
 * Money is stored as integer centimes (`*_cents` columns): 12.50 MAD = 1250.
 * These helpers never use floating point arithmetic.
 */

export type Locale = 'fr' | 'en'

function groupThousands(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
}

/**
 * Formats centimes as MAD: fr → "1 234,50 MAD", en → "1,234.50 MAD".
 */
export function formatMad(cents: number, locale: Locale = 'fr'): string {
  if (!Number.isSafeInteger(cents)) throw new TypeError(`Invalid amount in centimes: ${cents}`)

  const negative = cents < 0
  const digits = String(Math.abs(cents)).padStart(3, '0')
  const whole = digits.slice(0, -2)
  const fraction = digits.slice(-2)

  const [group, decimal] = locale === 'fr' ? ['\u202F', ','] : [',', '.']
  return `${negative ? '-' : ''}${groupThousands(whole, group)}${decimal}${fraction} MAD`
}

/**
 * Parses an amount typed by staff ("12", "12,5", "12.50", "1 234,50") into
 * centimes. Returns null when the input is not a valid non-negative amount
 * with at most 2 decimals.
 */
export function parseMadToCents(input: string): number | null {
  const normalized = input.replace(/[\s\u00A0\u202F]/g, '').replace(',', '.')
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(normalized)
  if (!match) return null

  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}
