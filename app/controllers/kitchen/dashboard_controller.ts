import type { HttpContext } from '@adonisjs/core/http'

export default class DashboardController {
  async show({ inertia, bouncer }: HttpContext) {
    await bouncer.authorize('accessKitchen')
    return inertia.render('kitchen/dashboard', {})
  }
}
