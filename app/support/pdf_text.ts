import { readFile } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import PDFDocument from 'pdfkit'

/**
 * Shared pdfkit helpers (Phase 7 labels, Phase 8 statements).
 *
 * Fonts: Noto Sans for Latin text (French accents) and Noto Sans Arabic for
 * Arabic-script words (resources/fonts, OFL). pdfkit shapes Arabic letters
 * (fontkit) but has no bidi support, so a line containing Arabic script is
 * laid out word by word from right to left (`drawRtl`). Characters missing
 * from both fonts (emoji, CJK…) print as empty boxes — never an error.
 * See docs/STACK_NOTES.md (Phase 7 surprises).
 */
export const FONT_FILES = {
  regular: 'NotoSans-Regular.ttf',
  bold: 'NotoSans-Bold.ttf',
  arabic: 'NotoSansArabic-Regular.ttf',
  arabicBold: 'NotoSansArabic-Bold.ttf',
} as const
export type FontKey = keyof typeof FONT_FILES

export type Doc = PDFKit.PDFDocument
export type TextStyle = { bold?: boolean; size: number; color?: string; minSize?: number }

/** Arabic, Arabic Supplement / Extended-A and presentation forms (escapes kept as text: eslint --fix would inline them). */
const ARABIC_SCRIPT = new RegExp(
  '[\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF]'
)

/** C0/C1 controls and bidi marks/overrides (a name could otherwise reorder the text). */
const CONTROL_CHARS = new RegExp(
  // eslint-disable-next-line no-control-regex
  '[\\u0000-\\u001F\\u007F-\\u009F\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]',
  'g'
)

const INK = '#14211B'

let fontCache: Promise<Record<FontKey, Buffer>> | null = null

export function loadPdfFonts(): Promise<Record<FontKey, Buffer>> {
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

/** Lets other requests run between chunks of a long render (pdfkit is synchronous). */
export function yieldToLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

/**
 * A new document with the fonts registered and a promise of its bytes
 * (collected in memory: every caller bounds the content).
 */
export async function createPdf(
  options: PDFKit.PDFDocumentOptions
): Promise<{ doc: Doc; done: Promise<Buffer> }> {
  const fonts = await loadPdfFonts()
  const doc = new PDFDocument(options)
  for (const key of Object.keys(fonts) as FontKey[]) doc.registerFont(key, fonts[key])
  const chunks: Buffer[] = []
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  return { doc, done }
}

/**
 * One line of text, shrunk (down to `minSize`) then truncated with an
 * ellipsis to fit `width`. Arabic-script lines go through `drawRtl`.
 * `align: 'right'` right-aligns a Latin line inside `width`.
 */
export function drawLine(
  doc: Doc,
  raw: string,
  x: number,
  y: number,
  width: number,
  style: TextStyle & { align?: 'left' | 'right' }
) {
  const text = cleanText(raw)
  if (!text) return
  doc.fillColor(style.color ?? INK)
  if (hasArabicScript(text)) {
    drawRtl(doc, text, x, y, width, style)
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
  const fitted = truncate(doc, text, width)
  const left = style.align === 'right' ? x + width - doc.widthOfString(fitted) : x
  doc.text(fitted, left, y, { lineBreak: false })
}

/** Cuts `text` so it fits `width` with a trailing ellipsis (binary search). */
export function truncate(doc: Doc, text: string, width: number): string {
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
export function drawRtl(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  style: TextStyle
) {
  const words = text.split(' ').filter(Boolean)
  const fontOf = (word: string): FontKey =>
    hasArabicScript(word) ? (style.bold ? 'arabicBold' : 'arabic') : style.bold ? 'bold' : 'regular'
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
  let right = x + width
  for (let index = 0; index < count; index += 1) {
    const left = right - widths[index]
    doc.font(fontOf(words[index])).fontSize(size).text(words[index], left, y, { lineBreak: false })
    right = left - space
  }
}
