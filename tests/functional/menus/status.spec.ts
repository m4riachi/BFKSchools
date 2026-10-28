/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { DateTime } from 'luxon'
import WeeklyMenu from '#models/weekly_menu'
import MenuCalendar from '#services/menu_calendar'
import { MENU_TRANSITIONS, canTransition } from '#services/menu_status_service'
import BusinessRuleException from '#exceptions/business_rule_exception'
import { WEEKLY_MENU_STATUSES } from '#enums/menus'
import { APP_TIMEZONE } from '#support/time'
import {
  MON,
  THU,
  WEEK,
  addHoliday,
  addItem,
  builder,
  menuOf,
  readyMenu,
  setupMenuSchool,
  statusService,
  subscriptionMeal,
} from '#tests/helpers/menus'
import { freezeClock, restoreClock } from '#tests/helpers/clock'

const wall = (value: DateTime | null) =>
  value?.setZone(APP_TIMEZONE).toFormat('ccc yyyy-LL-dd HH:mm')

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

test.group('Menus | publish and deadline defaults', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('pre-filled from the settings: Thursday 10:00 and Sunday 20:00 of the week before', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    await addItem(school, manager, MON, await subscriptionMeal())
    const menu = await menuOf(school)
    assert.equal(wall(menu.publishAt), 'Thu 2026-11-19 10:00')
    assert.equal(wall(menu.orderDeadlineAt), 'Sun 2026-11-22 20:00')
  })

  test('custom settings are used for new weeks', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool({
      publish_weekday: 3,
      publish_time: '08:30',
      deadline_weekday: 6,
      deadline_time: '12:00',
    })
    await addItem(school, manager, MON, await subscriptionMeal())
    const menu = await menuOf(school)
    assert.equal(wall(menu.publishAt), 'Wed 2026-11-18 08:30')
    assert.equal(wall(menu.orderDeadlineAt), 'Sat 2026-11-21 12:00')
  })

  test('a week whose publish and deadline span an offset change keeps the wall-clock times', async ({
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const calendar = await app.container.make(MenuCalendar)

    // Week of 21 Sep 2026: publish Thu 17 Sep, deadline Sun 20 Sep — Morocco's
    // offset changes on 20 Sep 2026 (tzdata 2026c). Never hard-coded here: the
    // test only requires the two instants to carry different offsets.
    const september = calendar.defaultTimes(school, '2026-09-21')
    assert.equal(wall(september.publishAt), 'Thu 2026-09-17 10:00')
    assert.equal(wall(september.orderDeadlineAt), 'Sun 2026-09-20 20:00')
    assert.notEqual(september.publishAt.offset, september.orderDeadlineAt.offset)
    assert.isTrue(september.valid)

    // Stored and read back through PostgreSQL (timestamptz) unchanged.
    await addItem(school, manager, '2026-09-21', await subscriptionMeal(), '2026-09-21')
    const stored = await menuOf(school, '2026-09-21')
    assert.equal(wall(stored.publishAt), 'Thu 2026-09-17 10:00')
    assert.equal(wall(stored.orderDeadlineAt), 'Sun 2026-09-20 20:00')
    assert.equal(stored.publishAt!.toMillis(), september.publishAt.toMillis())
    assert.equal(stored.orderDeadlineAt!.toMillis(), september.orderDeadlineAt.toMillis())

    // Older Ramadan-era transitions (spring 2026) also keep wall-clock times.
    for (const week of ['2026-02-16', '2026-02-23', '2026-03-16', '2026-03-23']) {
      const times = calendar.defaultTimes(school, week)
      assert.equal(times.publishAt.setZone(APP_TIMEZONE).toFormat('ccc HH:mm'), 'Thu 10:00', week)
      assert.equal(
        times.orderDeadlineAt.setZone(APP_TIMEZONE).toFormat('ccc HH:mm'),
        'Sun 20:00',
        week
      )
    }
  })

  test('HTTP: times typed as Morocco wall-clock are stored as the right instants', async ({
    client,
    assert,
  }) => {
    freezeClock('2026-09-10T08:00')
    const { school, manager } = await setupMenuSchool()
    await addItem(school, manager, '2026-09-21', await subscriptionMeal(), '2026-09-21')
    const response = await client
      .put('/admin/menus/2026-09-21/times')
      .loginAs(manager)
      .withCsrfToken()
      .json({ publishAt: '2026-09-18T09:15', orderDeadlineAt: '2026-09-20T21:45' })
      .redirects(0)
    response.assertStatus(302)
    const menu = await menuOf(school, '2026-09-21')
    assert.equal(wall(menu.publishAt), 'Fri 2026-09-18 09:15')
    assert.equal(wall(menu.orderDeadlineAt), 'Sun 2026-09-20 21:45')
    assert.equal(
      menu.orderDeadlineAt!.toMillis(),
      DateTime.fromISO('2026-09-20T21:45', { zone: APP_TIMEZONE }).toMillis()
    )
  })

  test('the deadline must be after publication and before the week ends', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await readyMenu(school, manager)
    for (const [publishAt, orderDeadlineAt] of [
      ['2026-11-19T10:00', '2026-11-19T10:00'],
      ['2026-11-19T10:00', '2026-11-18T10:00'],
      ['2026-11-19T10:00', '2026-11-30T00:00'],
    ]) {
      const response = await client
        .put(`/admin/menus/${WEEK}/times`)
        .loginAs(manager)
        .withCsrfToken()
        .json({ publishAt, orderDeadlineAt })
        .redirects(0)
      assert.property(response.flashMessage('inputErrorsBag'), 'orderDeadlineAt')
    }
    const garbage = await client
      .put(`/admin/menus/${WEEK}/times`)
      .loginAs(manager)
      .withCsrfToken()
      .json({ publishAt: '2026-11-19 10:00', orderDeadlineAt: 'tomorrow' })
      .redirects(0)
    assert.properties(garbage.flashMessage('inputErrorsBag'), ['publishAt', 'orderDeadlineAt'])
    const fresh = await WeeklyMenu.findOrFail(menu.id)
    assert.equal(wall(fresh.orderDeadlineAt), 'Sun 2026-11-22 20:00')
  })
})

test.group('Menus | status transitions', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('the transition table allows exactly the documented changes', ({ assert }) => {
    const allowed: string[] = []
    for (const from of WEEKLY_MENU_STATUSES) {
      for (const to of WEEKLY_MENU_STATUSES)
        if (canTransition(from, to)) allowed.push(`${from}>${to}`)
    }
    assert.sameMembers(allowed, [
      'draft>scheduled',
      'scheduled>draft',
      'scheduled>published',
      'published>closed',
    ])
    assert.deepEqual(MENU_TRANSITIONS.closed, [])
  })

  test('valid path: draft → scheduled → draft → scheduled → published → closed', async ({
    assert,
  }) => {
    freezeClock('2026-11-17T09:00')
    const { school, manager } = await setupMenuSchool()
    const status = await statusService()
    let menu = await readyMenu(school, manager)
    menu = await status.schedule(school, menu, manager)
    assert.equal(menu.status, 'scheduled')
    menu = await status.unschedule(menu, manager)
    assert.equal(menu.status, 'draft')
    menu = await status.schedule(school, menu, manager)
    const outcome = await status.publishNow(menu, manager)
    assert.isTrue(outcome.published)
    menu = await WeeklyMenu.findOrFail(menu.id)
    assert.equal(menu.status, 'published')
    assert.equal(wall(menu.publishedAt), 'Tue 2026-11-17 09:00')
    menu = await status.close(menu)
    assert.equal(menu.status, 'closed')
    assert.isNotNull(menu.closedAt)
  })

  test('invalid transitions are refused', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    const status = await statusService()
    const draft = await readyMenu(school, manager)
    await expectRule(assert, status.publishNow(draft, manager), 'menus.errors.invalid_transition')
    await expectRule(assert, status.unschedule(draft, manager), 'menus.errors.invalid_transition')
    await expectRule(assert, status.close(draft), 'menus.errors.invalid_transition')

    const scheduled = await status.schedule(school, draft, manager)
    await expectRule(
      assert,
      status.schedule(school, scheduled, manager),
      'menus.errors.invalid_transition'
    )
    await expectRule(assert, status.close(scheduled), 'menus.errors.invalid_transition')

    await status.publishNow(scheduled, manager)
    const published = await WeeklyMenu.findOrFail(draft.id)
    await expectRule(
      assert,
      status.schedule(school, published, manager),
      'menus.errors.invalid_transition'
    )
    await expectRule(
      assert,
      status.unschedule(published, manager),
      'menus.errors.invalid_transition'
    )
    await expectRule(
      assert,
      status.publishNow(published, manager),
      'menus.errors.invalid_transition'
    )
    await expectRule(
      assert,
      status.updateTimes(
        school,
        published,
        { publishAt: DateTime.now(), orderDeadlineAt: DateTime.now().plus({ days: 1 }) },
        manager
      ),
      'menus.errors.times_locked'
    )

    const closed = await status.close(published)
    for (const attempt of [
      status.schedule(school, closed, manager),
      status.unschedule(closed, manager),
      status.publishNow(closed, manager),
      status.close(closed),
    ]) {
      await expectRule(assert, attempt, 'menus.errors.invalid_transition')
    }
    assert.equal((await WeeklyMenu.findOrFail(draft.id)).status, 'closed')
  })

  test('the database refuses a published menu without published_at', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    const menu = await readyMenu(school, manager)
    menu.status = 'published'
    await assert.rejects(() => menu.save(), /weekly_menus_published_at_check/)
  })

  test('scheduling needs at least one non-holiday day with meals', async ({ assert }) => {
    const { school, manager } = await setupMenuSchool()
    const status = await statusService()
    // Empty draft.
    const empty = await (await builder()).withMenu(school, WEEK, manager, async (_t, m) => m)
    await expectRule(assert, status.schedule(school, empty, manager), 'menus.errors.not_ready')

    // Meals only on Thursday, which then becomes a holiday.
    await addItem(school, manager, THU, await subscriptionMeal())
    await addHoliday(school, THU, 'Thanksgiving')
    await expectRule(assert, status.schedule(school, empty, manager), 'menus.errors.not_ready')
    assert.equal((await menuOf(school)).status, 'draft')

    await addItem(school, manager, MON, await subscriptionMeal())
    // Still refused: Thursday's items must be removed first.
    await expectRule(assert, status.schedule(school, empty, manager), 'menus.errors.not_ready')
  })

  test('HTTP: schedule, unschedule and publish now', async ({ client, assert }) => {
    freezeClock('2026-11-16T08:00')
    const { school, manager } = await setupMenuSchool()
    const menu = await readyMenu(school, manager)
    const post = (action: string) =>
      client.post(`/admin/menus/${WEEK}/${action}`).loginAs(manager).withCsrfToken().redirects(0)

    ;(await post('schedule')).assertStatus(302)
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'scheduled')
    ;(await post('unschedule')).assertStatus(302)
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'draft')
    const refused = await post('publish')
    assert.equal(refused.flashMessage('error'), "Ce changement de statut n'est pas possible.")
    assert.equal((await WeeklyMenu.findOrFail(menu.id)).status, 'draft')
    ;(await post('schedule')).assertStatus(302)
    ;(await post('publish')).assertStatus(302)
    const published = await WeeklyMenu.findOrFail(menu.id)
    assert.equal(published.status, 'published')
    assert.equal(wall(published.publishedAt), 'Mon 2026-11-16 08:00')
  })
})
