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
import { dbIdMatcher } from '#support/route_matchers'

/**
 * Guests
 */
router
  .group(() => {
    router.get('login', [controllers.Session, 'create']).as('session.create')
    router.post('login', [controllers.Session, 'store']).as('session.store')
    router.get('password/forgot', [controllers.auth.PasswordReset, 'create']).as('password.forgot')
    router
      .post('password/forgot', [controllers.auth.PasswordReset, 'store'])
      .as('password.forgot.store')
  })
  .use(middleware.guest())

/**
 * Links from invitation / password-reset emails (guests or logged in: a
 * successful submission logs in as the link's owner). Rate-limited in the
 * controller; tokens are 43-char base64url strings.
 */
const tokenMatcher = { match: /^[A-Za-z0-9_-]{1,64}$/ }
router
  .get('invitation/:token', [controllers.auth.AccountLinks, 'showInvitation'])
  .where('token', tokenMatcher)
  .as('invitation.show')
router
  .post('invitation/:token', [controllers.auth.AccountLinks, 'acceptInvitation'])
  .where('token', tokenMatcher)
  .as('invitation.accept')
router
  .get('password/reset/:token', [controllers.auth.AccountLinks, 'showReset'])
  .where('token', tokenMatcher)
  .as('password.reset')
router
  .post('password/reset/:token', [controllers.auth.AccountLinks, 'submitReset'])
  .where('token', tokenMatcher)
  .as('password.reset.store')

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
 * Glovo and home delivery buttons of the parent portal: count, then redirect (D38).
 */
router
  .get('out/:link', [controllers.parent.OutboundLinks, 'show'])
  .where('link', { match: /^(glovo|delivery)$/ })
  .as('outbound.show')
  .use([middleware.auth(), middleware.role({ roles: ['parent'] })])

/**
 * External API (D36): X-Api-Key + X-Api-Secret, see ApiKeyMiddleware.
 */
router
  .get('api/v1/revenue/daily', [controllers.api.Revenue, 'daily'])
  .as('api.revenue.daily')
  .use(middleware.apiKey())

/**
 * Meal photos for any logged-in user (no storage key in the URL; see
 * MediaController).
 */
router
  .get('media/meal-photos/:id/:variant', [controllers.Media, 'mealPhoto'])
  .where('id', dbIdMatcher)
  .where('variant', { match: /^(full|thumb)$/ })
  .as('media.meal_photo')
  .use(middleware.auth())

/**
 * Parent portal (mobile-first). Staff visiting "/" are redirected to their home.
 */
const isoDay = { match: /^\d{4}-\d{2}-\d{2}$/ }
router
  .group(() => {
    router.get('/', [controllers.parent.Orders, 'week']).as('parent.home')
  })
  .use(middleware.auth())

/**
 * Parent ordering (Phase 6): parents only (role middleware + Bouncer +
 * Child.visibleTo in the controller).
 */
router
  .group(() => {
    router.get('history', [controllers.parent.Orders, 'history']).as('history')
    router
      .post(':childId/days/:date', [controllers.parent.Orders, 'saveDay'])
      .where('childId', dbIdMatcher)
      .where('date', isoDay)
      .as('save')
    router
      .post(':childId/days/:date/absent', [controllers.parent.Orders, 'cancelDay'])
      .where('childId', dbIdMatcher)
      .where('date', isoDay)
      .as('absent')
    router
      .post('days/:date/all', [controllers.parent.Orders, 'applyAll'])
      .where('date', isoDay)
      .as('apply_all')
  })
  .prefix('orders')
  .as('parent.orders')
  .use([middleware.auth(), middleware.role({ roles: ['parent'] })])

/**
 * Parent statements and notification center (Phase 8): parents only.
 * Children / notifications are always looked up for the logged-in parent.
 */
router
  .group(() => {
    router.get('statements', [controllers.parent.Statements, 'show']).as('statements')
    // Account tab (D30): details + change password
    router.get('account', [controllers.parent.Account, 'show']).as('account')
    router
      .put('account/password', [controllers.parent.Account, 'updatePassword'])
      .as('account.password')
    router.get('statements/pdf', [controllers.parent.Statements, 'download']).as('statements.pdf')
    router.get('notifications', [controllers.parent.Notifications, 'index']).as('notifications')
    router
      .post('notifications/read-all', [controllers.parent.Notifications, 'markAllRead'])
      .as('notifications.read_all')
    router
      .put('notifications/preferences', [controllers.parent.Notifications, 'updatePreferences'])
      .as('notifications.preferences')
    router
      .post('notifications/:id/read', [controllers.parent.Notifications, 'markRead'])
      .where('id', dbIdMatcher)
      .as('notifications.read')
    router
      .post('notifications/:id/open', [controllers.parent.Notifications, 'open'])
      .where('id', dbIdMatcher)
      .as('notifications.open')
  })
  .as('parent')
  .use([middleware.auth(), middleware.role({ roles: ['parent'] })])

/**
 * Back-office: admin + manager
 */
/** Database ids: 1..2147483647 only (others → 404, never an int4 overflow). */
const id = dbIdMatcher
router
  .group(() => {
    router.get('/', [controllers.admin.Dashboard, 'show']).as('dashboard')
    router.get('reports', [controllers.admin.Reports, 'show']).as('reports.show')

    // Families (Phase 2): parents, children, subscription periods
    router.get('parents', [controllers.admin.Parents, 'index']).as('parents.index')
    router.get('parents/create', [controllers.admin.Parents, 'create']).as('parents.create')
    router.post('parents', [controllers.admin.Parents, 'store']).as('parents.store')
    router
      .get('parents/:id', [controllers.admin.Parents, 'show'])
      .where('id', id)
      .as('parents.show')
    router
      .get('parents/:id/edit', [controllers.admin.Parents, 'edit'])
      .where('id', id)
      .as('parents.edit')
    router
      .put('parents/:id', [controllers.admin.Parents, 'update'])
      .where('id', id)
      .as('parents.update')
    router
      .post('parents/:id/deactivate', [controllers.admin.Parents, 'deactivate'])
      .where('id', id)
      .as('parents.deactivate')
    router
      .post('parents/:id/activate', [controllers.admin.Parents, 'activate'])
      .where('id', id)
      .as('parents.activate')
    router
      .post('parents/:id/invitation', [controllers.admin.Parents, 'invite'])
      .where('id', id)
      .as('parents.invite')

    router
      .group(() => {
        router.get('create', [controllers.admin.Children, 'create']).as('create')
        router.post('/', [controllers.admin.Children, 'store']).as('store')
        router.get(':id/edit', [controllers.admin.Children, 'edit']).where('id', id).as('edit')
        router.put(':id', [controllers.admin.Children, 'update']).where('id', id).as('update')
        router.delete(':id', [controllers.admin.Children, 'destroy']).where('id', id).as('destroy')

        router
          .post(':childId/subscriptions', [controllers.admin.Subscriptions, 'store'])
          .where('childId', id)
          .as('subscriptions.store')
        router
          .put(':childId/subscriptions/:id', [controllers.admin.Subscriptions, 'update'])
          .where('childId', id)
          .where('id', id)
          .as('subscriptions.update')
        router
          .delete(':childId/subscriptions/:id', [controllers.admin.Subscriptions, 'destroy'])
          .where('childId', id)
          .where('id', id)
          .as('subscriptions.destroy')
      })
      .prefix('parents/:parentId/children')
      .where('parentId', id)
      .as('children')

    // Meal catalog (Phase 3). Delete = soft delete.
    router.get('meals', [controllers.admin.Meals, 'index']).as('meals.index')
    router.get('meals/create', [controllers.admin.Meals, 'create']).as('meals.create')
    router.post('meals', [controllers.admin.Meals, 'store']).as('meals.store')
    router.get('meals/:id/edit', [controllers.admin.Meals, 'edit']).where('id', id).as('meals.edit')
    router.put('meals/:id', [controllers.admin.Meals, 'update']).where('id', id).as('meals.update')
    router
      .post('meals/:id/duplicate', [controllers.admin.Meals, 'duplicate'])
      .where('id', id)
      .as('meals.duplicate')
    router
      .delete('meals/:id', [controllers.admin.Meals, 'destroy'])
      .where('id', id)
      .as('meals.destroy')
    // Photos. The upload route's multipart body is processed by the controller
    // (config/bodyparser.ts `processManually` lists this exact pattern).
    router
      .post('meals/:id/photos', [controllers.admin.MealPhotos, 'store'])
      .where('id', id)
      .as('meals.photos.store')
    router
      .put('meals/:id/photos/order', [controllers.admin.MealPhotos, 'reorder'])
      .where('id', id)
      .as('meals.photos.reorder')
    router
      .post('meals/:id/photos/:photoId/cover', [controllers.admin.MealPhotos, 'cover'])
      .where('id', id)
      .where('photoId', id)
      .as('meals.photos.cover')
    router
      .delete('meals/:id/photos/:photoId', [controllers.admin.MealPhotos, 'destroy'])
      .where('id', id)
      .where('photoId', id)
      .as('meals.photos.destroy')

    // Holidays (Phase 4). Ranges are addressed by their group id (uuid).
    const uuid = router.matchers.uuid()
    router.get('holidays', [controllers.admin.Holidays, 'index']).as('holidays.index')
    router.post('holidays', [controllers.admin.Holidays, 'store']).as('holidays.store')
    router
      .post('holidays/generate', [controllers.admin.Holidays, 'generate'])
      .as('holidays.generate')
    router
      .put('holidays/settings', [controllers.admin.Holidays, 'updateSettings'])
      .as('holidays.settings')
    router
      .put('holidays/groups/:groupId', [controllers.admin.Holidays, 'updateGroup'])
      .where('groupId', uuid)
      .as('holidays.groups.update')
    router
      .post('holidays/groups/:groupId/toggle', [controllers.admin.Holidays, 'toggleGroup'])
      .where('groupId', uuid)
      .as('holidays.groups.toggle')
    router
      .delete('holidays/groups/:groupId', [controllers.admin.Holidays, 'destroyGroup'])
      .where('groupId', uuid)
      .as('holidays.groups.destroy')
    router
      .put('holidays/:id', [controllers.admin.Holidays, 'update'])
      .where('id', id)
      .as('holidays.update')
    router
      .post('holidays/:id/toggle', [controllers.admin.Holidays, 'toggle'])
      .where('id', id)
      .as('holidays.toggle')
    router
      .delete('holidays/:id', [controllers.admin.Holidays, 'destroy'])
      .where('id', id)
      .as('holidays.destroy')
    // ICS import (file upload, or https URL behind the SSRF guard)
    router
      .get('holidays/import', [controllers.admin.HolidayImports, 'create'])
      .as('holidays.import.create')
    router
      .post('holidays/import', [controllers.admin.HolidayImports, 'upload'])
      .as('holidays.import.upload')
    router
      .post('holidays/import/url', [controllers.admin.HolidayImports, 'fetchUrl'])
      .as('holidays.import.url')
    router
      .get('holidays/import/:id', [controllers.admin.HolidayImports, 'show'])
      .where('id', uuid)
      .as('holidays.import.show')
    router
      .post('holidays/import/:id/confirm', [controllers.admin.HolidayImports, 'confirm'])
      .where('id', uuid)
      .as('holidays.import.confirm')

    // Weekly menus (Phase 5). A week is addressed by its Monday (YYYY-MM-DD).
    const week = { match: /^\d{4}-\d{2}-\d{2}$/ }
    router.get('menus', [controllers.admin.WeeklyMenus, 'index']).as('menus.index')
    router
      .group(() => {
        router.get('/', [controllers.admin.WeeklyMenus, 'show']).as('show')
        router.post('items', [controllers.admin.WeeklyMenus, 'storeItem']).as('items.store')
        router
          .put('items/:id', [controllers.admin.WeeklyMenus, 'updateItem'])
          .where('id', id)
          .as('items.update')
        router
          .post('items/:id/default', [controllers.admin.WeeklyMenus, 'setDefault'])
          .where('id', id)
          .as('items.default')
        router
          .delete('items/:id', [controllers.admin.WeeklyMenus, 'destroyItem'])
          .where('id', id)
          .as('items.destroy')
        router
          .get('items/:id/remove', [controllers.admin.WeeklyMenus, 'removeItemImpact'])
          .where('id', id)
          .as('items.remove')
        router.post('copy-previous', [controllers.admin.WeeklyMenus, 'copyPrevious']).as('copy')
        router
          .post('apply-template', [controllers.admin.WeeklyMenus, 'applyTemplate'])
          .as('templates.apply')
        router
          .post('save-template', [controllers.admin.WeeklyMenus, 'saveTemplate'])
          .as('templates.save')
        router.put('times', [controllers.admin.WeeklyMenus, 'updateTimes']).as('times')
        router.post('schedule', [controllers.admin.WeeklyMenus, 'schedule']).as('schedule')
        router.post('unschedule', [controllers.admin.WeeklyMenus, 'unschedule']).as('unschedule')
        router.post('publish', [controllers.admin.WeeklyMenus, 'publish']).as('publish')
      })
      .prefix('menus/:week')
      .where('week', week)
      .as('menus')
    router
      .delete('menu-templates/:id', [controllers.admin.WeeklyMenus, 'destroyTemplate'])
      .where('id', id)
      .as('menu_templates.destroy')

    // Orders (Phase 6): day list, a child's week with audited staff changes
    router.get('orders', [controllers.admin.Orders, 'index']).as('orders.index')
    router
      .get('orders/children/:childId', [controllers.admin.Orders, 'childWeek'])
      .where('childId', id)
      .as('orders.child')
    router
      .post('orders/children/:childId/days/:date', [controllers.admin.Orders, 'saveDay'])
      .where('childId', id)
      .where('date', isoDay)
      .as('orders.save')
    router
      .post('orders/children/:childId/days/:date/cancel', [controllers.admin.Orders, 'cancelDay'])
      .where('childId', id)
      .where('date', isoDay)
      .as('orders.cancel')

    // Monthly statements (Phase 8, D11: no payment tracking)
    router.get('statements', [controllers.admin.Statements, 'index']).as('statements.index')
    router
      .get('statements/export', [controllers.admin.Statements, 'export'])
      .as('statements.export')
    router
      .get('statements/parents/:id', [controllers.admin.Statements, 'show'])
      .where('id', id)
      .as('statements.show')
    router
      .get('statements/parents/:id/pdf', [controllers.admin.Statements, 'download'])
      .where('id', id)
      .as('statements.pdf')

    // School settings (admin only, SchoolPolicy.updateSettings)
    router.get('settings', [controllers.admin.Settings, 'show']).as('settings.show')
    router.put('settings', [controllers.admin.Settings, 'update']).as('settings.update')
    router
      .post('settings/api-keys', [controllers.admin.Settings, 'generateApiKeys'])
      .as('settings.api_keys.generate')
    router
      .get('settings/api-keys/secret', [controllers.admin.Settings, 'apiSecret'])
      .as('settings.api_keys.secret')

    // CSV import of families
    router.get('imports/families', [controllers.admin.FamilyImports, 'create']).as('imports.create')
    router
      .get('imports/families/template', [controllers.admin.FamilyImports, 'template'])
      .as('imports.template')
    router
      .post('imports/families', [controllers.admin.FamilyImports, 'upload'])
      .as('imports.upload')
    router
      .get('imports/families/:id', [controllers.admin.FamilyImports, 'show'])
      .where('id', router.matchers.uuid())
      .as('imports.show')
    router
      .post('imports/families/:id/confirm', [controllers.admin.FamilyImports, 'confirm'])
      .where('id', router.matchers.uuid())
      .as('imports.confirm')
  })
  .prefix('admin')
  .as('admin')
  .use([middleware.auth(), middleware.role({ roles: ['admin', 'manager'] })])

/**
 * Kitchen area: admin + manager + kitchen (read-only — GET routes only;
 * Phase 7 reports: production sheet, allergy sheet, labels PDF, exports).
 */
router
  .group(() => {
    router.get('/', [controllers.kitchen.Dashboard, 'show']).as('dashboard')
    router.get('allergies', [controllers.kitchen.Reports, 'allergies']).as('allergies')
    router.get('labels', [controllers.kitchen.Reports, 'labels']).as('labels')
    router.get('labels/pdf', [controllers.kitchen.Reports, 'labelsPdf']).as('labels.pdf')
    router.get('exports', [controllers.kitchen.Reports, 'exports']).as('exports')
    router.get('exports/download', [controllers.kitchen.Reports, 'download']).as('exports.download')
    router.get('meals', [controllers.kitchen.Meals, 'index']).as('meals.index')
    router.get('meals/:id', [controllers.kitchen.Meals, 'show']).where('id', id).as('meals.show')
  })
  .prefix('kitchen')
  .as('kitchen')
  .use([middleware.auth(), middleware.role({ roles: ['admin', 'manager', 'kitchen'] })])
