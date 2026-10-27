/*
|--------------------------------------------------------------------------
| Routes
|--------------------------------------------------------------------------
|
| Every authenticated route group is protected by `auth` + `role`, and
| every controller action authorizes with Bouncer (golden rule 5).
|
*/

import { middleware } from '#start/kernel'
import { controllers } from '#generated/controllers'
import router from '@adonisjs/core/services/router'

/**
 * Guests
 */
router
  .group(() => {
    router.get('login', [controllers.Session, 'create']).as('session.create')
    router.post('login', [controllers.Session, 'store']).as('session.store')
  })
  .use(middleware.guest())

/**
 * Any visitor (guest or logged in) can switch the UI language.
 */
router.post('locale', [controllers.Locale, 'update']).as('locale.update')

/**
 * Any logged-in user
 */
router
  .group(() => {
    router.post('logout', [controllers.Session, 'destroy']).as('session.destroy')
  })
  .use(middleware.auth())

/**
 * Parent portal (mobile-first). Staff visiting "/" are redirected to their home.
 */
router
  .group(() => {
    router.get('/', [controllers.parent.Home, 'show']).as('parent.home')
  })
  .use(middleware.auth())

/**
 * Back-office: admin + manager
 */
router
  .group(() => {
    router.get('/', [controllers.admin.Dashboard, 'show']).as('dashboard')
  })
  .prefix('admin')
  .as('admin')
  .use([middleware.auth(), middleware.role({ roles: ['admin', 'manager'] })])

/**
 * Kitchen area: admin + manager + kitchen (read-only)
 */
router
  .group(() => {
    router.get('/', [controllers.kitchen.Dashboard, 'show']).as('dashboard')
  })
  .prefix('kitchen')
  .as('kitchen')
  .use([middleware.auth(), middleware.role({ roles: ['admin', 'manager', 'kitchen'] })])
