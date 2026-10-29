import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import type User from '#models/user'
import type { FamilyStatement } from '#services/statement_service'
import type StatementPdfService from '#services/statement_pdf_service'
import type Clock from '#services/clock'
import { attachmentHeader } from '#support/report_access'
import { pdfRenderGate, RenderBusyError } from '#support/render_gate'
import { isStatementMonth, monthOf, type StatementMonth } from '#support/statement_month'
import { reportDownloadLimiter, reportKeys } from '#start/limiter'

/**
 * Helpers shared by the parent and back-office statement controllers.
 */

/**
 * The month asked for: a valid 'YYYY-MM' inside the window, else the
 * current month (pages) — `strict` callers (downloads) get null instead.
 */
export function pickMonth(
  value: string | undefined,
  today: string,
  strict = false
): StatementMonth | null {
  if (value === undefined) return monthOf(today)
  if (isStatementMonth(value, today)) return value
  return strict ? null : monthOf(today)
}

/** Billing settings come from the parent's school (defaults when it has none). */
export async function schoolOf(parent: Pick<User, 'schoolId'>): Promise<Pick<School, 'settings'>> {
  const school = typeof parent.schoolId === 'number' ? await School.find(parent.schoolId) : null
  return school ?? { settings: {} }
}

/**
 * Sends a statement PDF: one unit of the per-user download limiter (429
 * past 30/min), then the render behind the shared PDF gate (503 when too
 * many renders are already waiting).
 */
export async function sendStatementPdf(
  ctx: HttpContext,
  statement: FamilyStatement,
  pdf: StatementPdfService,
  clock: Clock,
  fileName: string
) {
  const { response, i18n, auth } = ctx
  await reportDownloadLimiter().consume(reportKeys.download(auth.getUserOrFail().id))
  let bytes: Buffer
  try {
    bytes = await pdfRenderGate.run(() =>
      pdf.render(statement, { locale: i18n.locale, generatedAt: clock.now() })
    )
  } catch (error) {
    if (error instanceof RenderBusyError) {
      response.header('Retry-After', '10')
      return response.serviceUnavailable(i18n.t('errors.busy'))
    }
    throw error
  }
  response.header('Content-Type', 'application/pdf')
  response.header('Content-Disposition', attachmentHeader(fileName))
  response.header('Cache-Control', 'no-store')
  response.header('X-Content-Type-Options', 'nosniff')
  return response.send(bytes)
}
