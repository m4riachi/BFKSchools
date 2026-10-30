/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import MealOrder from '#models/meal_order'
import OrderAuditLog from '#models/order_audit_log'
import { UserFactory } from '#database/factories/user_factory'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { addHoliday, scheduledMenu, setupMenuSchool } from '#tests/helpers/menus'
import { TUE, WED, addChild, family, orderOf, orderSchool, orders } from '#tests/helpers/orders'

const OPEN = '2026-11-20T12:00'

type Props = Record<string, any>

test.group('Orders | parent portal', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  for (const [label, now] of [
    ['Saturday', '2026-11-21T10:00'],
    ['Sunday', '2026-11-22T10:00'],
  ]) {
    test(`on ${label} the default week is next week and Monday is put forward`, async ({
      client,
      assert,
    }) => {
      const { school } = await orderSchool()
      const { parent } = await family(school)
      freezeClock(now)
      const response = await client.get('/').loginAs(parent).withInertia()
      const props = response.inertiaProps as Props
      assert.equal(props.week.start, '2026-11-23')
      const focused = (props.view.days as Props[]).filter((d) => d.isFocus)
      assert.deepEqual(
        focused.map((d) => d.date),
        ['2026-11-23']
      )
      assert.isFalse(focused[0].isToday)
    })
  }

  test('another week opens on its Monday, without the current-day highlight', async ({
    client,
    assert,
  }) => {
    const { school } = await orderSchool()
    const { parent } = await family(school)
    freezeClock('2026-11-17T10:00')
    const response = await client.get('/?week=2026-11-23').loginAs(parent).withInertia()
    const days = (response.inertiaProps as Props).view.days as Props[]
    assert.deepEqual(
      days.filter((d) => d.isFocus).map((d) => d.date),
      ['2026-11-23']
    )
    assert.isEmpty(days.filter((d) => d.isCurrent))
  })

  test('on a school day the current week is shown and today is put forward', async ({
    client,
    assert,
  }) => {
    const { school } = await orderSchool()
    const { parent } = await family(school)
    freezeClock('2026-11-24T10:00')
    const response = await client.get('/').loginAs(parent).withInertia()
    const props = response.inertiaProps as Props
    assert.equal(props.week.start, '2026-11-23')
    const focused = (props.view.days as Props[]).filter((d) => d.isFocus)
    assert.deepEqual(
      focused.map((d) => d.date),
      [TUE]
    )
    assert.isTrue(focused[0].isToday)
  })

  test('the week view comes from the server: states, reasons, flags, totals', async ({
    client,
    assert,
  }) => {
    const { school, main, alt, juice } = await orderSchool()
    const { parent, child } = await family(school, { allergies: ['nuts'] })
    const sibling = await addChild(parent, { subscribed: false })
    await addHoliday(school, WED, 'Storm day')
    freezeClock(OPEN)
    await (
      await orders()
    ).saveDay(
      child.id,
      TUE,
      { subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 2 }] },
      { user: parent }
    )
    const response = await client
      .get(`/?week=2026-11-23&child=${child.id}`)
      .loginAs(parent)
      .withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('parent/orders/week')
    const props = response.inertiaProps as Props
    assert.equal(props.childId, child.id)
    const days = props.view.days as Props[]
    const tue = days.find((d) => d.date === TUE)!
    assert.equal(tue.state, 'open')
    assert.isFalse(tue.isToday) // the clock is frozen before this week
    // D31: the day total is the extras only; the subscription meal has no price.
    assert.equal(tue.totalCents, 2000)
    const mainDish = tue.options.find((o: Props) => o.mealId === main.id)
    assert.isNull(mainDish.price)
    assert.equal(mainDish.priceCents, 0)
    const juiceDish = tue.options.find((o: Props) => o.mealId === juice.id)
    assert.match(juiceDish.price, /^10,00\s?MAD$/)
    const mainLine = tue.order.lines.find((l: Props) => l.type === 'subscription')
    assert.isNull(mainLine.unitPrice)
    assert.isNull(mainLine.lineTotal)
    // Week, child and family totals: extras only.
    assert.equal(props.children.find((c: Props) => c.id === child.id).totalCents, 2000)
    const nutDish = tue.options.find((o: Props) => o.mealId === alt.id)
    assert.isTrue(nutDish.allergyBlocked)
    assert.equal(nutDish.maxQty, 0)
    const wed = days.find((d) => d.date === WED)!
    assert.equal(wed.state, 'holiday')
    assert.equal(wed.reason, 'HOLIDAY')
    assert.deepEqual(wed.holidayNames, ['Storm day'])
    assert.equal(props.family.totalCents, 2000) // D31: extras only
    assert.lengthOf(props.children, 2)

    // The unsubscribed sibling: main meals flagged, extras open.
    const siblingView = await client
      .get(`/?week=2026-11-23&child=${sibling.id}`)
      .loginAs(parent)
      .withInertia()
    const sTue = (siblingView.inertiaProps as Props).view.days.find((d: Props) => d.date === TUE)
    assert.isTrue(sTue.options.find((o: Props) => o.mealId === main.id).noSubscription)
    assert.isFalse(sTue.options.find((o: Props) => o.mealId === juice.id).noSubscription)
  })

  test('an unpublished week shows its state but never its dishes', async ({ client, assert }) => {
    const { school, manager } = await setupMenuSchool()
    await scheduledMenu(school, manager)
    const { parent } = await family(school)
    freezeClock(OPEN)
    const response = await client.get('/?week=2026-11-23').loginAs(parent).withInertia()
    const view = (response.inertiaProps as Props).view
    assert.equal(view.menu.status, 'scheduled')
    for (const day of view.days) {
      assert.equal(day.state, 'not_published')
      assert.lengthOf(day.options, 0)
    }
  })

  test('saving through HTTP: autosave payload, absent, history', async ({ client, assert }) => {
    const { school, main, juice } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    const save = await client
      .post(`/orders/${child.id}/days/${TUE}`)
      .loginAs(parent)
      .withCsrfToken()
      .json({ subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 1 }] })
      .redirects(0)
    save.assertStatus(302)
    assert.equal((await orderOf(child, TUE))!.items.length, 2)

    // A price or date sent by the browser is ignored / validated.
    const forged = await client
      .post(`/orders/${child.id}/days/${TUE}`)
      .loginAs(parent)
      .withCsrfToken()
      .json({ subscriptionMealId: main.id, supplements: [], unitPriceCents: 1, date: WED })
      .redirects(0)
    forged.assertStatus(302)
    const order = (await orderOf(child, TUE))!
    assert.equal(order.items[0].unitPriceCents, 0)
    assert.isNull(await orderOf(child, WED))

    const tooMany = await client
      .post(`/orders/${child.id}/days/${TUE}`)
      .loginAs(parent)
      .withCsrfToken()
      .json({ subscriptionMealId: main.id, supplements: [{ mealId: juice.id, qty: 6 }] })
      .redirects(0)
    assert.match(String(tooMany.flashMessage('error')), /1 à 5/)

    await client
      .post(`/orders/${child.id}/days/${WED}/absent`)
      .loginAs(parent)
      .withCsrfToken()
      .redirects(0)
    assert.equal((await orderOf(child, WED))!.cancelReason, 'absent')

    const history = await client.get('/orders/history').loginAs(parent).withInertia()
    history.assertInertiaComponent('parent/orders/history')
    assert.lengthOf((history.inertiaProps as Props).orders, 2)
  })
})

test.group('Orders | parent isolation', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test("parent B can't read, create, change or cancel parent A's child's orders", async ({
    client,
    assert,
  }) => {
    const { school, main } = await orderSchool()
    const a = await family(school, { child: { firstName: 'Secretname' } })
    const b = await family(school)
    freezeClock(OPEN)
    await (
      await orders()
    ).saveDay(a.child.id, TUE, { subscriptionMealId: main.id, supplements: [] }, { user: a.parent })
    const before = await OrderAuditLog.query().count('* as total')

    // Read: a foreign, unknown or malformed child id is a 404 (no fallback, no leak).
    for (const id of [a.child.id, 999999, 'abc']) {
      const view = await client.get(`/?child=${id}&week=2026-11-23`).loginAs(b.parent)
      view.assertStatus(404)
      assert.notInclude(view.text(), 'Secretname')
    }
    const own = await client
      .get(`/?child=${b.child.id}&week=2026-11-23`)
      .loginAs(b.parent)
      .withInertia()
    assert.equal((own.inertiaProps as Props).childId, b.child.id)
    const history = await client
      .get(`/orders/history?child=${a.child.id}`)
      .loginAs(b.parent)
      .withInertia()
    assert.lengthOf((history.inertiaProps as Props).orders, 0)

    // Write: 404 and nothing changes.
    const change = await client
      .post(`/orders/${a.child.id}/days/${TUE}`)
      .loginAs(b.parent)
      .withCsrfToken()
      .json({ subscriptionMealId: main.id, supplements: [] })
      .redirects(0)
    change.assertStatus(404)
    const cancel = await client
      .post(`/orders/${a.child.id}/days/${TUE}/absent`)
      .loginAs(b.parent)
      .withCsrfToken()
      .redirects(0)
    cancel.assertStatus(404)
    const create = await client
      .post(`/orders/${a.child.id}/days/${WED}`)
      .loginAs(b.parent)
      .withCsrfToken()
      .json({ subscriptionMealId: main.id, supplements: [] })
      .redirects(0)
    create.assertStatus(404)
    // applyToChildren with a foreign id: the whole request is refused.
    const all = await client
      .post(`/orders/days/${WED}/all`)
      .loginAs(b.parent)
      .withCsrfToken()
      .json({ subscriptionMealId: main.id, supplements: [], childIds: [b.child.id, a.child.id] })
      .redirects(0)
    all.assertStatus(404)

    assert.equal((await orderOf(a.child, TUE))!.status, 'active')
    assert.isNull(await orderOf(a.child, WED))
    assert.isNull(await orderOf(b.child, WED))
    const after = await OrderAuditLog.query().count('* as total')
    assert.equal(after[0].$extras.total, before[0].$extras.total)

    // The service itself refuses too (defence in depth).
    const results = await (
      await orders()
    ).applyToChildren({ user: b.parent }, WED, { subscriptionMealId: main.id, supplements: [] }, [
      a.child.id,
    ])
    assert.deepEqual(results, [
      { childId: a.child.id, ok: false, rule: 'NOT_FOUND', messageKey: 'orders.errors.NOT_FOUND' },
    ])
    assert.lengthOf(await MealOrder.query().where('child_id', a.child.id), 1)
  })

  test('only parents use the portal routes; staff of another school get 404', async ({
    client,
    assert,
  }) => {
    const { school, manager, main } = await orderSchool()
    const { parent, child } = await family(school)
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const other = await setupMenuSchool()
    freezeClock(OPEN)

    for (const user of [manager, kitchen]) {
      const response = await client
        .post(`/orders/${child.id}/days/${TUE}`)
        .loginAs(user)
        .withCsrfToken()
        .json({ subscriptionMealId: main.id, supplements: [] })
        .redirects(0)
      assert.notEqual(response.status(), 200)
      assert.isNull(await orderOf(child, TUE))
    }
    const admin = await client.get('/admin/orders').loginAs(parent)
    admin.assertStatus(403)
    const kitchenAdmin = await client.get('/admin/orders').loginAs(kitchen)
    kitchenAdmin.assertStatus(403)
    const foreign = await client.get(`/admin/orders/children/${child.id}`).loginAs(other.manager)
    foreign.assertStatus(404)
    const foreignSave = await client
      .post(`/admin/orders/children/${child.id}/days/${TUE}`)
      .loginAs(other.manager)
      .withCsrfToken()
      .json({ subscriptionMealId: main.id, supplements: [], reason: 'Hack attempt' })
      .redirects(0)
    foreignSave.assertStatus(404)
    assert.isNull(await orderOf(child, TUE))
  })
})

test.group('Orders | back-office', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('list, child week and audited staff change (reason required)', async ({
    client,
    assert,
  }) => {
    const { school, manager, main } = await orderSchool()
    const { parent, child } = await family(school)
    freezeClock(OPEN)
    await (
      await orders()
    ).saveDay(child.id, TUE, { subscriptionMealId: main.id, supplements: [] }, { user: parent })

    const list = await client.get(`/admin/orders?date=${TUE}`).loginAs(manager).withInertia()
    list.assertInertiaComponent('admin/orders/index')
    assert.lengthOf((list.inertiaProps as Props).orders, 1)

    const week = await client
      .get(`/admin/orders/children/${child.id}?week=2026-11-23`)
      .loginAs(manager)
      .withInertia()
    week.assertInertiaComponent('admin/orders/child')
    assert.lengthOf((week.inertiaProps as Props).audit, 1)

    freezeClock('2026-11-24T10:00')
    const noReason = await client
      .post(`/admin/orders/children/${child.id}/days/${TUE}/cancel`)
      .loginAs(manager)
      .withCsrfToken()
      .json({})
      .redirects(0)
    assert.property(noReason.flashMessage('inputErrorsBag') ?? {}, 'reason')
    assert.equal((await orderOf(child, TUE))!.status, 'active')

    const cancel = await client
      .post(`/admin/orders/children/${child.id}/days/${TUE}/cancel`)
      .loginAs(manager)
      .withCsrfToken()
      .json({ reason: 'Child sick, called by parent' })
      .redirects(0)
    cancel.assertStatus(302)
    const order = (await orderOf(child, TUE))!
    assert.equal(order.status, 'cancelled')
    const audit = await OrderAuditLog.query()
      .where('child_id', child.id)
      .orderBy('id', 'desc')
      .firstOrFail()
    assert.equal(audit.action, 'staff_override')
    assert.equal(audit.actorId, manager.id)
    assert.equal(audit.reason, 'Child sick, called by parent')
  })
})
