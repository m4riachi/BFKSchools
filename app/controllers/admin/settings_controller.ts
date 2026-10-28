import { inject } from '@adonisjs/core'
import type { HttpContext } from '@adonisjs/core/http'
import School from '#models/school'
import SchoolSettingsService from '#services/school_settings_service'
import { schoolSettingsFormValidator } from '#validators/school_settings'
import { centsToInput } from '#support/money'

/**
 * Admin settings screen (brief §6): school days, school year, default
 * publish/deadline times, reminder delay, parent edit rules, auto-assign,
 * allergy rule, Moroccan holidays, notification emails, billing and the
 * supplement limit. **Admins of the school only** (`SchoolPolicy.updateSettings`):
 * managers get 403 on both the page and the update (decision: settings are
 * not shown read-only to managers — brief §3 "manager: back-office except
 * users and settings").
 */
@inject()
export default class SettingsController {
  constructor(protected settings: SchoolSettingsService) {}

  protected async school(ctx: HttpContext) {
    const user = ctx.auth.getUserOrFail()
    const school = typeof user.schoolId === 'number' ? await School.find(user.schoolId) : null
    await ctx.bouncer.with('SchoolPolicy').authorize('updateSettings', school ?? new School())
    return school!
  }

  async show(ctx: HttpContext) {
    const school = await this.school(ctx)
    const values = this.settings.get(school)
    const locale = ctx.i18n.locale === 'en' ? 'en' : 'fr'
    return ctx.inertia.render('admin/settings', {
      school: {
        name: school.name,
        timezone: school.timezone,
        schoolDays: [...school.schoolDays],
        schoolYearStart: school.schoolYearStart,
        schoolYearEnd: school.schoolYearEnd,
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
        allergy_rule: values.allergy_rule,
        generate_moroccan_holidays: values.generate_moroccan_holidays,
        email_notifications: { ...values.email_notifications },
        billing_mode: values.billing_mode,
        subscription_required_for_main_meal: values.subscription_required_for_main_meal,
        supplement_max_quantity: values.supplement_max_quantity,
      },
      monthlyFee:
        values.monthly_fee_cents === null ? '' : centsToInput(values.monthly_fee_cents, locale),
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
}
