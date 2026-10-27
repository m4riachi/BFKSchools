import type { HttpContext } from '@adonisjs/core/http'

export default class DashboardController {
  async show({ inertia, bouncer }: HttpContext) {
    await bouncer.authorize('accessBackOffice')
    return inertia.render('admin/dashboard', {})
  }
}
