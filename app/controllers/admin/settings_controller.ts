import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import School from '#models/school'
import ApiKeyService from '#services/api_key_service'
import SchoolSettingsService from '#services/school_settings_service'
import { centsToInput, type Locale } from '#support/money'
import { schoolSettingsFormValidator } from '#validators/school_settings'

/**
 * Admin settings screen (brief §6): school days, school year, default
 * publish/deadline times, reminder delay, parent edit rules, auto-assign,
 * allergy rule, Moroccan holidays, notification emails and the supplement
 * limit (no billing settings: D31, subscription meals are free).
 * **Admins of the school only** (`SchoolPolicy.updateSettings`): managers get
 * 403 on both the page and the update (decision: settings are
 * not shown read-only to managers — brief §3 "manager: back-office except
 * users and settings").
 */
@inject()
export default class SettingsController {
  constructor(
    protected settings: SchoolSettingsService,
    protected apiKeys: ApiKeyService
  ) {}

  protected async school(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const school = typeof user.schoolId === 'number' ? await School.find(user.schoolId) : null
    await ctx.bouncer.with('SchoolPolicy').authorize('updateSettings', school ?? new School())
    return school!
  }

  async show(ctx: HttpContext) {
    const school = await this.school(ctx)
    const values = this.settings.get(school)
    const apiKey = await this.apiKeys.forSchool(school.id)
    return ctx.inertia.render('admin/settings', {
      school: {
        name: school.name,
        timezone: school.timezone,
        schoolDays: [...school.schoolDays],
        schoolYearStart: school.schoolYearStart,
        schoolYearEnd: school.schoolYearEnd,
      },
      subscriptionMealPrice: centsToInput(
        values.subscription_meal_price_cents,
        ctx.i18n.locale as Locale
      ),
      // Never the secret: see apiSecret().
      api: {
        endpoint: new URL('/api/v1/revenue/daily', env.get('APP_URL')).toString(),
        publicKey: apiKey?.publicKey ?? null,
        generatedAt: apiKey?.generatedAt.toISO() ?? null,
      },
      settings: {
        publish_weekday: values.publish_weekday,
        publish_time: values.publish_time,
        deadline_weekday: values.deadline_weekday,
        deadline_time: values.deadline_time,
        reminder_hours_before_deadline: values.reminder_hours_before_deadline,
        allow_parent_edits: values.allow_parent_edits,
        edit_mode: values.edit_mode,
        edit_cutoff_days_before: values.edit_cutoff_days_before,
        edit_cutoff_time: values.edit_cutoff_time,
        auto_assign_default_meal: values.auto_assign_default_meal,
        allergens_enabled: values.allergens_enabled,
        labels_enabled: values.labels_enabled,
        grade_enabled: values.grade_enabled,
        class_enabled: values.class_enabled,
        allergy_rule: values.allergy_rule,
        generate_moroccan_holidays: values.generate_moroccan_holidays,
        support_whatsapp: values.support_whatsapp,
        delivery_order_url: values.delivery_order_url,
        glovo_url: values.glovo_url,
        email_notifications: { ...values.email_notifications },
        subscription_required_for_main_meal: values.subscription_required_for_main_meal,
        supplement_max_quantity: values.supplement_max_quantity,
        label_grid: { ...values.label_grid },
      },
    })
  }

  async update(ctx: HttpContext) {
    const { request, response, session, i18n } = ctx
    const school = await this.school(ctx)
    const input = await request.validateUsing(schoolSettingsFormValidator)
    await this.settings.updateFromForm(school, input)
    session.flash('success', i18n.t('settings.flash.saved'))
    return response.redirect('/admin/settings')
  }

  /** New pair of API keys (D36); the previous one stops working. */
  async generateApiKeys(ctx: HttpContext) {
    const school = await this.school(ctx)
    const user = ctx.auth.getUserOrFail()
    await this.apiKeys.generate(school.id, user)
    logger.info({ schoolId: school.id, userId: user.id }, 'API keys generated')
    ctx.session.flash('success', ctx.i18n.t('settings.flash.api_keys_generated'))
    return ctx.response.redirect('/admin/settings')
  }

  /** The secret on demand, kept out of the page's props and of any cache. */
  async apiSecret(ctx: HttpContext) {
    const school = await this.school(ctx)
    const apiKey = await this.apiKeys.forSchool(school.id)
    const secret = apiKey ? this.apiKeys.secretOf(apiKey) : null
    if (!secret) return ctx.response.notFound({ error: 'no_secret' })
    logger.info({ schoolId: school.id, userId: ctx.auth.user!.id }, 'API secret displayed')
    ctx.response.header('Cache-Control', 'no-store')
    return { secret }
  }
}
