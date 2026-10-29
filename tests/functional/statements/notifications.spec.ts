/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import { UserFactory } from '#database/factories/user_factory'
import Notification from '#models/notification'
import User from '#models/user'
import NotificationService from '#services/notification_service'
import NotificationCenterService from '#services/notification_center_service'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { setupMenuSchool, subscriptionMeal } from '#tests/helpers/menus'
import { family } from '#tests/helpers/orders'

type Props = Record<string, any>

async function notifier() {
  return app.container.make(NotificationService)
}

/** A parent with one notice of every type (oldest first), and another parent with one. */
async function seed() {
  const { school, manager } = await setupMenuSchool()
  const { parent, child } = await family(school)
  const other = await family(school)
  const meal = await subscriptionMeal({ nameFr: 'Couscous', nameEn: 'Couscous' })
  const service = await notifier()
  const clock = freezeClock('2026-11-10T08:00')
  const rows: Array<[Parameters<NotificationService['notify']>[1], Record<string, unknown>]> = [
    ['menu_published', { weeklyMenuId: 1, weekStart: '2026-11-23' }],
    ['deadline_reminder', { weeklyMenuId: 1, weekStart: '2026-11-23' }],
    [
      'holiday_cancellation',
      { orderIds: [1, 2], days: [{ childName: child.firstName, date: '2026-11-26' }] },
    ],
    [
      'order_changed_by_staff',
      {
        orderId: 3,
        childId: child.id,
        childName: child.firstName,
        date: '2026-11-24',
        status: 'cancelled',
      },
    ],
    [
      'menu_change',
      {
        kind: 'item_removed',
        date: '2026-11-25',
        mealId: meal.id,
        targetMealId: null,
        children: [child.firstName],
      },
    ],
    [
      'auto_assigned',
      {
        weeklyMenuId: 1,
        weekStart: '2026-11-23',
        days: [{ childName: child.firstName, date: '2026-11-23', mealId: meal.id }],
      },
    ],
  ]
  for (const [type, data] of rows) {
    await service.notify(parent, type, data)
    clock.travel({ minutes: 1 })
  }
  await service.notify(other.parent, 'menu_published', { weeklyMenuId: 1, weekStart: '2026-11-23' })
  const foreign = await Notification.query().where('user_id', other.parent.id).firstOrFail()
  return { school, manager, parent, child, other, meal, foreign }
}

test.group('Notifications | center', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('lists my notifications newest first with texts, links and the unread badge', async ({
    client,
    assert,
  }) => {
    const { parent, child } = await seed()
    const response = await client.get('/notifications').loginAs(parent).withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('parent/notifications/index')
    const props = response.inertiaProps as Props
    assert.equal(props.unread, 6)
    assert.equal(props.unreadNotifications, 6) // shared prop of the header bell
    const items = props.notifications as Props[]
    assert.deepEqual(
      items.map((item) => item.type),
      [
        'auto_assigned',
        'menu_change',
        'order_changed_by_staff',
        'holiday_cancellation',
        'deadline_reminder',
        'menu_published',
      ]
    )
    assert.isTrue(items.every((item) => item.read === false && item.title.length > 0))
    const byType = new Map(items.map((item) => [item.type, item]))
    assert.equal(
      byType.get('menu_published')!.body,
      'Le menu de la semaine du 23 au 27 novembre 2026 est en ligne : choisissez les repas de vos enfants.'
    )
    assert.equal(byType.get('menu_published')!.href, '/?week=2026-11-23')
    assert.equal(byType.get('holiday_cancellation')!.href, '/orders/history')
    assert.deepEqual(byType.get('holiday_cancellation')!.lines, [
      `${child.firstName} — jeudi 26 novembre`,
    ])
    assert.equal(byType.get('order_changed_by_staff')!.href, `/?child=${child.id}&week=2026-11-23`)
    assert.include(byType.get('menu_change')!.body, '« Couscous »')
    assert.include(byType.get('auto_assigned')!.lines[0], 'Couscous')
    assert.deepEqual(props.preferences, { menu_published: true, deadline_reminder: true })

    // English
    parent.locale = 'en'
    await parent.save()
    const en = await client.get('/notifications').loginAs(parent).withInertia()
    const enMenu = (en.inertiaProps.notifications as Props[]).find(
      (item) => item.type === 'menu_published'
    )!
    assert.equal(
      enMenu.body,
      "The menu for November 23 – 27, 2026 is online: choose your children's meals."
    )
  })

  test('mark one read, open, mark all read; the badge follows', async ({ client, assert }) => {
    const { parent } = await seed()
    const [first, second] = await Notification.query()
      .where('user_id', parent.id)
      .orderBy('id', 'asc')
    const read = await client
      .post(`/notifications/${first.id}/read`)
      .loginAs(parent)
      .withCsrfToken()
      .redirects(0)
    read.assertStatus(302)
    await first.refresh()
    assert.isNotNull(first.readAt)
    const center = await app.container.make(NotificationCenterService)
    assert.equal(await center.unreadCount(parent.id), 5)

    const open = await client
      .post(`/notifications/${second.id}/open`)
      .loginAs(parent)
      .withCsrfToken()
      .redirects(0)
    open.assertStatus(302)
    assert.equal(open.header('location'), '/?week=2026-11-23')
    await second.refresh()
    assert.isNotNull(second.readAt)

    const page = await client.get('/statements').loginAs(parent).withInertia()
    assert.equal((page.inertiaProps as Props).unreadNotifications, 4)

    const all = await client
      .post('/notifications/read-all')
      .loginAs(parent)
      .withCsrfToken()
      .redirects(0)
    all.assertStatus(302)
    assert.equal(await center.unreadCount(parent.id), 0)
    const after = await client.get('/notifications').loginAs(parent).withInertia()
    assert.isTrue((after.inertiaProps.notifications as Props[]).every((item) => item.read))
    assert.equal((after.inertiaProps as Props).unreadNotifications, 0)
  })

  test("another parent's notification is a 404 and stays unread", async ({ client, assert }) => {
    const { parent, foreign, other } = await seed()
    for (const action of ['read', 'open']) {
      const response = await client
        .post(`/notifications/${foreign.id}/${action}`)
        .loginAs(parent)
        .withCsrfToken()
        .redirects(0)
      response.assertStatus(404)
    }
    await client.post('/notifications/read-all').loginAs(parent).withCsrfToken().redirects(0)
    await foreign.refresh()
    assert.isNull(foreign.readAt)
    const list = await client.get('/notifications').loginAs(other.parent).withInertia()
    assert.lengthOf((list.inertiaProps as Props).notifications, 1)
    ;(
      await client
        .post('/notifications/99999999999/read')
        .loginAs(parent)
        .withCsrfToken()
        .redirects(0)
    ).assertStatus(404)
  })

  test('staff have no notification center and no badge', async ({ client, assert }) => {
    const { manager } = await seed()
    ;(await client.get('/notifications').loginAs(manager)).assertStatus(403)
    const kitchen = await UserFactory.apply('kitchen').create()
    ;(await client.get('/notifications').loginAs(kitchen)).assertStatus(403)
    const dashboard = await client.get('/admin').loginAs(manager).withInertia()
    assert.isNull((dashboard.inertiaProps as Props).unreadNotifications)
  })

  test('email preferences: reminders can be turned off, other keys are kept', async ({
    client,
    assert,
  }) => {
    const { parent } = await seed()
    parent.notificationPrefs = { holiday_cancellation: false, legacy: true }
    await parent.save()
    const response = await client
      .put('/notifications/preferences')
      .loginAs(parent)
      .withCsrfToken()
      .json({ menu_published: false, deadline_reminder: false, holiday_cancellation: true })
      .redirects(0)
    response.assertStatus(302)
    const fresh = await User.findOrFail(parent.id)
    assert.deepEqual(fresh.notificationPrefs, {
      holiday_cancellation: false, // not changeable here (and ignored when sending)
      legacy: true,
      menu_published: false,
      deadline_reminder: false,
    })
    const invalid = await client
      .put('/notifications/preferences')
      .loginAs(parent)
      .withCsrfToken()
      .json({ menu_published: 'maybe' })
      .redirects(0)
    invalid.assertStatus(302)
    assert.equal((await User.findOrFail(parent.id)).notificationPrefs.menu_published, false)
  })
})
