import QRCode from 'qrcode'
import i18nManager from '@adonisjs/i18n/services/main'
import type School from '#models/school'
import { createPdf, drawLine } from '#support/pdf_text'

const BRAND = '#1F6F4A'
const MUTED = '#56655E'

/**
 * D59: the A4 poster of the parent sign-up link — school name, "Créez votre
 * compte" (French first, English under it: the school is bilingual), a big
 * QR code drawn as vector squares (sharp at any print size) and the URL in
 * clear under it. Behind `renderPdfForUser` in the caller.
 */
export default class RegistrationPosterPdfService {
  async render(school: Pick<School, 'name'>, url: string): Promise<Buffer> {
    const fr = i18nManager.locale('fr')
    const en = i18nManager.locale('en')
    const { doc, done } = await createPdf({
      size: 'A4',
      margin: 0,
      info: { Title: fr.t('settings.registration.poster.title'), Creator: 'BFK School Meals' },
    })
    const width = 595.28
    const height = 841.89
    const margin = 48
    const inner = width - margin * 2
    const center = (text: string, y: number, size: number, bold = false, color?: string) => {
      doc.font(bold ? 'bold' : 'regular').fontSize(size)
      const textWidth = Math.min(doc.widthOfString(text), inner)
      drawLine(doc, text, (width - textWidth) / 2, y, inner, { size, bold, color })
    }

    doc.rect(0, 0, width, 14).fill(BRAND)
    center(school.name, 64, 18, true, MUTED)
    center(fr.t('settings.registration.poster.title'), 104, 34, true, BRAND)
    center(en.t('settings.registration.poster.title'), 150, 18, false, MUTED)
    center(fr.t('settings.registration.poster.subtitle'), 190, 13)
    center(en.t('settings.registration.poster.subtitle'), 210, 11, false, MUTED)

    // QR code: one filled square per dark module, with a quiet zone of 4 modules.
    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' })
    const size = qr.modules.size
    const side = 380
    const cell = side / (size + 8)
    const left = (width - side) / 2
    const top = 250
    doc.rect(left, top, side, side).fill('#FFFFFF')
    doc.fillColor('#000000')
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (qr.modules.get(row, col)) {
          doc.rect(left + (col + 4) * cell, top + (row + 4) * cell, cell + 0.2, cell + 0.2)
        }
      }
    }
    doc.fill('#000000')
    doc.lineWidth(1).strokeColor('#D6DEDA').rect(left, top, side, side).stroke()

    let y = top + side + 28
    center(fr.t('settings.registration.poster.scan'), y, 13, true)
    y += 20
    center(en.t('settings.registration.poster.scan'), y, 11, false, MUTED)
    y += 30
    center(url, y, 10, false, MUTED)
    y += 34
    center(fr.t('settings.registration.poster.after'), y, 11)
    y += 18
    center(en.t('settings.registration.poster.after'), y, 10, false, MUTED)

    doc.rect(0, height - 14, width, 14).fill(BRAND)
    doc.end()
    return done
  }
}
