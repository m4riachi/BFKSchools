import app from '@adonisjs/core/services/app'
import i18nManager from '@adonisjs/i18n/services/main'
import { DateTime } from 'luxon'
import type { FamilyStatement, StatementLine } from '#services/statement_service'
import { formatMad } from '#support/money'
import { mealName } from '#support/meal_display'
import { monthLabel } from '#support/statement_month'
import { cleanText, createPdf, drawLine, yieldToLoop, type Doc } from '#support/pdf_text'
import { APP_TIMEZONE } from '#support/time'

/**
 * Printable monthly statement of a family (brief §5.5): A4 portrait, a
 * branded header, one section per child (subscription meals counted as
 * included — D31, one line per supplement item, child total, daily detail)
 * and the family total (supplements only). Same
 * library and fonts as the labels (pdfkit, `#support/pdf_text`).
 *
 * Bounded by nature (one family, one month: a few children × ~23 days);
 * the render still yields to the event loop every few rows and runs
 * behind `pdfRenderGate` (controller) like every PDF.
 */
const PAGE = { width: 595.28, height: 841.89, margin: 42 }
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2
const FOOTER_SPACE = 34
const ROWS_PER_CHUNK = 40

const COLORS = {
  ink: '#14211B',
  ink2: '#33433C',
  muted: '#56655E',
  line: '#E2E7E4',
  brand: '#1F6F4A',
  brandSoft: '#E6F2EC',
  warning: '#8A4B08',
  warningSoft: '#FFF4E5',
}

type Locale = 'fr' | 'en'
type I18n = ReturnType<typeof i18nManager.locale>

export default class StatementPdfService {
  async render(
    statement: FamilyStatement,
    options: {
      locale: string
      generatedAt: DateTime
      /** D33: Niveau / Classe modules (shown when not given). */
      show?: { grade: boolean; className: boolean }
    }
  ): Promise<Buffer> {
    const locale: Locale = options.locale === 'en' ? 'en' : 'fr'
    const i18n = i18nManager.locale(locale)
    const month = monthLabel(statement.month, locale)
    const title = i18n.t('statements.pdf.title', { month })
    const { doc, done } = await createPdf({
      size: 'A4',
      margin: PAGE.margin,
      bufferPages: true,
      info: {
        Title: cleanText(`${title} — ${statement.parent.fullName}`),
        Creator: 'British Academy × Beldi Fusion',
      },
    })
    const writer = new Writer(doc)

    this.header(writer, statement, { i18n, locale, title, generatedAt: options.generatedAt })

    let rows = 0
    for (const child of statement.children) {
      writer.ensure(80)
      writer.gap(10)
      const name = `${cleanText(child.firstName)} ${cleanText(child.lastName)}`
      const meta = [
        options.show?.grade === false ? null : child.grade,
        options.show?.className === false ? null : child.className,
      ]
        .map((part) => cleanText(part))
        .filter(Boolean)
      writer.band(name, meta.join(' · '), formatMad(child.totalCents, locale))

      // Subscription meals: counted, included (D31 — never priced)
      const sub = child.subscription
      writer.row(
        sub.count
          ? i18n.t('statements.subscription_line', { count: sub.count })
          : i18n.t('statements.no_subscription_meals'),
        '',
        sub.count ? i18n.t('statements.included') : '',
        { muted: true }
      )
      // Supplements, one line per item
      for (const line of child.supplements.lines) {
        writer.row(
          `+ ${line.nameFr && line.nameEn ? mealName({ nameFr: line.nameFr, nameEn: line.nameEn }, locale) : ''} × ${line.quantity}`,
          this.unit(line, locale),
          formatMad(line.amountCents, locale)
        )
      }
      writer.rule()
      writer.row(i18n.t('statements.child_total'), '', formatMad(child.totalCents, locale), {
        bold: true,
      })

      // Daily detail
      if (child.days.length) {
        writer.gap(4)
        writer.caption(i18n.t('statements.daily_detail'))
        for (const day of child.days) {
          const date = DateTime.fromISO(day.date, { zone: 'utc' })
            .setLocale(locale)
            .toFormat('ccc d LLL')
          const meals = day.items
            .map(
              (item) =>
                `${mealName(item, locale)}${item.mealType === 'supplement' && item.quantity > 1 ? ` ×${item.quantity}` : ''}`
            )
            .join(', ')
          writer.detail(
            date,
            meals,
            day.totalCents > 0 ? formatMad(day.totalCents, locale) : i18n.t('statements.included')
          )
          rows += 1
          if (rows % ROWS_PER_CHUNK === 0) await yieldToLoop()
        }
      }
      await yieldToLoop()
    }

    if (!statement.children.length) {
      writer.gap(16)
      writer.paragraph(i18n.t('statements.empty'), COLORS.muted)
    }

    // Family total
    writer.ensure(60)
    writer.gap(14)
    writer.total(i18n.t('statements.family_total'), formatMad(statement.totals.totalCents, locale))
    writer.gap(10)
    if (statement.provisional)
      writer.paragraph(i18n.t('statements.provisional_note'), COLORS.warning)
    writer.paragraph(i18n.t('statements.included_note'), COLORS.muted)
    writer.paragraph(i18n.t('statements.pdf.snapshot_note'), COLORS.muted)

    this.footer(doc, i18n)
    doc.end()
    return done
  }

  protected unit(line: StatementLine, locale: Locale) {
    return `${line.quantity} × ${formatMad(line.unitPriceCents, locale)}`
  }

  protected header(
    writer: Writer,
    statement: FamilyStatement,
    options: { i18n: I18n; locale: Locale; title: string; generatedAt: DateTime }
  ) {
    const { doc } = writer
    const top = PAGE.margin
    doc.image(app.makePath('public/logo-bfk.png'), PAGE.margin, top, { height: 40 })
    drawLine(doc, 'British Academy × Beldi Fusion', PAGE.margin + 74, top + 4, 260, {
      bold: true,
      size: 13,
    })
    drawLine(doc, options.i18n.t('statements.pdf.partner'), PAGE.margin + 74, top + 22, 260, {
      size: 9,
      color: COLORS.muted,
    })
    if (statement.provisional) {
      const label = options.i18n.t('statements.provisional')
      doc.font('bold').fontSize(9)
      const width = doc.widthOfString(label) + 16
      const x = PAGE.width - PAGE.margin - width
      doc.save()
      doc.roundedRect(x, top + 6, width, 20, 10).fill(COLORS.warningSoft)
      doc.restore()
      doc.fillColor(COLORS.warning).text(label, x + 8, top + 11, { lineBreak: false })
    }
    writer.y = top + 58
    drawLine(doc, options.title, PAGE.margin, writer.y, CONTENT_WIDTH, { bold: true, size: 18 })
    writer.y += 26
    drawLine(doc, statement.parent.fullName, PAGE.margin, writer.y, CONTENT_WIDTH, {
      bold: true,
      size: 10.5,
    })
    writer.y += 15
    const generated = options.generatedAt
      .setZone(APP_TIMEZONE)
      .setLocale(options.locale)
      .toLocaleString({ dateStyle: 'long', timeStyle: 'short' })
    drawLine(
      doc,
      `${statement.parent.email} · ${options.i18n.t('statements.pdf.generated', { date: generated })}`,
      PAGE.margin,
      writer.y,
      CONTENT_WIDTH,
      { size: 8.5, color: COLORS.muted }
    )
    writer.y += 20
    writer.rule()
  }

  /** "British Academy × Beldi Fusion · page 1 / 2" on every page (pages are buffered). */
  protected footer(doc: Doc, i18n: I18n) {
    const range = doc.bufferedPageRange()
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index)
      // Writing inside the bottom margin must not add a page.
      const margin = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      drawLine(
        doc,
        i18n.t('statements.pdf.footer', { page: index + 1, pages: range.count }),
        PAGE.margin,
        PAGE.height - PAGE.margin + 14,
        CONTENT_WIDTH,
        { size: 7.5, color: COLORS.muted }
      )
      doc.page.margins.bottom = margin
    }
  }
}

/** Vertical cursor + the row primitives of the statement layout. */
class Writer {
  y = PAGE.margin

  constructor(readonly doc: Doc) {}

  /** Starts a new page when less than `height` points are left. */
  ensure(height: number) {
    if (this.y + height > PAGE.height - PAGE.margin - FOOTER_SPACE) {
      this.doc.addPage()
      this.y = PAGE.margin
    }
  }

  gap(points: number) {
    this.y += points
  }

  rule() {
    this.doc
      .save()
      .lineWidth(0.6)
      .strokeColor(COLORS.line)
      .moveTo(PAGE.margin, this.y)
      .lineTo(PAGE.width - PAGE.margin, this.y)
      .stroke()
      .restore()
    this.y += 6
  }

  band(title: string, meta: string, amount: string) {
    this.ensure(30)
    this.doc.save()
    this.doc.roundedRect(PAGE.margin, this.y, CONTENT_WIDTH, 26, 6).fill(COLORS.brandSoft)
    this.doc.restore()
    drawLine(this.doc, title, PAGE.margin + 10, this.y + 7, CONTENT_WIDTH * 0.45, {
      bold: true,
      size: 11,
    })
    drawLine(this.doc, meta, PAGE.margin + 10 + CONTENT_WIDTH * 0.47, this.y + 9, 140, {
      size: 8.5,
      color: COLORS.muted,
    })
    drawLine(this.doc, amount, PAGE.width - PAGE.margin - 130, this.y + 7, 120, {
      bold: true,
      size: 11,
      align: 'right',
    })
    this.y += 32
  }

  row(
    label: string,
    unit: string,
    amount: string,
    style: { bold?: boolean; muted?: boolean } = {}
  ) {
    this.ensure(16)
    const color = style.muted ? COLORS.muted : COLORS.ink2
    drawLine(this.doc, label, PAGE.margin + 10, this.y, CONTENT_WIDTH * 0.55, {
      bold: style.bold,
      size: 9.5,
      color: style.bold ? COLORS.ink : color,
    })
    if (unit) {
      drawLine(this.doc, unit, PAGE.margin + CONTENT_WIDTH * 0.58, this.y, 110, {
        size: 9,
        color: COLORS.muted,
      })
    }
    drawLine(this.doc, amount, PAGE.width - PAGE.margin - 130, this.y, 120, {
      bold: style.bold,
      size: 9.5,
      color: style.bold ? COLORS.ink : color,
      align: 'right',
    })
    this.y += 15
  }

  caption(text: string) {
    this.ensure(14)
    drawLine(this.doc, text.toLocaleUpperCase(), PAGE.margin + 10, this.y, CONTENT_WIDTH, {
      bold: true,
      size: 7.5,
      color: COLORS.muted,
    })
    this.y += 12
  }

  detail(date: string, meals: string, amount: string) {
    this.ensure(13)
    drawLine(this.doc, date, PAGE.margin + 10, this.y, 70, { size: 8, color: COLORS.muted })
    drawLine(this.doc, meals, PAGE.margin + 84, this.y, CONTENT_WIDTH - 84 - 140, {
      size: 8,
      color: COLORS.ink2,
    })
    drawLine(this.doc, amount, PAGE.width - PAGE.margin - 130, this.y, 120, {
      size: 8,
      color: COLORS.ink2,
      align: 'right',
    })
    this.y += 12
  }

  total(label: string, amount: string) {
    this.ensure(36)
    this.doc.save()
    this.doc.roundedRect(PAGE.margin, this.y, CONTENT_WIDTH, 32, 8).fill(COLORS.brand)
    this.doc.restore()
    drawLine(this.doc, label, PAGE.margin + 12, this.y + 9, CONTENT_WIDTH * 0.6, {
      bold: true,
      size: 12,
      color: '#FFFFFF',
    })
    drawLine(this.doc, amount, PAGE.width - PAGE.margin - 172, this.y + 9, 160, {
      bold: true,
      size: 12,
      color: '#FFFFFF',
      align: 'right',
    })
    this.y += 40
  }

  /** Wrapped paragraph (Latin text; names never go here). */
  paragraph(text: string, color: string) {
    const clean = cleanText(text)
    this.doc.font('regular').fontSize(8.5)
    const height = this.doc.heightOfString(clean, { width: CONTENT_WIDTH })
    this.ensure(height + 4)
    this.doc.fillColor(color).text(clean, PAGE.margin, this.y, { width: CONTENT_WIDTH })
    this.y += height + 6
  }
}
