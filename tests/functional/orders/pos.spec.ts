/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import MealOrder from '#models/meal_order'
import OrderAuditLog from '#models/order_audit_log'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { family, orderSchool, orders, TUE } from '#tests/helpers/orders'

test.group('Ordering desk', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('staff find a family of their school by parent or child name', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await orderSchool()
    const { parent, child } = await family(school, {
      parent: { fullName: 'Samira Alaoui' },
      child: { firstName: 'Yanis' },
    })
    await family(school, { parent: { fullName: 'Karim Tazi' }, child: { firstName: 'Lina' } })
    const otherSchool = await SchoolFactory.create()
    await family(otherSchool, { parent: { fullName: 'Samira Autre' } })

    const names = async (q: string) =>
      (await client.get('/admin/pos').qs({ q }).loginAs(admin).withInertia())
        .body()
        .props.families.map((row: { fullName: string }) => row.fullName)
    assert.deepEqual(await names('samira'), ['Samira Alaoui'])
    assert.deepEqual(await names('yanis'), ['Samira Alaoui'])
    assert.deepEqual(await names('100%'), [])

    const page = await client.get('/admin/pos').qs({ q: 'samira' }).loginAs(admin).withInertia()
    assert.equal(page.body().props.families[0].id, parent.id)
    assert.equal(page.body().props.families[0].children[0].id, child.id)
    assert.isNull(page.body().props.selected)
  })

  test('picking a child shows the week and the other children', async ({ client, assert }) => {
    const { school, admin } = await orderSchool()
    const { child } = await family(school, { child: { firstName: 'Yanis' } })
    freezeClock('2026-11-20T12:00')
    const page = await client
      .get('/admin/pos')
      .qs({ child: child.id, week: TUE })
      .loginAs(admin)
      .withInertia()
    page.assertStatus(200)
    const selected = page.body().props.selected
    assert.equal(selected.child.firstName, 'Yanis')
    assert.equal(selected.week.start, '2026-11-23')
    assert.lengthOf(selected.view.days, 5)
  })

  test('an order is created for the parent, tagged and audited with no typing', async ({
    client,
    assert,
  }) => {
    const { school, admin, main, juice } = await orderSchool()
    const { child } = await family(school)
    freezeClock('2026-11-20T12:00')
    const response = await client
      .post(`/admin/pos/children/${child.id}/days/${TUE}`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 2 }] })
      .redirects(0)
    response.assertStatus(302)
    assert.isDefined(response.flashMessage('success'))

    const order = await MealOrder.query()
      .where('child_id', child.id)
      .where('date', TUE)
      .firstOrFail()
    assert.equal(order.status, 'active')
    assert.equal(order.origin, 'staff')
    const audit = await OrderAuditLog.query().where('meal_order_id', order.id).firstOrFail()
    assert.equal(audit.action, 'staff_override')
    assert.isAbove((audit.reason ?? '').length, 3)
  })

  test('the tag follows who chose last', async ({ client, assert }) => {
    const { school, admin, main, alt } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock('2026-11-20T12:00')
    const service = await orders()
    const originOf = async () =>
      (await MealOrder.query().where('child_id', child.id).where('date', TUE).firstOrFail()).origin

    await service.saveDay(
      child.id,
      TUE,
      { subscriptionMealId: main.id, supplements: [] },
      { user: parent }
    )
    assert.equal(await originOf(), 'parent')

    await client
      .post(`/admin/pos/children/${child.id}/days/${TUE}`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ subscriptionMealId: alt.id, supplements: [] })
      .redirects(0)
    assert.equal(await originOf(), 'staff')

    await service.saveDay(
      child.id,
      TUE,
      { subscriptionMealId: main.id, supplements: [] },
      { user: parent }
    )
    assert.equal(await originOf(), 'parent')
  })

  test('staff can cancel a day; the rules still apply', async ({ client, assert }) => {
    const { school, admin, main } = await orderSchool()
    const { child } = await family(school, { subscribed: false })
    freezeClock('2026-11-20T12:00')

    // No subscription: the main meal is refused, nothing is created.
    await client
      .post(`/admin/pos/children/${child.id}/days/${TUE}`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ subscriptionMealId: main.id, supplements: [] })
      .redirects(0)
    assert.lengthOf(await MealOrder.query().where('child_id', child.id), 0)

    const cancelled = await client
      .post(`/admin/pos/children/${child.id}/days/${TUE}/cancel`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    cancelled.assertStatus(302)
    const order = await MealOrder.query().where('child_id', child.id).firstOrFail()
    assert.equal(order.status, 'cancelled')
  })

  test('only admins and managers of the school', async ({ client, assert }) => {
    const { school, admin, manager, main } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock('2026-11-20T12:00')

    for (const user of [admin, manager]) {
      const page = await client.get('/admin/pos').loginAs(user).withInertia()
      page.assertStatus(200)
    }
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    for (const user of [kitchen, parent]) {
      const page = await client.get('/admin/pos').loginAs(user).header('Accept', 'application/json')
      page.assertStatus(403)
      const save = await client
        .post(`/admin/pos/children/${child.id}/days/${TUE}`)
        .loginAs(user)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json({ subscriptionMealId: main.id, supplements: [] })
      save.assertStatus(403)
    }

    const otherSchool = await SchoolFactory.create()
    const stranger = await UserFactory.apply('admin').merge({ schoolId: otherSchool.id }).create()
    const page = await client
      .get('/admin/pos')
      .qs({ child: child.id })
      .loginAs(stranger)
      .header('Accept', 'application/json')
    page.assertStatus(404)
    const save = await client
      .post(`/admin/pos/children/${child.id}/days/${TUE}`)
      .loginAs(stranger)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ subscriptionMealId: main.id, supplements: [] })
    save.assertStatus(404)
    assert.lengthOf(await MealOrder.query().where('child_id', child.id), 0)
  })
})
