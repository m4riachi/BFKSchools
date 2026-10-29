/**
 * Money is stored as integer centimes (`*_cents` columns): 12.50 MAD = 1250.
 * These helpers never use floating point arithmetic.
 */

export type Locale = 'fr' | 'en'

/** Longest text accepted as an amount ("999 999 999,99" is 14 chars). */
export const MAX_AMOUNT_INPUT_LENGTH = 32

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
  // Length guard first: the trim regex below backtracks on long runs of
  // spaces; no real amount is anywhere near this long.
  if (input.length > MAX_AMOUNT_INPUT_LENGTH) return null
  // Surrounding spaces are ignored; inside the number, a space (also NBSP or
  // narrow NBSP) is only allowed as a thousands separator before groups of
  // exactly 3 digits ("1 234,50"). "12 50", tabs and newlines are refused.
  const trimmed = input.replace(/^[ \u00A0\u202F]+|[ \u00A0\u202F]+$/g, '')
  const match = /^(\d{1,3}(?:[ \u00A0\u202F]\d{3})+|\d+)(?:[.,](\d{1,2}))?$/.exec(trimmed)
  if (!match) return null

  const whole = match[1].replace(/[ \u00A0\u202F]/g, '')
  const cents = Number(whole) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : null
}

/**
 * Centimes as the value of a price input ("12,50" in French, "12.50" in
 * English), the reverse of `parseMadToCents`.
 */
export function centsToInput(cents: number, locale: Locale = 'fr'): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new TypeError(`Invalid amount in centimes: ${cents}`)
  }
  const digits = String(cents).padStart(3, '0')
  return `${digits.slice(0, -2)}${locale === 'fr' ? ',' : '.'}${digits.slice(-2)}`
}
