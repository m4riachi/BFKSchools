import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import DashboardService from '#services/dashboard_service'
import { staffSchoolId } from '#policies/parent_policy'
import { presentDashboard } from '#support/report_presenters'

/**
 * Back-office dashboard (brief §5.7, admin + manager). Staff without a
 * school see an empty state (nothing to report on).
 */
@inject()
export default class DashboardController {
  constructor(protected dashboards: DashboardService) {}

  async show({ inertia, bouncer, auth, i18n }: HttpContext) {
    await bouncer.authorize('accessBackOffice')
    const schoolId = staffSchoolId(auth.getUserOrFail())
    if (schoolId === null) return inertia.render('admin/dashboard', { dashboard: null })
    const school = await School.findOrFail(schoolId)
    const dashboard = await this.dashboards.build(school, {
      amounts: await bouncer.with('ReportPolicy').allows('viewAmounts'),
    })
    return inertia.render('admin/dashboard', {
      dashboard: presentDashboard(dashboard, i18n.locale),
    })
  }
}
