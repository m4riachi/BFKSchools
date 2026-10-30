import i18nManager from '@adonisjs/i18n/services/main'
import { DateTime } from 'luxon'
import type { LabelRow } from '#services/production_report_service'
import { allergenLabels, mealName } from '#support/meal_display'
import {
  cleanText,
  createPdf,
  drawLine,
  hasArabicScript,
  yieldToLoop,
  type Doc,
  type TextStyle,
} from '#support/pdf_text'

export { cleanText, hasArabicScript }

/**
 * Printable labels (brief §5.8): an A4 grid of `cols × rows` labels (school
 * setting `label_grid`, default 3 × 8 = 70 × 37 mm sheets), one label per
 * active order: child name, class · grade · date, the main meal, the
 * supplements, and the child's allergens on a red band (a black-bordered
 * "contains" warning when the meal holds one of them).
 *
 * pdfkit (pure JS, no headless browser — docs/STACK_NOTES.md §10). Fonts:
 * Noto Sans for Latin text (French accents) and Noto Sans Arabic for
 * Arabic-script words (resources/fonts, OFL). pdfkit shapes Arabic letters
 * (fontkit) but has no bidi support, so a line containing Arabic script is
 * laid out word by word from right to left (`drawRtl`). Characters missing
 * from both fonts (emoji, CJK…) print as empty boxes — never an error.
 *
 * Bounded: the caller caps the number of labels (`MAX_LABELS_PER_PDF`);
 * each label is clipped to its cell so long names can't spill over.
 */
export const MAX_LABELS_PER_PDF = 1200

/** Grid limits (same ranges as the `label_grid` setting validator). */
export const LABEL_GRID_LIMITS = { cols: [1, 6], rows: [1, 20] } as const

export type LabelGrid = { cols: number; rows: number }

const A4 = { width: 595.28, height: 841.89 }

const COLORS = {
  ink: '#14211B',
  muted: '#56655E',
  line: '#C9D2CD',
  danger: '#A12A2A',
  dangerSoft: '#FDECEC',
}

/** Labels drawn between two yields to the event loop. */
const LABELS_PER_CHUNK = 48

/** A grid dimension within its limits (NaN, ±Infinity or a fraction → a valid integer). */
export function clampGrid(value: number, [min, max]: readonly [number, number]): number {
  const whole = Number.isFinite(value) ? Math.trunc(value) : min
  return Math.min(Math.max(whole, min), max)
}

export default class LabelPdfService {
  /** Renders the labels into one PDF (in memory: the count is capped). */
  async render(
    labels: LabelRow[],
    options: { grid: LabelGrid; locale: string; title: string }
  ): Promise<Buffer> {
    if (labels.length > MAX_LABELS_PER_PDF) {
      throw new RangeError(`Too many labels (${labels.length} > ${MAX_LABELS_PER_PDF})`)
    }
    const grid = {
      cols: clampGrid(options.grid.cols, LABEL_GRID_LIMITS.cols),
      rows: clampGrid(options.grid.rows, LABEL_GRID_LIMITS.rows),
    }
    const { doc, done } = await createPdf({
      size: 'A4',
      margin: 0,
      autoFirstPage: false,
      info: { Title: cleanText(options.title), Creator: 'British Academy × Beldi Fusion' },
    })

    const perPage = grid.cols * grid.rows
    const width = A4.width / grid.cols
    const height = A4.height / grid.rows
    const i18n = i18nManager.locale(options.locale)
    if (!labels.length) doc.addPage()
    for (const [index, label] of labels.entries()) {
      // pdfkit is synchronous: let other requests run between chunks.
      if (index > 0 && index % LABELS_PER_CHUNK === 0) await yieldToLoop()
      const slot = index % perPage
      if (slot === 0) doc.addPage()
      const x = (slot % grid.cols) * width
      const y = Math.floor(slot / grid.cols) * height
      this.drawLabel(doc, label, { x, y, width, height }, options.locale, i18n)
    }
    doc.end()
    return done
  }

  protected drawLabel(
    doc: Doc,
    label: LabelRow,
    box: { x: number; y: number; width: number; height: number },
    locale: string,
    i18n: ReturnType<typeof i18nManager.locale>
  ) {
    // Inner padding keeps text out of the printer's unprintable edge.
    const pad = Math.min(10, box.width * 0.06, box.height * 0.1)
    const inner = {
      x: box.x + pad,
      y: box.y + pad * 0.8,
      width: box.width - pad * 2,
      bottom: box.y + box.height - pad * 0.8,
    }
    const scale = Math.min(1, box.height / 105, box.width / 198)
    const size = (base: number) => Math.max(5.5, base * scale)

    doc.save()
    doc.rect(box.x, box.y, box.width, box.height).clip()
    // Light cut guide.
    doc
      .lineWidth(0.3)
      .strokeColor(COLORS.line)
      .rect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1)
      .stroke()

    // Allergy band (bottom) first, so the meal text knows how much room is left.
    let bottom = inner.bottom
    if (label.allergies.length) {
      const names = allergenLabels(label.allergies, locale)
        .map((entry) => entry.label.toLocaleUpperCase(locale))
        .join(', ')
      const conflicts = label.lines.flatMap((line) => line.conflicts)
      const text = conflicts.length
        ? i18n.t('reports.labels.pdf_conflict', {
            allergens: [
              ...new Set(
                allergenLabels([...new Set(conflicts)], locale).map((entry) =>
                  entry.label.toLocaleUpperCase(locale)
                )
              ),
            ].join(', '),
          })
        : i18n.t('reports.labels.pdf_allergies', { allergens: names })
      const bandSize = size(7.5)
      const bandHeight = bandSize + 6
      const bandY = bottom - bandHeight
      doc.save()
      doc.rect(inner.x, bandY, inner.width, bandHeight).fill(COLORS.danger)
      if (conflicts.length) {
        doc
          .lineWidth(1.5)
          .strokeColor('#000000')
          .rect(inner.x, bandY, inner.width, bandHeight)
          .stroke()
      }
      doc.restore()
      this.drawLine(doc, text, inner.x + 3, bandY + 3, inner.width - 6, {
        bold: true,
        size: bandSize,
        color: '#FFFFFF',
        minSize: 5,
      })
      bottom = bandY - 2
    }

    let cursor = inner.y
    const name = `${cleanText(label.firstName)} ${cleanText(label.lastName)}`.trim()
    const nameSize = size(12)
    this.drawLine(doc, name, inner.x, cursor, inner.width, { bold: true, size: nameSize })
    cursor += nameSize * 1.3

    const date = DateTime.fromISO(label.date, { zone: 'utc' })
      .setLocale(locale)
      .toFormat('ccc d LLL')
    const meta = [label.className, label.grade, date]
      .map((part) => cleanText(part))
      .filter(Boolean)
      .join(' · ')
    const metaSize = size(8)
    this.drawLine(doc, meta, inner.x, cursor, inner.width, {
      size: metaSize,
      color: COLORS.muted,
    })
    cursor += metaSize * 1.5

    for (const line of label.lines) {
      const isMain = line.mealType === 'subscription'
      const lineSize = size(isMain ? 9 : 8)
      if (cursor + lineSize > bottom) break
      const text = isMain
        ? mealName(line, locale)
        : `+ ${mealName(line, locale)}${line.quantity > 1 ? ` ×${line.quantity}` : ''}`
      this.drawLine(doc, text, inner.x, cursor, inner.width, {
        bold: isMain,
        size: lineSize,
        color: line.conflicts.length ? COLORS.danger : COLORS.ink,
      })
      cursor += lineSize * 1.3
    }
    doc.restore()
  }

  protected drawLine(doc: Doc, raw: string, x: number, y: number, width: number, style: TextStyle) {
    drawLine(doc, raw, x, y, width, style)
  }
}
