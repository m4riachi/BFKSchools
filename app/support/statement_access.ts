import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import type User from '#models/user'
import type { FamilyStatement } from '#services/statement_service'
import type StatementPdfService from '#services/statement_pdf_service'
import type Clock from '#services/clock'
import { attachmentHeader, renderPdfForUser } from '#support/report_access'
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
 * One unit of the per-user download limiter (429 past 30/min). Callers
 * consume it BEFORE building the statement (the SQL work), so a client over
 * the limit costs nothing.
 */
export async function consumeDownload(ctx: HttpContext) {
  await reportDownloadLimiter().consume(reportKeys.download(ctx.auth.getUserOrFail().id))
}

/**
 * Sends a statement PDF rendered behind the per-user and shared PDF gates
 * (D27: 429 when this user already has 2 PDFs in flight, 503 when the
 * server queue is full). The download limiter was consumed by the caller.
 */
export async function sendStatementPdf(
  ctx: HttpContext,
  statement: FamilyStatement,
  pdf: StatementPdfService,
  clock: Clock,
  fileName: string
) {
  const { response, i18n } = ctx
  const bytes = await renderPdfForUser(ctx, () =>
    pdf.render(statement, { locale: i18n.locale, generatedAt: clock.now() })
  )
  if (bytes === null) return
  response.header('Content-Type', 'application/pdf')
  response.header('Content-Disposition', attachmentHeader(fileName))
  response.header('Cache-Control', 'no-store')
  response.header('X-Content-Type-Options', 'nosniff')
  return response.send(bytes)
}
