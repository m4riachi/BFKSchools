import { inject } from '@adonisjs/core'
import i18nManager from '@adonisjs/i18n/services/main'
import type School from '#models/school'
import type { ProcurementView } from '#services/procurement_service'
import { createPdf, drawLine, yieldToLoop } from '#support/pdf_text'

/**
 * D56: the bon de commande of a day as an A4 PDF — header (school, reference,
 * date), a table article · quantity · unit, repeated header per page. Behind
 * the shared render gate by the caller.
 */
@inject()
export default class ProcurementPdfService {
  async render(
    school: Pick<School, 'name'>,
    view: ProcurementView,
    locale: string
  ): Promise<Buffer> {
    const i18n = i18nManager.locale(locale)
    const { doc, done } = await createPdf({
      size: 'A4',
      margin: 0,
      autoFirstPage: false,
      info: { Title: `${view.reference}`, Creator: 'British Academy × Beldi Fusion' },
    })
    const page = { width: 595.28, height: 841.89, margin: 36 }
    const inner = page.width - page.margin * 2
    const cols = [
      { key: 'article', w: inner * 0.62, align: 'left' as const },
      { key: 'quantity', w: inner * 0.22, align: 'right' as const },
      { key: 'unit', w: inner * 0.16, align: 'left' as const },
    ]
    const rowHeight = 20
    let y = 0
    let pageNumber = 0

    const headerRow = () => {
      doc.rect(page.margin, y, inner, rowHeight).fill('#EEF6F1')
      let x = page.margin
      for (const col of cols) {
        drawLine(doc, i18n.t(`procurement.pdf.${col.key}`), x + 5, y + 5, col.w - 10, {
          bold: true,
          size: 9,
          align: col.align,
        })
        x += col.w
      }
      doc
        .moveTo(page.margin, y + rowHeight)
        .lineTo(page.margin + inner, y + rowHeight)
        .lineWidth(0.6)
        .strokeColor('#1F6F4A')
        .stroke()
      y += rowHeight
    }

    const newPage = () => {
      pageNumber += 1
      doc.addPage()
      y = page.margin
      drawLine(doc, i18n.t('procurement.pdf.title'), page.margin, y, inner * 0.7, {
        bold: true,
        size: 16,
      })
      drawLine(doc, view.reference, page.margin, y, inner, { size: 11, align: 'right', bold: true })
      y += 22
      drawLine(doc, school.name, page.margin, y, inner * 0.7, {
        size: 9,
        color: '#56655E',
      })
      drawLine(
        doc,
        i18n.t('procurement.pdf.for_date', { date: view.date }),
        page.margin,
        y,
        inner,
        {
          size: 9,
          color: '#56655E',
          align: 'right',
        }
      )
      y += 20
      headerRow()
    }

    newPage()
    for (const [index, line] of view.lines.entries()) {
      if (y + rowHeight > page.height - page.margin - 30) newPage()
      if (index % 2 === 1) doc.rect(page.margin, y, inner, rowHeight).fill('#F7F9F8')
      let x = page.margin
      const cells = [line.label, this.number(line.quantity, locale), line.unit ?? '']
      for (const [i, col] of cols.entries()) {
        drawLine(doc, cells[i], x + 5, y + 5.5, col.w - 10, {
          size: 9,
          minSize: 6,
          align: col.align,
        })
        x += col.w
      }
      y += rowHeight
      if (index % 200 === 199) await yieldToLoop()
    }
    if (!view.lines.length) {
      drawLine(doc, i18n.t('procurement.pdf.empty'), page.margin, y + 6, inner, {
        size: 9,
        color: '#56655E',
      })
    }
    if (view.note) {
      y += 16
      drawLine(doc, `${i18n.t('procurement.pdf.note')}: ${view.note}`, page.margin, y, inner, {
        size: 9,
        color: '#56655E',
      })
    }
    doc.end()
    return done
  }

  /** A quantity with up to 3 decimals, locale-aware separator. */
  private number(value: number, locale: string): string {
    const text = Number(value)
      .toFixed(3)
      .replace(/\.?0+$/, '')
    return locale === 'fr' ? text.replace('.', ',') : text
  }
}
