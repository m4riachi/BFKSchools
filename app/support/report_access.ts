import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import { reportSchoolId } from '#policies/report_policy'
import { reportDownloadLimiter, reportKeys } from '#start/limiter'
import {
  ClientGoneError,
  pdfUserRenderGate,
  RenderBusyError,
  UserRenderLimitError,
} from '#support/render_gate'

/**
 * School of a kitchen-area page (admin, manager or kitchen with a school).
 * Pages render an empty state for a user without a school (null); file
 * downloads use `requireReportSchool` (403 without a school).
 */
export async function reportSchool(ctx: HttpContext): Promise<School | null> {
  await ctx.bouncer.authorize('accessKitchen')
  const schoolId = reportSchoolId(ctx.auth.getUserOrFail())
  return schoolId === null ? null : School.findOrFail(schoolId)
}

/**
 * School of a file download (labels PDF, exports): 403 without a school,
 * then one unit of the per-user download limiter (429 when exhausted).
 */
export async function requireReportSchool(ctx: HttpContext): Promise<School> {
  await ctx.bouncer.with('ReportPolicy').authorize('view')
  const user = ctx.auth.getUserOrFail()
  await reportDownloadLimiter().consume(reportKeys.download(user.id))
  return School.findOrFail(reportSchoolId(user))
}

/**
 * `Content-Disposition: attachment` with an ASCII-only file name (callers
 * build it from validated dates and `fileNamePart()`), never user text as-is.
 */
export function attachmentHeader(fileName: string): string {
  const safe = fileName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  return `attachment; filename="${safe}"`
}

/** True once the client closed the connection (no one will read the PDF). */
export function clientGone(ctx: HttpContext): boolean {
  const req = ctx.request.request
  const res = ctx.response.response
  return Boolean(req.socket?.destroyed || (res.destroyed && !res.writableFinished))
}

/**
 * Runs a PDF render behind the per-user gate (D27: 1 running + 1 waiting
 * per user) and the server-wide `pdfRenderGate`. Returns the bytes, or null
 * after answering the request itself: 429 (this user already has two PDFs
 * in flight) or 503 (server busy), both with `Retry-After`; a client that
 * disconnected while waiting gets nothing and the render is skipped.
 */
export async function renderPdfForUser(
  ctx: HttpContext,
  render: () => Promise<Buffer>
): Promise<Buffer | null> {
  const { response, i18n, auth } = ctx
  try {
    return await pdfUserRenderGate.run(auth.getUserOrFail().id, render, () => clientGone(ctx))
  } catch (error) {
    if (error instanceof ClientGoneError) {
      response.status(499).send('')
      return null
    }
    if (error instanceof UserRenderLimitError) {
      response.header('Retry-After', '5')
      response.tooManyRequests(i18n.t('errors.busy'))
      return null
    }
    if (error instanceof RenderBusyError) {
      response.header('Retry-After', '10')
      response.serviceUnavailable(i18n.t('errors.busy'))
      return null
    }
    throw error
  }
}
