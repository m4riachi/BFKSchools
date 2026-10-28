/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import type Meal from '#models/meal'
import MenuTemplate from '#models/menu_template'
import MenuTemplateItem from '#models/menu_template_item'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { addDays } from '#support/dates'
import {
  MON,
  THU,
  TUE,
  WEEK,
  addHoliday,
  addItem,
  builder,
  itemsOf,
  menuOf,
  scheduledMenu,
  setupMenuSchool,
  statusService,
  subscriptionMeal,
  supplementMeal,
} from '#tests/helpers/menus'

const PREV = addDays(WEEK, -7)

async function expectRule(assert: any, promise: Promise<unknown>, key: string) {
  try {
    await promise
  } catch (error) {
    assert.instanceOf(error, BusinessRuleException)
    assert.equal((error as BusinessRuleException).messageKey, key)
    return
  }
  assert.fail(`expected ${key}`)
}

/**
 * Previous week (16–20 Nov): Mon = A (default), B, juice; Tue = C (default);
 * Thu = D (default). This week: Thursday 26 Nov is Thanksgiving.
 */
async function seedPreviousWeek() {
  const ctx = await setupMenuSchool()
  const { school, manager } = ctx
  const meals = {
    a: await subscriptionMeal({ nameFr: 'Plat A', nameEn: 'Dish A' }),
    b: await subscriptionMeal({ nameFr: 'Plat B', nameEn: 'Dish B' }),
    c: await subscriptionMeal({ nameFr: 'Plat C', nameEn: 'Dish C' }),
    d: await subscriptionMeal({ nameFr: 'Plat D', nameEn: 'Dish D' }),
    juice: await supplementMeal({ nameFr: 'Jus', nameEn: 'Juice' }),
  }
  await addItem(school, manager, PREV, meals.a, PREV)
  await addItem(school, manager, PREV, meals.b, PREV)
  await addItem(school, manager, PREV, meals.juice, PREV)
  await addItem(school, manager, addDays(PREV, 1), meals.c, PREV)
  await addItem(school, manager, addDays(PREV, 3), meals.d, PREV)
  await addHoliday(school, THU, 'Thanksgiving')
  return { ...ctx, meals }
}

async function deactivate(meal: Meal, deleted = false) {
  meal.isActive = false
  if (deleted) meal.deletedAt = DateTime.now()
  await meal.save()
}

test.group('Menus | copy previous week', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('copies by weekday, skips the holiday and inactive/deleted meals, and reports them', async ({
    assert,
  }) => {
    const { school, manager, meals } = await seedPreviousWeek()
    await deactivate(meals.a) // Monday's default
    await deactivate(meals.c, true) // Tuesday's only dish, deleted

    const report = await (await builder()).copyPreviousWeek(school, WEEK, manager)
    const menu = await menuOf(school)
    const items = await itemsOf(menu.id)

    assert.sameDeepMembers(
      items.map((item) => [item.date, item.mealId, item.isDefault]),
      [
        [MON, meals.b.id, true],
        [MON, meals.juice.id, false],
      ]
    )
    assert.equal(report.added, 2)
    assert.deepEqual(report.skippedDays, [
      { date: THU, reason: 'holiday', names: ['Thanksgiving'] },
    ])
    assert.sameMembers(
      report.skippedMeals.map((meal) => meal.mealId),
      [meals.a.id, meals.c.id]
    )
    assert.deepEqual(report.newDefaults, [MON])
  })

  test('replaces the draft items and is refused once the menu is scheduled', async ({ assert }) => {
    const { school, manager, meals } = await seedPreviousWeek()
    const service = await builder()
    await addItem(school, manager, TUE, await subscriptionMeal())
    await service.copyPreviousWeek(school, WEEK, manager)
    const menu = await menuOf(school)
    const items = await itemsOf(menu.id)
    assert.sameMembers(
      items.map((item) => item.mealId),
      [meals.a.id, meals.b.id, meals.juice.id, meals.c.id]
    )

    await (await statusService()).schedule(school, menu, manager)
    await expectRule(
      assert,
      service.copyPreviousWeek(school, WEEK, manager),
      'menus.errors.not_draft'
    )
  })

  test('refused when the previous week has no menu', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    await expectRule(
      assert,
      (await builder()).copyPreviousWeek(school, WEEK, manager),
      'menus.errors.no_previous_week'
    )
  })

  test('HTTP: the report is flashed and shown on the builder', async ({ client, assert }) => {
    const { manager } = await seedPreviousWeek()
    const response = await client
      .post(`/admin/menus/${WEEK}/copy-previous`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', `/admin/menus/${WEEK}`)
    const report = response.flashMessage('menuReport') as any
    assert.equal(report.kind, 'copy')
    assert.equal(report.added, 4)
    assert.deepEqual(report.skippedDays[0], {
      date: THU,
      reason: 'holiday',
      names: ['Thanksgiving'],
    })
  })
})

test.group('Menus | templates', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('save as template stores items by weekday and leaves out inactive meals', async ({
    assert,
  }) => {
    const { school, manager, meals } = await seedPreviousWeek()
    const service = await builder()
    const previous = await menuOf(school, PREV)
    await deactivate(meals.juice)

    const result = await service.saveAsTemplate(
      school,
      previous,
      { name: 'Semaine type', description: 'Automne' },
      manager
    )
    assert.equal(result.added, 4)
    assert.deepEqual(
      result.skippedMeals.map((meal) => meal.mealId),
      [meals.juice.id]
    )
    const rows = await MenuTemplateItem.query()
      .where('menu_template_id', result.template.id)
      .orderBy('weekday')
      .orderBy('position')
    assert.sameDeepMembers(
      rows.map((row) => [row.weekday, row.mealId, row.isDefault]),
      [
        [1, meals.a.id, true],
        [1, meals.b.id, false],
        [2, meals.c.id, true],
        [4, meals.d.id, true],
      ]
    )

    await expectRule(
      assert,
      service.saveAsTemplate(school, previous, { name: 'SEMAINE TYPE' }, manager),
      'menus.errors.template_name_taken'
    )
  })

  test('apply template skips holidays and inactive meals and reports them', async ({ assert }) => {
    const { school, manager, meals } = await seedPreviousWeek()
    const service = await builder()
    const { template } = await service.saveAsTemplate(
      school,
      await menuOf(school, PREV),
      { name: 'Base' },
      manager
    )
    await deactivate(meals.b)

    const report = await service.applyTemplate(school, WEEK, template, manager)
    const items = await itemsOf((await menuOf(school)).id)
    assert.sameDeepMembers(
      items.map((item) => [item.date, item.mealId, item.isDefault]),
      [
        [MON, meals.a.id, true],
        [MON, meals.juice.id, false],
        [TUE, meals.c.id, true],
      ]
    )
    assert.deepEqual(report.skippedDays, [
      { date: THU, reason: 'holiday', names: ['Thanksgiving'] },
    ])
    assert.deepEqual(
      report.skippedMeals.map((meal) => meal.mealId),
      [meals.b.id]
    )
    assert.deepEqual(report.newDefaults, [])
  })

  test('templates of another school are not reachable; apply needs a draft', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const other = await setupMenuSchool()
    const foreign = await MenuTemplate.create({
      schoolId: other.school.id,
      name: 'Foreign',
      createdBy: null,
    })
    const apply = await client
      .post(`/admin/menus/${WEEK}/apply-template`)
      .loginAs(manager)
      .withCsrfToken()
      .json({ templateId: foreign.id })
      .redirects(0)
    apply.assertStatus(404)
    const destroy = await client
      .delete(`/admin/menu-templates/${foreign.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    destroy.assertStatus(404)
    assert.isNotNull(await MenuTemplate.find(foreign.id))

    const mine = await MenuTemplate.create({ schoolId: school.id, name: 'Mine', createdBy: null })
    await MenuTemplateItem.create({
      menuTemplateId: mine.id,
      weekday: 1,
      mealId: (await subscriptionMeal()).id,
      mealType: 'subscription',
      position: 0,
      isDefault: true,
      maxQuantity: null,
    })
    const menu = await scheduledMenu(school, manager)
    await expectRule(
      assert,
      (await builder()).applyTemplate(school, WEEK, mine, manager),
      'menus.errors.not_draft'
    )
    assert.lengthOf(await itemsOf(menu.id), 1)
  })
})
