/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import Meal from '#models/meal'
import MenuItem from '#models/menu_item'
import MenuTemplate from '#models/menu_template'
import MealService from '#services/meal_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { DateTime } from 'luxon'
import {
  FRI,
  MON,
  SAT,
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

async function rejectsWith(assert: any, promise: Promise<unknown>, key: string) {
  try {
    await promise
  } catch (error) {
    assert.instanceOf(error, BusinessRuleException)
    assert.equal((error as BusinessRuleException).messageKey, key)
    return
  }
  assert.fail(`expected ${key}`)
}

test.group('Menus | default meal rule', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('the first subscription meal of a day becomes its default; supplements never do', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const [a, b] = [await subscriptionMeal(), await subscriptionMeal()]
    const juice = await supplementMeal()

    const first = await addItem(school, manager, MON, juice)
    const second = await addItem(school, manager, MON, a)
    const third = await addItem(school, manager, MON, b)
    assert.isFalse(first.isDefault)
    assert.isTrue(second.isDefault)
    assert.isFalse(third.isDefault)
    assert.equal(second.mealType, 'subscription')
    assert.equal(first.mealType, 'supplement')

    const menu = await menuOf(school)
    assert.equal(menu.status, 'draft')
    assert.equal(menu.createdBy, manager.id)
  })

  test('set default swaps it; a supplement cannot be the default', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    const service = await builder()
    const a = await addItem(school, manager, MON, await subscriptionMeal())
    const b = await addItem(school, manager, MON, await subscriptionMeal())
    const s = await addItem(school, manager, MON, await supplementMeal())
    const menu = await menuOf(school)

    await service.setDefault(school, menu, b.id, manager)
    const items = await itemsOf(menu.id)
    assert.deepEqual(
      items.filter((item) => item.isDefault).map((item) => item.id),
      [b.id]
    )
    assert.notEqual(a.id, b.id)
    await rejectsWith(
      assert,
      service.setDefault(school, menu, s.id, manager),
      'menus.errors.default_supplement'
    )
  })

  test('removing the default promotes the next subscription meal of that day', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const service = await builder()
    const a = await addItem(school, manager, MON, await subscriptionMeal())
    const b = await addItem(school, manager, MON, await subscriptionMeal())
    await addItem(school, manager, TUE, await subscriptionMeal())
    const menu = await menuOf(school)

    await service.removeItem(school, menu, a.id, manager)
    const monday = (await itemsOf(menu.id)).filter((item) => item.date === MON)
    assert.deepEqual(
      monday.map((item) => [item.id, item.isDefault]),
      [[b.id, true]]
    )
  })

  test('the database refuses two defaults on one day', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    await addItem(school, manager, MON, await subscriptionMeal())
    const b = await addItem(school, manager, MON, await subscriptionMeal())
    await assert.rejects(
      () => db.from('menu_items').where('id', b.id).update({ is_default: true }),
      /menu_items_one_default_per_day/
    )
  })

  test('scheduling refuses a day with subscription meals but no default', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    await addItem(school, manager, MON, await subscriptionMeal())
    const menu = await menuOf(school)
    await db.from('menu_items').where('weekly_menu_id', menu.id).update({ is_default: false })
    await rejectsWith(
      assert,
      (await statusService()).schedule(school, menu, manager),
      'menus.errors.not_ready'
    )
    assert.equal((await menuOf(school)).status, 'draft')
  })
})

test.group('Menus | days that cannot receive meals', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a holiday day is locked: adding a meal is refused', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    await addHoliday(school, THU, 'Thanksgiving')
    await rejectsWith(
      assert,
      addItem(school, manager, THU, await subscriptionMeal()),
      'menus.errors.holiday'
    )
    // The whole write rolled back: not even the draft menu was created.
    assert.lengthOf(await MenuItem.all(), 0)
    assert.isNull(await (await builder()).findWeek(school.id, WEEK))
  })

  test('a disabled holiday does not lock the day', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    const holiday = await addHoliday(school, THU)
    holiday.isActive = false
    await holiday.save()
    const item = await addItem(school, manager, THU, await subscriptionMeal())
    assert.equal(item.date, THU)
  })

  test('weekends, dates of another week and days outside the school year are refused', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const meal = await subscriptionMeal()
    await rejectsWith(assert, addItem(school, manager, SAT, meal), 'menus.errors.not_school_day')
    await rejectsWith(
      assert,
      addItem(school, manager, '2026-11-30', meal),
      'menus.errors.date_outside_week'
    )
    // The school year ends on Friday 2027-06-11.
    await rejectsWith(
      assert,
      addItem(school, manager, '2027-06-14', meal, '2027-06-14'),
      'menus.errors.not_school_day'
    )
  })

  test('inactive, deleted and duplicate meals are refused', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    const inactive = await subscriptionMeal({ isActive: false })
    const deleted = await subscriptionMeal({ isActive: false, deletedAt: DateTime.now() })
    await rejectsWith(
      assert,
      addItem(school, manager, MON, inactive),
      'menus.errors.meal_unavailable'
    )
    await rejectsWith(
      assert,
      addItem(school, manager, MON, deleted),
      'menus.errors.meal_unavailable'
    )
    const meal = await subscriptionMeal()
    await addItem(school, manager, MON, meal)
    await rejectsWith(assert, addItem(school, manager, MON, meal), 'menus.errors.duplicate')
    await addItem(school, manager, TUE, meal)
  })

  test('the builder page shows holiday days greyed out and locked', async ({ client, assert }) => {
    const { school, manager } = await setupMenuSchool()
    await addHoliday(school, THU, 'Thanksgiving')
    await addHoliday(school, FRI, 'Day after Thanksgiving')
    await addItem(school, manager, MON, await subscriptionMeal())

    const response = await client.get(`/admin/menus/${WEEK}`).loginAs(manager).withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('admin/menus/show')
    const props = response.inertiaProps as any
    assert.deepEqual(
      props.days.map((day: any) => [day.date, day.state]),
      [
        [MON, 'open'],
        [TUE, 'open'],
        ['2026-11-25', 'open'],
        [THU, 'holiday'],
        [FRI, 'holiday'],
      ]
    )
    assert.deepEqual(props.days[3].holidayNames, ['Thanksgiving'])
    const card = props.days[0].items[0]
    // D31: a subscription meal has no price (the UI shows "included").
    assert.isNull(card.meal.price)
    assert.equal(card.meal.priceCents, 0)
    assert.properties(card.meal, ['name', 'cover', 'allergens'])
  })

  test('a date that is not a Monday redirects to its week; garbage is a 404', async ({
    client,
  }) => {
    const { manager } = await setupMenuSchool()
    const wednesday = await client.get('/admin/menus/2026-11-25').loginAs(manager).redirects(0)
    wednesday.assertStatus(302)
    wednesday.assertHeader('location', `/admin/menus/${WEEK}`)
    const invalid = await client.get('/admin/menus/2026-13-45').loginAs(manager)
    invalid.assertStatus(404)
    const post = await client
      .post('/admin/menus/2026-11-25/items')
      .loginAs(manager)
      .withCsrfToken()
      .json({ date: '2026-11-25', mealId: 1 })
      .redirects(0)
    post.assertStatus(404)
  })
})

test.group('Menus | published and closed menus', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a published menu accepts new items; an item without orders can be removed', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await scheduledMenu(school, manager)
    await (await statusService()).publishNow(menu, manager)

    const extra = await supplementMeal()
    const add = await client
      .post(`/admin/menus/${WEEK}/items`)
      .loginAs(manager)
      .withCsrfToken()
      .json({ date: TUE, mealId: extra.id })
      .redirects(0)
    add.assertStatus(302)
    const items = await itemsOf(menu.id)
    assert.lengthOf(items, 2)

    // Phase 6: no order contains it, so it goes (orders are covered in tests/functional/orders).
    const supplement = items.find((item) => item.mealType === 'supplement')!
    const remove = await client
      .delete(`/admin/menus/${WEEK}/items/${supplement.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    remove.assertStatus(302)
    assert.isUndefined(remove.flashMessage('error'))
    assert.lengthOf(await itemsOf(menu.id), 1)
  })

  test('a closed menu is read-only', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await scheduledMenu(school, manager)
    const status = await statusService()
    await status.publishNow(menu, manager)
    await status.close(menu)
    await rejectsWith(
      assert,
      addItem(school, manager, TUE, await subscriptionMeal()),
      'menus.errors.closed'
    )
    const [item] = await itemsOf(menu.id)
    await rejectsWith(
      assert,
      (await builder()).updateItem(school, menu, item.id, { maxQuantity: 3 }, manager),
      'menus.errors.closed'
    )
  })

  test('max quantity can be set and cleared; zero is refused', async ({ client, assert }) => {
    const { school, manager } = await setupMenuSchool()
    const item = await addItem(school, manager, MON, await subscriptionMeal())
    const url = `/admin/menus/${WEEK}/items/${item.id}`
    await client.put(url).loginAs(manager).withCsrfToken().json({ maxQuantity: 40 }).redirects(0)
    assert.equal((await MenuItem.findOrFail(item.id)).maxQuantity, 40)
    const zero = await client
      .put(url)
      .loginAs(manager)
      .withCsrfToken()
      .json({ maxQuantity: 0 })
      .redirects(0)
    assert.property(zero.flashMessage('inputErrorsBag'), 'maxQuantity')
    assert.equal((await MenuItem.findOrFail(item.id)).maxQuantity, 40)
    await client.put(url).loginAs(manager).withCsrfToken().json({ maxQuantity: null }).redirects(0)
    assert.isNull((await MenuItem.findOrFail(item.id)).maxQuantity)
  })
})

test.group('Menus | meal type lock (Phase 3 follow-up)', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a meal on a menu or a template cannot change type; other edits pass', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const meals = await app.container.make(MealService)
    const onMenu = await subscriptionMeal()
    const onTemplate = await subscriptionMeal()
    const free = await subscriptionMeal()
    await addItem(school, manager, MON, onMenu)
    const template = await MenuTemplate.create({ schoolId: school.id, name: 'T', createdBy: null })
    await db.table('menu_template_items').insert({
      menu_template_id: template.id,
      weekday: 1,
      meal_id: onTemplate.id,
      meal_type: 'subscription',
    })

    const input = (meal: Meal, type: 'subscription' | 'supplement') => ({
      nameFr: `${meal.nameFr} bis`,
      nameEn: meal.nameEn,
      type,
      category: meal.category,
      price: type === 'supplement' ? 1200 : undefined,
    })
    for (const meal of [onMenu, onTemplate]) {
      await rejectsWith(
        assert,
        meals.update(meal, input(meal, 'supplement')),
        'meals.errors.type_locked'
      )
      assert.equal((await Meal.findOrFail(meal.id)).type, 'subscription')
      const renamed = await meals.update(meal, input(meal, 'subscription'))
      assert.equal(renamed.nameFr, `${meal.nameFr} bis`)
    }
    const changed = await meals.update(free, input(free, 'supplement'))
    assert.equal(changed.type, 'supplement')
  })

  test('adding a meal waits for a concurrent type change (row lock) and sees its result', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const meal = await subscriptionMeal()
    // Hold the meal row FOR UPDATE (as MealService.update does) in another transaction.
    const trx = await db.transaction()
    await trx.from('meals').where('id', meal.id).forUpdate().select('id')
    let settled = false
    const pending = addItem(school, manager, MON, meal).finally(() => (settled = true))
    await new Promise((resolve) => setTimeout(resolve, 150))
    assert.isFalse(settled, 'addItem must wait for the meal row lock')
    await trx.from('meals').where('id', meal.id).update({ is_active: false })
    await trx.commit()
    await rejectsWith(assert, pending, 'menus.errors.meal_unavailable')
  })
})
