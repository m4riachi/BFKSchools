import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import NotificationCenterService from '#services/notification_center_service'
import SchoolSettingsService from '#services/school_settings_service'
import { notificationListValidator, notificationPreferencesValidator } from '#validators/statements'

/**
 * Parent notification center: list (newest first), unread badge, mark one
 * / all as read, open (mark read + go to the related page), and email
 * preferences (reminders can be turned off, cancellations can't). Every
 * query is filtered on the logged-in user: another user's id is a 404.
 */
@inject()
export default class NotificationsController {
  constructor(
    protected center: NotificationCenterService,
    protected settings: SchoolSettingsService
  ) {}

  /** GET /notifications?page= */
  async index(ctx: HttpContext) {
    const { request, inertia, i18n, bouncer, auth } = ctx
    await bouncer.authorize('accessParentPortal')
    const user = auth.getUserOrFail()
    let query: { page?: number } = {}
    try {
      query = await notificationListValidator.validate(request.qs())
    } catch {
      query = {}
    }
    const page = await this.center.page(user, query.page ?? 1, i18n.locale)
    const school = typeof user.schoolId === 'number' ? await School.find(user.schoolId) : null
    const schoolEmails = this.settings.get(school ?? { settings: {} }).email_notifications
    return inertia.render('parent/notifications/index', {
      notifications: page.items,
      meta: page.meta,
      unread: await this.center.unreadCount(user.id),
      preferences: this.center.preferences(user),
      schoolEmails: {
        enabled: schoolEmails.enabled,
        menu_published: schoolEmails.enabled && schoolEmails.menu_published,
        deadline_reminder: schoolEmails.enabled && schoolEmails.deadline_reminder,
      },
    })
  }

  protected id(ctx: HttpContext) {
    return Number(ctx.params.id)
  }

  /** POST /notifications/:id/read */
  async markRead(ctx: HttpContext) {
    const { response, bouncer, auth } = ctx
    await bouncer.authorize('accessParentPortal')
    const notification = await this.center.markRead(auth.getUserOrFail(), this.id(ctx))
    if (!notification) return response.notFound()
    return response.redirect().back()
  }

  /** POST /notifications/:id/open — marks it read and opens the related page. */
  async open(ctx: HttpContext) {
    const { response, bouncer, auth, i18n } = ctx
    await bouncer.authorize('accessParentPortal')
    const user = auth.getUserOrFail()
    const notification = await this.center.markRead(user, this.id(ctx))
    if (!notification) return response.notFound()
    const [presented] = await this.center.present(user, [notification], i18n.locale)
    // Server-built local path only (never a URL taken from the data as-is).
    const href =
      presented.href.startsWith('/') && !presented.href.startsWith('//') ? presented.href : '/'
    return response.redirect().withQs(false).toPath(href)
  }

  /** POST /notifications/read-all */
  async markAllRead(ctx: HttpContext) {
    const { response, bouncer, auth, session, i18n } = ctx
    await bouncer.authorize('accessParentPortal')
    const count = await this.center.markAllRead(auth.getUserOrFail())
    if (count) session.flash('success', i18n.t('notifications.flash.all_read'))
    return response.redirect().back()
  }

  /** PUT /notifications/preferences */
  async updatePreferences(ctx: HttpContext) {
    const { request, response, bouncer, auth, session, i18n } = ctx
    await bouncer.authorize('accessParentPortal')
    const values = await request.validateUsing(notificationPreferencesValidator)
    await this.center.updatePreferences(auth.getUserOrFail(), values)
    session.flash('success', i18n.t('notifications.flash.preferences_saved'))
    return response.redirect().back()
  }
}
