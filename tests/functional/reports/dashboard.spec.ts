/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { UserFactory } from '#database/factories/user_factory'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { addHoliday } from '#tests/helpers/menus'
import { FRI, MON, THU, TUE, WED, orderSchool, orders } from '#tests/helpers/orders'
import { countQueries, dashboards, order, pupil } from '#tests/helpers/reports'

const OPEN = '2026-11-20T12:00'

type Props = Record<string, any>

test.group('Reports | dashboard', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('Friday before a published week: next school day, selection %, countdown, holidays', async ({
    client,
    assert,
  }) => {
    const { school, manager, main, alt } = await orderSchool()
    await addHoliday(school, THU, 'Thanksgiving')
    await addHoliday(school, FRI, 'Thanksgiving')
    await addHoliday(school, '2026-12-18', 'Party') // 28 days ahead: listed
    await addHoliday(school, '2026-12-21', 'Winter break') // 31 days ahead: not listed
    const ann = await pupil(school, { firstName: 'Ann', lastName: 'Bell', className: '3A' })
    const ben = await pupil(school, { firstName: 'Ben', lastName: 'Cole', className: '3B' })
    const hal = await pupil(school, { firstName: 'Hal', lastName: 'Dunn', className: '3C' })
    await pupil(school, { firstName: 'Ivy', lastName: 'Egan', subscribed: false })
    freezeClock(OPEN)
    for (const date of [MON, TUE, WED]) await order(ann.parent, ann.child, date, main.id)
    await order(ben.parent, ben.child, TUE, alt.id)

    const response = await client.get('/admin').loginAs(manager).withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('admin/dashboard')
    const dashboard = (response.inertiaProps as Props).dashboard as Props
    assert.equal(dashboard.today, '2026-11-20')

    const [today, next] = dashboard.days
    assert.equal(today.kind, 'today')
    assert.equal(today.state, 'no_menu') // no menu for the week of 16 Nov
    assert.isNull(today.missing)
    assert.equal(next.date, MON)
    assert.equal(next.kind, 'next_school_day')
    assert.equal(next.state, 'open')
    assert.equal(next.production.totals.subscription.total, 1)
    assert.equal(next.production.lines[0].name, main.nameFr)
    assert.equal(next.missing.eligible, 3)
    assert.equal(next.missing.missing, 2)
    assert.deepEqual(
      next.missing.children.map((child: Props) => child.id),
      [ben.child.id, hal.child.id]
    )

    const week = dashboard.nextWeek
    assert.equal(week.weekStart, MON)
    assert.equal(week.status, 'published')
    assert.equal(week.minutesToDeadline, 2 * 24 * 60 + 8 * 60) // Sun 22 Nov 20:00
    assert.equal(week.openDays, 3) // Thu + Fri are holidays
    assert.deepEqual(week.selection, { children: 3, complete: 1, started: 2, percent: 33 })

    assert.deepEqual(dashboard.holidays, [
      { from: THU, to: FRI, name: 'Thanksgiving', days: 2 },
      { from: '2026-12-18', to: '2026-12-18', name: 'Party', days: 1 },
    ])
    assert.equal(dashboard.monthToDate.totalCents, 0)
    assert.equal(dashboard.monthToDate.from, '2026-11-01')
    assert.equal(dashboard.monthToDate.to, '2026-11-20')
  })

  test('mid-week: month-to-date amounts (active orders only), holiday tomorrow, no next menu', async ({
    assert,
  }) => {
    const { school, manager, main, alt, juice } = await orderSchool()
    await addHoliday(school, THU, 'Thanksgiving')
    const ann = await pupil(school, { firstName: 'Ann' })
    const ben = await pupil(school, { firstName: 'Ben' })
    const cal = await pupil(school, { firstName: 'Cal' })
    freezeClock(OPEN)
    await order(ann.parent, ann.child, MON, main.id, [{ mealId: juice.id, qty: 1 }])
    await order(ann.parent, ann.child, TUE, main.id)
    await order(ann.parent, ann.child, WED, alt.id)
    await order(ben.parent, ben.child, TUE, alt.id, [{ mealId: juice.id, qty: 2 }])
    await order(cal.parent, cal.child, WED, main.id)
    await (await orders()).cancelDay(cal.child.id, WED, { user: manager }, { reason: 'Sick' })

    freezeClock('2026-11-25T12:00')
    const dashboard = await (await dashboards()).build(school, { amounts: true })
    assert.deepEqual(dashboard.monthToDate, {
      from: '2026-11-01',
      to: WED,
      // D31: four subscription meals (included), only the extras are billed.
      subscriptionMeals: 4,
      supplementCount: 1 + 2,
      totalCents: 1000 + 2000,
      orders: 4,
    })
    const [today, tomorrow] = dashboard.days
    assert.equal(today.state, 'open')
    assert.equal(today.production.totals.subscription.total, 1) // Ann's alt (Cal cancelled)
    assert.deepEqual(
      { eligible: today.missing!.eligible, missing: today.missing!.missing },
      { eligible: 3, missing: 1 } // Ben; Cal's cancelled row counts as handled
    )
    assert.equal(tomorrow.date, THU)
    assert.equal(tomorrow.kind, 'tomorrow')
    assert.equal(tomorrow.state, 'holiday')
    assert.deepEqual(tomorrow.holidayNames, ['Thanksgiving'])
    assert.isNull(tomorrow.missing)

    assert.equal(dashboard.nextWeek.weekStart, '2026-11-30')
    assert.equal(dashboard.nextWeek.status, 'none')
    assert.isNull(dashboard.nextWeek.selection)
    // Default deadline: Sunday 29 Nov 20:00 (school zone) → 4 days 8 hours.
    assert.equal(dashboard.nextWeek.minutesToDeadline, 4 * 24 * 60 + 8 * 60)

    // Without the amounts permission there are no amounts at all.
    const noAmounts = await (await dashboards()).build(school, { amounts: false })
    assert.isNull(noAmounts.monthToDate)
  })

  test('the dashboard runs a bounded number of queries whatever the number of children', async ({
    assert,
  }) => {
    const { school, main } = await orderSchool()
    freezeClock(OPEN)
    const service = await dashboards()
    // One order first: an empty day skips the meals lookup (one query less).
    const first = await pupil(school)
    await order(first.parent, first.child, MON, main.id)
    const few = await countQueries(() => service.build(school, { amounts: true }))
    for (let index = 0; index < 10; index += 1) {
      const kid = await pupil(school, { className: `C${index}` })
      await order(kid.parent, kid.child, MON, main.id)
    }
    const many = await countQueries(() => service.build(school, { amounts: true }))
    assert.equal(many, few)
    assert.isAtMost(many, 20)
  })

  test('staff without a school get an empty dashboard; kitchen and parents get 403', async ({
    client,
    assert,
  }) => {
    const { school } = await orderSchool()
    const loner = await UserFactory.apply('admin').create()
    const response = await client.get('/admin').loginAs(loner).withInertia()
    response.assertStatus(200)
    assert.isNull((response.inertiaProps as Props).dashboard)

    for (const role of ['kitchen', 'parent'] as const) {
      const user = await UserFactory.apply(role).merge({ schoolId: school.id }).create()
      const denied = await client.get('/admin').loginAs(user).withInertia().redirects(0)
      denied.assertStatus(403)
    }
  })
})
