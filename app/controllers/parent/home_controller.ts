import type { HttpContext } from '@adonisjs/core/http'
import { homePathFor } from '#enums/roles'

export default class HomeController {
  /**
   * "/" is the parent portal. Staff and kitchen users are sent to their own
   * home instead of getting a 403.
   */
  async show({ inertia, bouncer, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.role !== 'parent') {
      return response.redirect(homePathFor(user.role))
    }

    await bouncer.authorize('accessParentPortal')
    return inertia.render('parent/home', {})
  }
}
