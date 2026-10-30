import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import logger from '@adonisjs/core/services/logger'
import School from '#models/school'
import AdminReportService, { type TrackedLink } from '#services/admin_report_service'
import SchoolSettingsService from '#services/school_settings_service'

/**
 * The Glovo and home delivery buttons (D37, D38): counts the click, then sends
 * the parent to the address in the settings (validated https).
 */
@inject()
export default class OutboundLinksController {
  constructor(
    protected reports: AdminReportService,
    protected settings: SchoolSettingsService
  ) {}

  async show({ params, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const school = typeof user.schoolId === 'number' ? await School.find(user.schoolId) : null
    const values = school ? this.settings.get(school) : null
    const link = params.link as TrackedLink
    const target = link === 'glovo' ? values?.glovo_url : values?.delivery_order_url
    if (!target) return response.redirect('/')

    try {
      await this.reports.recordClick(user, link)
    } catch (error) {
      // A lost count must not stop the parent from ordering.
      logger.warn({ error: (error as Error)?.name ?? 'Error' }, 'link click not recorded')
    }
    return response.redirect(target)
  }
}
