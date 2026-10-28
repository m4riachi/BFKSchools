import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import i18nManager from '@adonisjs/i18n/services/main'
import { DateTime } from 'luxon'
import PDFDocument from 'pdfkit'
import type { LabelRow } from '#services/production_report_service'
import { allergenLabels, mealName } from '#support/meal_display'

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
const FONT_FILES = {
  regular: 'NotoSans-Regular.ttf',
  bold: 'NotoSans-Bold.ttf',
  arabic: 'NotoSansArabic-Regular.ttf',
  arabicBold: 'NotoSansArabic-Bold.ttf',
} as const
type FontKey = keyof typeof FONT_FILES

const COLORS = {
  ink: '#14211B',
  muted: '#56655E',
  line: '#C9D2CD',
  danger: '#A12A2A',
  dangerSoft: '#FDECEC',
}

/** Arabic, Arabic Supplement / Extended-A and presentation forms (escapes kept as text: eslint --fix would inline them). */
const ARABIC_SCRIPT = new RegExp(
  '[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]'
)

/** C0/C1 controls and bidi marks/overrides (a name could otherwise reorder the label text). */
const CONTROL_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]',
  'g'
)

let fontCache: Promise<Record<FontKey, Buffer>> | null = null

function loadFonts(): Promise<Record<FontKey, Buffer>> {
  if (!fontCache) {
    fontCache = (async () => {
      const entries = await Promise.all(
        (Object.keys(FONT_FILES) as FontKey[]).map(
          async (key) =>
            [key, await readFile(app.makePath('resources/fonts', FONT_FILES[key]))] as const
        )
      )
      return Object.fromEntries(entries) as Record<FontKey, Buffer>
    })()
    fontCache.catch(() => (fontCache = null))
  }
  return fontCache
}

/** Text safe for the PDF: well-formed, no control / bidi override characters. */
export function cleanText(value: string | null | undefined): string {
  return (value ?? '').toWellFormed().replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim()
}

export function hasArabicScript(text: string): boolean {
  return ARABIC_SCRIPT.test(text)
}

type Doc = PDFKit.PDFDocument
type TextStyle = { bold?: boolean; size: number; color?: string; minSize?: number }

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
      cols: Math.min(Math.max(Math.trunc(options.grid.cols), 1), LABEL_GRID_LIMITS.cols[1]),
      rows: Math.min(Math.max(Math.trunc(options.grid.rows), 1), LABEL_GRID_LIMITS.rows[1]),
    }
    const fonts = await loadFonts()
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      autoFirstPage: false,
      info: { Title: cleanText(options.title), Creator: 'BFK School Meals' },
    })
    for (const key of Object.keys(fonts) as FontKey[]) doc.registerFont(key, fonts[key])

    const chunks: Buffer[] = []
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
    })

    const perPage = grid.cols * grid.rows
    const width = A4.width / grid.cols
    const height = A4.height / grid.rows
    const i18n = i18nManager.locale(options.locale)
    if (!labels.length) doc.addPage()
    labels.forEach((label, index) => {
      const slot = index % perPage
      if (slot === 0) doc.addPage()
      const x = (slot % grid.cols) * width
      const y = Math.floor(slot / grid.cols) * height
      this.drawLabel(doc, label, { x, y, width, height }, options.locale, i18n)
    })
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

  /**
   * One line of text, shrunk (down to `minSize`) then truncated with an
   * ellipsis to fit `width`. Arabic-script lines go through `drawRtl`.
   */
  protected drawLine(doc: Doc, raw: string, x: number, y: number, width: number, style: TextStyle) {
    const text = cleanText(raw)
    if (!text) return
    doc.fillColor(style.color ?? COLORS.ink)
    if (hasArabicScript(text)) {
      this.drawRtl(doc, text, x, y, width, style)
      return
    }
    const font: FontKey = style.bold ? 'bold' : 'regular'
    let size = style.size
    const minSize = style.minSize ?? Math.max(5.5, style.size * 0.75)
    doc.font(font).fontSize(size)
    while (size > minSize && doc.widthOfString(text) > width) {
      size = Math.max(minSize, size - 0.5)
      doc.fontSize(size)
    }
    doc.text(this.truncate(doc, text, width), x, y, { lineBreak: false })
  }

  /** Cuts `text` so it fits `width` with a trailing ellipsis (binary search). */
  protected truncate(doc: Doc, text: string, width: number): string {
    if (doc.widthOfString(text) <= width) return text
    const chars = [...text]
    let low = 0
    let high = chars.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (doc.widthOfString(`${chars.slice(0, middle).join('')}…`) <= width) low = middle
      else high = middle - 1
    }
    return `${chars.slice(0, low).join('').trimEnd()}…`
  }

  /**
   * Right-to-left line: words in reverse order, right-aligned, each word in
   * the font of its script (Arabic letters are shaped by fontkit inside a
   * word). Words that don't fit are dropped from the end of the sentence.
   */
  protected drawRtl(doc: Doc, text: string, x: number, y: number, width: number, style: TextStyle) {
    const words = text.split(' ').filter(Boolean)
    const fontOf = (word: string): FontKey =>
      hasArabicScript(word)
        ? style.bold
          ? 'arabicBold'
          : 'arabic'
        : style.bold
          ? 'bold'
          : 'regular'
    const minSize = style.minSize ?? Math.max(5.5, style.size * 0.75)
    let size = style.size
    const measure = () => {
      const widths = words.map((word) => doc.font(fontOf(word)).fontSize(size).widthOfString(word))
      const space = doc
        .font(style.bold ? 'bold' : 'regular')
        .fontSize(size)
        .widthOfString(' ')
      return { widths, space }
    }
    let { widths, space } = measure()
    const total = () => widths.reduce((sum, w) => sum + w, 0) + space * (widths.length - 1)
    while (size > minSize && total() > width) {
      size = Math.max(minSize, size - 0.5)
      ;({ widths, space } = measure())
    }
    let count = words.length
    while (
      count > 1 &&
      widths.slice(0, count).reduce((s, w) => s + w, 0) + space * (count - 1) > width
    ) {
      count -= 1
    }
    // Arabic glyphs sit a bit higher in Noto Sans Arabic: same baseline box.
    let right = x + width
    for (let index = 0; index < count; index += 1) {
      const left = right - widths[index]
      doc
        .font(fontOf(words[index]))
        .fontSize(size)
        .text(words[index], left, y, { lineBreak: false })
      right = left - space
    }
  }
}
