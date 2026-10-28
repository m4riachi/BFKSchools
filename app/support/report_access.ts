import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import { reportSchoolId } from '#policies/report_policy'
import { reportDownloadLimiter, reportKeys } from '#start/limiter'

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
