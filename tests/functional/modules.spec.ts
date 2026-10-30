/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { UserFactory } from '#database/factories/user_factory'
import { SchoolFactory } from '#database/factories/school_factory'
import MealOrder from '#models/meal_order'
import School from '#models/school'
import ProductionReportService from '#services/production_report_service'
import SchoolSettingsService from '#services/school_settings_service'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { jobs } from '#tests/helpers/menus'
import { family, orderSchool, orders, TUE } from '#tests/helpers/orders'
import { checkSelection, describeOption, type DayOption } from '#services/order_window_service'

const OFF = { allergens_enabled: false, labels_enabled: false }

const nuts: DayOption = {
  menuItemId: 1,
  mealId: 1,
  mealType: 'subscription',
  isDefault: true,
  maxQuantity: null,
  mealAvailable: true,
  allergens: ['nuts'],
  priceCents: 0,
  orderedElsewhere: 0,
}
const rules = { allergyRule: 'off' as const, supplementMaxQuantity: 5, subscriptionRequired: true }

test.group('Optional modules (D33)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('both modules are off when the school never chose', ({ assert }) => {
    assert.deepEqual(new SchoolSettingsService().features({ settings: {} }), {
      allergens: false,
      labels: false,
      grade: false,
      className: false,
    })
  })

  test('allergy rule off: nothing blocked, flagged or asked', ({ assert }) => {
    const result = checkSelection({
      request: { subscriptionMealId: 1, supplements: [] },
      options: [nuts],
      existing: [],
      childAllergies: ['nuts'],
      hasSubscription: true,
      rules,
    })
    assert.isTrue(result.ok)
    const flags = describeOption(nuts, {
      childAllergies: ['nuts'],
      hasSubscription: true,
      rules,
      existingQty: 0,
    })
    assert.deepEqual(flags.allergyConflicts, [])
    assert.isFalse(flags.allergyBlocked)
    assert.isFalse(flags.needsAllergyConfirm)
  })

  test('modules off: kitchen pages and the PDF answer 404', async ({ client }) => {
    const school = await SchoolFactory.merge({ settings: OFF }).create()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    for (const path of ['/kitchen/allergies', '/kitchen/labels', '/kitchen/labels/pdf']) {
      const response = await client.get(path).loginAs(kitchen)
      response.assertStatus(404)
    }
  })

  test('modules on: kitchen pages open', async ({ client }) => {
    const school = await SchoolFactory.create()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    for (const path of ['/kitchen/allergies', '/kitchen/labels']) {
      const response = await client.get(path).loginAs(kitchen).withInertia()
      response.assertStatus(200)
    }
  })

  test('every page receives the school modules', async ({ client, assert }) => {
    const school = await SchoolFactory.merge({
      settings: { allergens_enabled: false, labels_enabled: true, class_enabled: true },
    }).create()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const response = await client.get('/kitchen').loginAs(kitchen).withInertia()
    assert.deepEqual(response.body().props.features, {
      allergens: false,
      labels: true,
      grade: false,
      className: true,
    })
  })

  test('allergens off: a parent can order the meal, the deadline job assigns it', async ({
    assert,
  }) => {
    const { school, main, alt } = await orderSchool({ allergens_enabled: false })
    main.allergens = ['eggs']
    await main.save()
    const allergic = await family(school, { allergies: ['eggs', 'nuts'] })
    const other = await family(school, { allergies: ['nuts'] })
    freezeClock('2026-11-20T12:00')
    const saved = await (
      await orders()
    ).saveDay(
      other.child.id,
      TUE,
      { subscriptionMealId: alt.id, supplements: [] },
      { user: other.parent }
    )
    assert.equal(saved.order.status, 'active')

    freezeClock('2026-11-22T20:00')
    const run = await (await jobs()).applyDeadline()
    if (!run.acquired) return assert.fail('lock')
    assert.isUndefined(run.result[0].days.find((day) => day.date === TUE)!.skipped.allergy)
    assert.lengthOf(
      await MealOrder.query().where('child_id', allergic.child.id).where('date', TUE),
      1
    )
  })

  test('turning a module off in the settings keeps the allergy rule', async ({ assert }) => {
    const school = await SchoolFactory.merge({
      settings: { allergens_enabled: true, allergy_rule: 'warn_confirm' },
    }).create()
    const service = new SchoolSettingsService()
    await service.update(school, { allergens_enabled: false })
    const fresh = service.get(await School.findOrFail(school.id))
    assert.isFalse(fresh.allergens_enabled)
    assert.equal(fresh.allergy_rule, 'warn_confirm')
  })

  test('Niveau / Classe off: the summary export merges their rows, hidden from labels', async ({
    assert,
    client,
  }) => {
    const { school, main, manager } = await orderSchool({
      grade_enabled: false,
      class_enabled: false,
    })
    const a = await family(school, { child: { grade: 'G1', className: '1A' } })
    const b = await family(school, { child: { grade: 'G2', className: '2B' } })
    freezeClock('2026-11-20T12:00')
    const service = await orders()
    for (const f of [a, b]) {
      await service.saveDay(
        f.child.id,
        TUE,
        { subscriptionMealId: main.id, supplements: [] },
        { user: f.parent }
      )
    }
    const reports = new ProductionReportService()
    const filters = { from: TUE, to: TUE, mergeGrades: true, mergeClasses: true }
    assert.equal(await reports.countExportRows(school.id, filters, 'summary'), 1)
    const page = await reports.exportSummary(school.id, filters).next()
    assert.equal(page.value?.[0].quantity, 2)
    assert.isNull(page.value?.[0].grade)

    const response = await client
      .get(`/kitchen/exports/download?period=day&date=${TUE}&kind=detail&format=csv`)
      .loginAs(manager)
    response.assertStatus(200)
    assert.notInclude(response.text(), '1A')
    assert.notInclude(response.text(), 'G1')
  })
})
