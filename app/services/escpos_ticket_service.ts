import i18nManager from '@adonisjs/i18n/services/main'
import { DateTime } from 'luxon'
import type { TicketRow } from '#services/production_report_service'
import { mealName } from '#support/meal_display'
import { formatMad, type Locale } from '#support/money'
import { cleanText } from '#support/pdf_text'

/**
 * D50: the day's order tickets as ESC/POS bytes for an 80 mm thermal
 * receipt printer (Rongta RP332A and any Epson-compatible printer): one
 * receipt per order — child, parent, main dish, supplements with quantity
 * and (when allowed) amounts and total — cut after each one. Text goes out
 * in code page PC858 (French accents, €); characters outside it print as
 * "?" (the printer cannot shape Arabic, so Arabic names are shown as "?").
 */
const ESC = 0x1b
const GS = 0x1d
const LF = 0x0a
/** Characters per line in font A on 80 mm paper (Rongta: 48). */
export const COLUMNS = 48

/** CP858 bytes of the Latin characters the app meets (NFC form). */
const CP858: Record<string, number> = {
  'Ç': 0x80,
  'ü': 0x81,
  'é': 0x82,
  'â': 0x83,
  'ä': 0x84,
  'à': 0x85,
  'å': 0x86,
  'ç': 0x87,
  'ê': 0x88,
  'ë': 0x89,
  'è': 0x8a,
  'ï': 0x8b,
  'î': 0x8c,
  'ì': 0x8d,
  'Ä': 0x8e,
  'Å': 0x8f,
  'É': 0x90,
  'æ': 0x91,
  'Æ': 0x92,
  'ô': 0x93,
  'ö': 0x94,
  'ò': 0x95,
  'û': 0x96,
  'ù': 0x97,
  'ÿ': 0x98,
  'Ö': 0x99,
  'Ü': 0x9a,
  'ø': 0x9b,
  '£': 0x9c,
  'Ø': 0x9d,
  '×': 0x9e,
  'ƒ': 0x9f,
  'á': 0xa0,
  'í': 0xa1,
  'ó': 0xa2,
  'ú': 0xa3,
  'ñ': 0xa4,
  'Ñ': 0xa5,
  'ª': 0xa6,
  'º': 0xa7,
  '¿': 0xa8,
  '®': 0xa9,
  '¬': 0xaa,
  '½': 0xab,
  '¼': 0xac,
  '¡': 0xad,
  '«': 0xae,
  '»': 0xaf,
  'Á': 0xb5,
  'Â': 0xb6,
  'À': 0xb7,
  '©': 0xb8,
  '¢': 0xbd,
  '¥': 0xbe,
  'ã': 0xc6,
  'Ã': 0xc7,
  '¤': 0xcf,
  'ð': 0xd0,
  'Ð': 0xd1,
  'Ê': 0xd2,
  'Ë': 0xd3,
  'È': 0xd4,
  '€': 0xd5,
  'Í': 0xd6,
  'Î': 0xd7,
  'Ï': 0xd8,
  '¦': 0xdd,
  'Ì': 0xde,
  'Ó': 0xe0,
  'ß': 0xe1,
  'Ô': 0xe2,
  'Ò': 0xe3,
  'õ': 0xe4,
  'Õ': 0xe5,
  'µ': 0xe6,
  'þ': 0xe7,
  'Þ': 0xe8,
  'Ú': 0xe9,
  'Û': 0xea,
  'Ù': 0xeb,
  'ý': 0xec,
  'Ý': 0xed,
  '¯': 0xee,
  '´': 0xef,
  '±': 0xf1,
  '¾': 0xf3,
  '¶': 0xf4,
  '§': 0xf5,
  '÷': 0xf6,
  '¸': 0xf7,
  '°': 0xf8,
  '¨': 0xf9,
  '·': 0xfa,
  '¹': 0xfb,
  '³': 0xfc,
  '²': 0xfd,
  ' ': 0x20,
}
/** Multi-byte replacements the code page lacks. */
const FALLBACKS: Record<string, string> = {
  'œ': 'oe',
  'Œ': 'OE',
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '★': '*',
}

/** Text as CP858 bytes; anything the printer cannot show becomes "?". */
export function encodeCp858(text: string): Buffer {
  const bytes: number[] = []
  for (const char of text.normalize('NFC')) {
    const code = char.codePointAt(0)!
    if (code < 0x80) bytes.push(code)
    else if (CP858[char] !== undefined) bytes.push(CP858[char])
    else if (FALLBACKS[char] !== undefined) bytes.push(...Buffer.from(FALLBACKS[char], 'ascii'))
    else bytes.push(0x3f)
  }
  return Buffer.from(bytes)
}

/** `left` and `right` on one line of `width` columns (left is truncated if needed). */
export function twoColumns(left: string, right: string, width = COLUMNS): string {
  const room = Math.max(0, width - right.length - 1)
  const head =
    [...left].length > room ? `${[...left].slice(0, Math.max(0, room - 1)).join('')}…` : left
  return `${head}${' '.repeat(Math.max(1, width - [...head].length - right.length))}${right}`
}

export default class EscPosTicketService {
  render(tickets: TicketRow[], options: { locale: string; withAmounts: boolean }): Buffer {
    const i18n = i18nManager.locale(options.locale)
    const money = (cents: number) => formatMad(cents, options.locale as Locale)
    const parts: Buffer[] = []
    const raw = (...bytes: number[]) => parts.push(Buffer.from(bytes))
    const line = (text = '') => {
      parts.push(encodeCp858(cleanText(text)))
      raw(LF)
    }
    const align = (mode: 0 | 1 | 2) => raw(ESC, 0x61, mode)
    const bold = (on: boolean) => raw(ESC, 0x45, on ? 1 : 0)
    const size = (mode: 0x00 | 0x10 | 0x11) => raw(GS, 0x21, mode)

    for (const ticket of tickets) {
      raw(ESC, 0x40) // initialise
      raw(ESC, 0x74, 19) // code page PC858
      align(1)
      bold(true)
      line('Beldi Fusion Kitchen')
      bold(false)
      line(
        DateTime.fromISO(ticket.date, { zone: 'utc' })
          .setLocale(options.locale)
          .toFormat('cccc d LLLL yyyy')
      )
      line('-'.repeat(COLUMNS))
      size(0x11)
      bold(true)
      line(`${ticket.firstName} ${ticket.lastName}`.trim())
      bold(false)
      size(0x00)
      line(i18n.t('reports.tickets.pdf_parent', { name: ticket.parentName }))
      line('-'.repeat(COLUMNS))
      align(0)
      for (const item of ticket.lines) {
        const isMain = item.mealType === 'subscription'
        const name = mealName(item, options.locale)
        if (isMain) {
          size(0x10)
          bold(true)
          line(name)
          bold(false)
          size(0x00)
          continue
        }
        const label = `+ ${name}${item.quantity > 1 ? ` x${item.quantity}` : ''}`
        line(options.withAmounts ? twoColumns(label, money(item.lineTotalCents)) : label)
      }
      if (options.withAmounts && ticket.supplementsCents > 0) {
        line('-'.repeat(COLUMNS))
        bold(true)
        line(
          twoColumns(
            i18n.t('reports.tickets.pdf_total', { amount: '' }).replace(/\s*:?\s*$/, ''),
            money(ticket.supplementsCents)
          )
        )
        bold(false)
      }
      align(2)
      line(`#${ticket.orderId}`)
      align(0)
      raw(ESC, 0x64, 3) // feed 3 lines
      raw(GS, 0x56, 66, 0) // partial cut
    }
    return Buffer.concat(parts)
  }
}
