import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import { staffSchoolId } from '#policies/parent_policy'
import AdminReportService from '#services/admin_report_service'
import { presentAdminReport } from '#support/report_presenters'
import { adminReportQueryValidator } from '#validators/reports'

/** Back-office reports (D38, admin + manager). Invalid dates fall back to this month. */
@inject()
export default class ReportsController {
  constructor(protected reports: AdminReportService) {}

  async show({ inertia, bouncer, auth, request, i18n }: HttpContext) {
    await bouncer.authorize('accessBackOffice')
    const schoolId = staffSchoolId(auth.getUserOrFail())
    if (schoolId === null) return inertia.render('admin/reports/index', { report: null })
    const school = await School.findOrFail(schoolId)
    const [, query] = await adminReportQueryValidator.tryValidate(request.qs())
    const { from, to } = this.reports.period(query?.from, query?.to)
    const report = await this.reports.build(school, from, to)
    return inertia.render('admin/reports/index', {
      report: presentAdminReport(report, i18n.locale),
    })
  }
}
