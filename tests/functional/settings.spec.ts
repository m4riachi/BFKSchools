/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import School from '#models/school'
import SchoolSettingsService from '#services/school_settings_service'
import { UserFactory } from '#database/factories/user_factory'
import { setupMenuSchool } from '#tests/helpers/menus'

function validForm(
  overrides: Record<string, unknown> = {},
  settings: Record<string, unknown> = {}
) {
  return {
    schoolDays: [1, 2, 3, 4, 5],
    schoolYearStart: '2026-08-24',
    schoolYearEnd: '2027-06-11',
    settings: {
      publish_weekday: 3,
      publish_time: '09:00',
      deadline_weekday: 6,
      deadline_time: '18:30',
      reminder_hours_before_deadline: 12,
      allow_parent_edits: false,
      edit_mode: 'same_day_only',
      edit_cutoff_days_before: 0,
      edit_cutoff_time: '09:00',
      auto_assign_default_meal: false,
      allergy_rule: 'warn_confirm',
      generate_moroccan_holidays: true,
      email_notifications: {
        enabled: true,
        menu_published: false,
        deadline_reminder: true,
        holiday_cancellation: true,
        order_changed_by_staff: false,
        menu_change: true,
      },
      // Removed by D31 (subscription meals are free): an old client may still
      // post them; they are dropped.
      billing_mode: 'monthly_fee',
      subscription_required_for_main_meal: false,
      supplement_max_quantity: 3,
      ...settings,
    },
    monthlyFee: '650,50',
    ...overrides,
  }
}

test.group('Settings screen', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('an admin of the school sees every setting with its current value', async ({
    client,
    assert,
  }) => {
    const { admin } = await setupMenuSchool()
    const response = await client.get('/admin/settings').loginAs(admin).withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('admin/settings')
    const props = response.inertiaProps as any
    assert.equal(props.settings.publish_weekday, 4)
    assert.equal(props.settings.deadline_time, '20:00')
    assert.equal(props.settings.edit_cutoff_time, '18:00')
    assert.deepEqual(props.school.schoolDays, [1, 2, 3, 4, 5])
    // D31: no billing settings any more.
    assert.notProperty(props, 'monthlyFee')
    assert.notProperty(props.settings, 'billing_mode')
  })

  test('an admin updates every key at once', async ({ client, assert }) => {
    const { school, admin } = await setupMenuSchool()
    const response = await client
      .put('/admin/settings')
      .loginAs(admin)
      .withCsrfToken()
      .json(validForm({ schoolDays: [5, 1, 2, 3, 4, 6], schoolYearEnd: '2027-06-18' }))
      .redirects(0)
    response.assertStatus(302)
    assert.equal(response.flashMessage('success'), 'Paramètres enregistrés.')

    const fresh = await School.findOrFail(school.id)
    assert.deepEqual(fresh.schoolDays, [1, 2, 3, 4, 5, 6])
    assert.equal(fresh.schoolYearEnd, '2027-06-18')
    const settings = (await app.container.make(SchoolSettingsService)).get(fresh)
    assert.include(settings, {
      publish_weekday: 3,
      publish_time: '09:00',
      deadline_weekday: 6,
      deadline_time: '18:30',
      reminder_hours_before_deadline: 12,
      allow_parent_edits: false,
      edit_mode: 'same_day_only',
      edit_cutoff_days_before: 0,
      edit_cutoff_time: '09:00',
      auto_assign_default_meal: false,
      allergy_rule: 'warn_confirm',
      generate_moroccan_holidays: true,
      subscription_required_for_main_meal: false,
      supplement_max_quantity: 3,
    })
    assert.notProperty(settings, 'billing_mode')
    assert.notProperty(fresh.settings ?? {}, 'billing_mode')
    assert.notProperty(fresh.settings ?? {}, 'monthly_fee_cents')
    assert.deepEqual(settings.email_notifications, {
      enabled: true,
      menu_published: false,
      deadline_reminder: true,
      holiday_cancellation: true,
      order_changed_by_staff: false,
      menu_change: true,
    })
  })

  test('invalid values are refused per field and nothing is saved', async ({ client, assert }) => {
    const { school, admin } = await setupMenuSchool()
    const cases: Array<[Record<string, unknown>, string]> = [
      [validForm({ schoolDays: [] }), 'schoolDays'],
      [validForm({ schoolDays: [0, 8] }), 'schoolDays.0'],
      [validForm({ schoolYearEnd: '2026-08-01' }), 'schoolYearEnd'],
      [validForm({ schoolYearEnd: '2028-08-01' }), 'schoolYearEnd'],
      [validForm({ schoolYearStart: '2026-02-30' }), 'schoolYearStart'],
      [validForm({}, { publish_time: '25:00' }), 'settings.publish_time'],
      [validForm({}, { deadline_weekday: 3, deadline_time: '08:00' }), 'settings.deadline_time'],
      [validForm({}, { edit_mode: 'whenever' }), 'settings.edit_mode'],
      [
        validForm({}, { reminder_hours_before_deadline: 0 }),
        'settings.reminder_hours_before_deadline',
      ],
      [validForm({}, { supplement_max_quantity: 21 }), 'settings.supplement_max_quantity'],
    ]
    for (const [body, field] of cases) {
      const response = await client
        .put('/admin/settings')
        .loginAs(admin)
        .withCsrfToken()
        .json(body)
        .redirects(0)
      const errors = response.flashMessage('inputErrorsBag') ?? {}
      assert.isTrue(field in errors, `${field} in ${JSON.stringify(errors)}`)
    }
    const fresh = await School.findOrFail(school.id)
    assert.deepEqual(fresh.settings, {
      allergens_enabled: true,
      labels_enabled: true,
      grade_enabled: true,
      class_enabled: true,
    })
    assert.equal(fresh.schoolYearEnd, '2027-06-11')
  })

  test('the support WhatsApp number is cleaned, cleared and refused without a country code', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await setupMenuSchool()
    const save = (support_whatsapp: string | null) =>
      client
        .put('/admin/settings')
        .loginAs(admin)
        .withCsrfToken()
        .json(validForm({}, { support_whatsapp }))
        .redirects(0)
    const stored = async () =>
      new SchoolSettingsService().get(await School.findOrFail(school.id)).support_whatsapp

    for (const typed of ['+212 6 12-34-56-78', '00212612345678', '212612345678']) {
      await save(typed)
      assert.equal(await stored(), '212612345678', typed)
    }

    for (const typed of ['0612345678', '+212', 'wa.me/212612345678', '+1234567890123456']) {
      const response = await save(typed)
      assert.properties(response.flashMessage('inputErrorsBag') ?? {}, [
        'settings.support_whatsapp',
      ])
      assert.equal(await stored(), '212612345678', typed)
    }

    await save('')
    assert.isNull(await stored())
  })

  test('the support number is shared with parents only', async ({ client, assert }) => {
    const { school, admin } = await setupMenuSchool()
    const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
    const shared = async (user: typeof admin) => {
      const url = user.role === 'parent' ? '/notifications' : '/admin/settings'
      const response = await client.get(url).loginAs(user).withInertia()
      response.assertStatus(200)
      return response.body().props.supportWhatsapp
    }

    assert.isNull(await shared(parent))

    school.settings = { ...school.settings, support_whatsapp: '212612345678' }
    await school.save()
    assert.equal(await shared(parent), '212612345678')
    assert.isNull(await shared(admin))
  })

  test('managers, kitchen, parents and admins of another school are refused', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const other = await setupMenuSchool()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
    const noSchoolAdmin = await UserFactory.apply('admin').merge({ schoolId: null }).create()

    for (const user of [manager, kitchen, parent, noSchoolAdmin]) {
      const page = await client.get('/admin/settings').loginAs(user)
      page.assertStatus(403)
      const update = await client
        .put('/admin/settings')
        .loginAs(user)
        .withCsrfToken()
        .json(validForm())
        .redirects(0)
      assert.include([302, 403], update.status())
    }
    // The other school's admin only ever edits their own school.
    await client
      .put('/admin/settings')
      .loginAs(other.admin)
      .withCsrfToken()
      .json(validForm())
      .redirects(0)
    assert.deepEqual((await School.findOrFail(school.id)).settings, {
      allergens_enabled: true,
      labels_enabled: true,
      grade_enabled: true,
      class_enabled: true,
    })
    assert.equal(
      (await app.container.make(SchoolSettingsService)).get(
        await School.findOrFail(other.school.id)
      ).publish_weekday,
      3
    )
  })
})
