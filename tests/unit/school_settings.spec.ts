import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import SchoolSettingsService, { DEFAULT_SCHOOL_SETTINGS } from '#services/school_settings_service'
import { SchoolFactory } from '#database/factories/school_factory'

test.group('SchoolSettingsService', (group) => {
  group.each.setup(() => testUtils.db().wrapInGlobalTransaction())

  test('returns every settings key with its default when settings = {}', async ({ assert }) => {
    const school = await SchoolFactory.merge({ settings: {} }).create()
    await school.refresh()

    const settings = new SchoolSettingsService().get(school)
    assert.deepEqual(settings, DEFAULT_SCHOOL_SETTINGS)
    assert.sameMembers(Object.keys(settings), [
      'publish_weekday',
      'publish_time',
      'deadline_weekday',
      'deadline_time',
      'reminder_hours_before_deadline',
      'allow_parent_edits',
      'edit_mode',
      'edit_cutoff_days_before',
      'edit_cutoff_time',
      'auto_assign_default_meal',
      'allergens_enabled',
      'labels_enabled',
      'grade_enabled',
      'class_enabled',
      'allergy_rule',
      'generate_moroccan_holidays',
      'ics_calendar_url',
      'email_notifications',
      'subscription_required_for_main_meal',
      'supplement_max_quantity',
      'label_grid',
    ])
    assert.equal(settings.publish_weekday, 4)
    assert.equal(settings.deadline_time, '20:00')
    assert.equal(settings.edit_cutoff_time, '18:00')
  })

  test('deep-merges stored values over the defaults and ignores unknown keys', async ({
    assert,
  }) => {
    const school = await SchoolFactory.merge({
      settings: {
        publish_time: '09:30',
        email_notifications: { deadline_reminder: false },
        label_grid: { cols: 2 },
        // @ts-expect-error unknown key left in the database
        legacy_key: true,
      },
    }).create()
    await school.refresh()

    const settings = new SchoolSettingsService().get(school)
    assert.equal(settings.publish_time, '09:30')
    assert.isFalse(settings.email_notifications.deadline_reminder)
    assert.isTrue(settings.email_notifications.enabled)
    assert.deepEqual(settings.label_grid, { cols: 2, rows: 8 })
    assert.notProperty(settings, 'legacy_key')
  })

  test('update validates and saves a partial change', async ({ assert }) => {
    const school = await SchoolFactory.create()
    const service = new SchoolSettingsService()

    const next = await service.update(school, {
      edit_mode: 'same_day_only',
      email_notifications: { menu_published: false },
    })
    assert.equal(next.edit_mode, 'same_day_only')

    await school.refresh()
    const stored = service.get(school)
    assert.equal(stored.edit_mode, 'same_day_only')
    assert.isFalse(stored.email_notifications.menu_published)
    assert.isTrue(stored.email_notifications.enabled)
  })

  test('update rejects invalid values', async ({ assert }) => {
    const school = await SchoolFactory.create()
    const service = new SchoolSettingsService()

    await assert.rejects(() => service.update(school, { publish_time: '25:00' }))
    await assert.rejects(() => service.update(school, { ics_calendar_url: 'http://insecure.test' }))
    await assert.rejects(() => service.update(school, { supplement_max_quantity: 0 }))
  })
})
