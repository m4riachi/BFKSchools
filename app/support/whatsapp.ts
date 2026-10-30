/** Morocco: a number written 06… or 07… belongs here. */
const DEFAULT_COUNTRY_CODE = '212'

/**
 * Digits as wa.me expects them (country code, no + or 00), or null when this
 * cannot be a WhatsApp number. Parents' phones are often stored the local way.
 */
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null
  const compact = phone.replace(/[ ().-]/g, '')
  const number = compact.startsWith('+')
    ? compact.slice(1)
    : compact.startsWith('00')
      ? compact.slice(2)
      : compact.startsWith('0')
        ? `${DEFAULT_COUNTRY_CODE}${compact.slice(1)}`
        : compact
  return /^[1-9]\d{7,14}$/.test(number) ? number : null
}
