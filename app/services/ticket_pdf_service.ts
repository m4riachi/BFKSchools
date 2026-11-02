import i18nManager from '@adonisjs/i18n/services/main'
import { DateTime } from 'luxon'
import type { TicketRow } from '#services/production_report_service'
import { MAX_LABELS_PER_PDF } from '#services/label_pdf_service'
import { mealName } from '#support/meal_display'
import { formatMad, type Locale } from '#support/money'
import { cleanText, createPdf, drawLine, yieldToLoop, type Doc } from '#support/pdf_text'

/**
 * D49: order tickets to hand out with the trays, one per active order of
 * the day: child, parent, the main dish, the supplements with their
 * quantity and, for staff allowed to see prices, the amounts and the
 * supplements' total. Two layouts:
 * - `a4`: a sheet of `cols × 4` tickets (3 or 4 per row), cut along the guides;
 * - `roll`: one ticket per page, 80 mm wide (72 mm printable), for a thermal
 *   receipt printer (e.g. Rongta RP332A) through its printer driver — each
 *   page comes out as one receipt, cut by the printer.
 * Same engine and limits as the labels (LabelPdfService): pdfkit, Noto
 * fonts, capped count, chunked rendering.
 */
export const TICKET_COLUMNS = [3, 4] as const
export type TicketColumns = (typeof TICKET_COLUMNS)[number]
export const TICKET_FORMATS = ['a4', 'roll'] as const
export type TicketFormat = (typeof TICKET_FORMATS)[number]

const A4 = { width: 595.28, height: 841.89 }
const ROWS_PER_PAGE = 4
const TICKETS_PER_CHUNK = 48
/** 80 mm receipt roll: 72 mm printable, 4 mm margins (1 mm = 2.835 pt). */
const ROLL = { width: 80 * 2.835, margin: 4 * 2.835, tail: 10 * 2.835 }

const COLORS = {
  ink: '#14211B',
  muted: '#56655E',
  line: '#C9D2CD',
  brand: '#1F6F4A',
  soft: '#EEF6F1',
}

export default class TicketPdfService {
  async render(
    tickets: TicketRow[],
    options: {
      format: TicketFormat
      cols: TicketColumns
      locale: string
      title: string
      withAmounts: boolean
    }
  ): Promise<Buffer> {
    if (tickets.length > MAX_LABELS_PER_PDF) {
      throw new RangeError(`Too many tickets (${tickets.length} > ${MAX_LABELS_PER_PDF})`)
    }
    const { doc, done } = await createPdf({
      size: 'A4',
      margin: 0,
      autoFirstPage: false,
      info: { Title: cleanText(options.title), Creator: 'British Academy × Beldi Fusion' },
    })
    const i18n = i18nManager.locale(options.locale)
    if (!tickets.length) doc.addPage()
    if (options.format === 'roll') {
      for (const [index, ticket] of tickets.entries()) {
        if (index > 0 && index % TICKETS_PER_CHUNK === 0) await yieldToLoop()
        const width = ROLL.width - ROLL.margin * 2
        const height = this.contentHeight(ticket, width, options) + ROLL.tail
        // One page per ticket: the receipt printer cuts between pages.
        doc.addPage({ size: [ROLL.width, height + ROLL.margin], margin: 0 })
        this.drawTicket(
          doc,
          ticket,
          { x: ROLL.margin, y: 0, width, height, guide: false },
          options,
          i18n
        )
      }
    } else {
      const cols = TICKET_COLUMNS.includes(options.cols) ? options.cols : 3
      const perPage = cols * ROWS_PER_PAGE
      const width = A4.width / cols
      const height = A4.height / ROWS_PER_PAGE
      for (const [index, ticket] of tickets.entries()) {
        // pdfkit is synchronous: let other requests run between chunks.
        if (index > 0 && index % TICKETS_PER_CHUNK === 0) await yieldToLoop()
        const slot = index % perPage
        if (slot === 0) doc.addPage()
        const x = (slot % cols) * width
        const y = Math.floor(slot / cols) * height
        this.drawTicket(doc, ticket, { x, y, width, height, guide: true }, options, i18n)
      }
    }
    doc.end()
    return done
  }

  /** Height a ticket needs at `width` (roll layout: the page grows with the content). */
  protected contentHeight(
    ticket: TicketRow,
    width: number,
    options: { withAmounts: boolean }
  ): number {
    const scale = Math.min(1, width / 198)
    const size = (base: number) => Math.max(6, base * scale)
    const pad = 9
    let height = size(9) + 8 + 6 // band
    height += size(12) * 1.3 // name
    height += size(7.5) * 1.6 // parent
    height += 5 // divider
    for (const line of ticket.lines) {
      height += size(line.mealType === 'subscription' ? 9.5 : 8.5) * 1.35
    }
    if (options.withAmounts && ticket.supplementsCents > 0) height += size(9) + 8 + 6
    height += size(6) + pad * 2 // order number + padding
    return height
  }

  protected drawTicket(
    doc: Doc,
    ticket: TicketRow,
    box: { x: number; y: number; width: number; height: number; guide: boolean },
    options: { locale: string; withAmounts: boolean },
    i18n: ReturnType<typeof i18nManager.locale>
  ) {
    const { locale } = options
    const money = (cents: number) => formatMad(cents, locale as Locale)
    const pad = 9
    const inner = { x: box.x + pad, width: box.width - pad * 2, bottom: box.y + box.height - pad }
    const scale = Math.min(1, box.width / 198)
    const size = (base: number) => Math.max(6, base * scale)

    doc.save()
    doc.rect(box.x, box.y, box.width, box.height).clip()
    if (box.guide) {
      // Cut guide.
      doc
        .lineWidth(0.3)
        .strokeColor(COLORS.line)
        .rect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1)
        .stroke()
    }

    // Header band: restaurant and day.
    const bandHeight = size(9) + 8
    doc.rect(box.x, box.y, box.width, bandHeight).fill(COLORS.brand)
    const date = DateTime.fromISO(ticket.date, { zone: 'utc' })
      .setLocale(locale)
      .toFormat('ccc d LLL yyyy')
    drawLine(doc, 'Beldi Fusion Kitchen', inner.x, box.y + 4, inner.width * 0.55, {
      bold: true,
      size: size(8),
      color: '#FFFFFF',
    })
    drawLine(doc, date, inner.x, box.y + 4, inner.width, {
      size: size(8),
      color: '#FFFFFF',
      align: 'right',
    })

    let cursor = box.y + bandHeight + 6
    const name = `${cleanText(ticket.firstName)} ${cleanText(ticket.lastName)}`.trim()
    const nameSize = size(12)
    drawLine(doc, name, inner.x, cursor, inner.width, { bold: true, size: nameSize })
    cursor += nameSize * 1.3

    const metaSize = size(7.5)
    drawLine(
      doc,
      i18n.t('reports.tickets.pdf_parent', { name: cleanText(ticket.parentName) }),
      inner.x,
      cursor,
      inner.width,
      { size: metaSize, color: COLORS.muted }
    )
    cursor += metaSize * 1.6

    doc
      .lineWidth(0.5)
      .strokeColor(COLORS.line)
      .moveTo(inner.x, cursor)
      .lineTo(inner.x + inner.width, cursor)
      .stroke()
    cursor += 5

    // Footer first (total), so the lines know how much room is left.
    let bottom = inner.bottom
    const showAmounts = options.withAmounts
    if (showAmounts && ticket.supplementsCents > 0) {
      const totalSize = size(9)
      const footY = bottom - totalSize - 4
      doc.rect(inner.x, footY - 2, inner.width, totalSize + 8).fill(COLORS.soft)
      drawLine(
        doc,
        i18n.t('reports.tickets.pdf_total', { amount: money(ticket.supplementsCents) }),
        inner.x + 4,
        footY + 1,
        inner.width - 8,
        { bold: true, size: totalSize, color: COLORS.brand, align: 'right' }
      )
      bottom = footY - 6
    }
    const idSize = size(6)
    drawLine(doc, `#${ticket.orderId}`, inner.x, inner.bottom - idSize, inner.width * 0.3, {
      size: idSize,
      color: COLORS.muted,
    })

    const amountWidth = showAmounts ? inner.width * 0.3 : 0
    for (const line of ticket.lines) {
      const isMain = line.mealType === 'subscription'
      const lineSize = size(isMain ? 9.5 : 8.5)
      if (cursor + lineSize > bottom) break
      const text = isMain
        ? mealName(line, locale)
        : `+ ${mealName(line, locale)}${line.quantity > 1 ? ` ×${line.quantity}` : ''}`
      drawLine(doc, text, inner.x, cursor, inner.width - amountWidth - 4, {
        bold: isMain,
        size: lineSize,
        color: COLORS.ink,
      })
      if (showAmounts && !isMain) {
        drawLine(
          doc,
          money(line.lineTotalCents),
          inner.x + inner.width - amountWidth,
          cursor,
          amountWidth,
          {
            size: lineSize,
            color: COLORS.muted,
            align: 'right',
          }
        )
      }
      cursor += lineSize * 1.35
    }
    doc.restore()
  }
}
