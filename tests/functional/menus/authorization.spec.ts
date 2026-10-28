/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import testUtils from '@adonisjs/core/services/test_utils'
import MenuItem from '#models/menu_item'
import MenuTemplate from '#models/menu_template'
import WeeklyMenu from '#models/weekly_menu'
import { UserFactory } from '#database/factories/user_factory'
import {
  MON,
  TUE,
  WEEK,
  addItem,
  menuOf,
  setupMenuSchool,
  subscriptionMeal,
} from '#tests/helpers/menus'

/** Every weekly-menu / template route of the router, params filled in. */
function menuRoutes(ids: Record<string, string | number>) {
  const routes: { method: string; url: string }[] = []
  for (const list of Object.values(router.toJSON())) {
    for (const route of list) {
      if (!/^\/admin\/(menus|menu-templates)/.test(route.pattern)) continue
      const url = route.pattern.replace(/:(\w+)/g, (_, name: string) => String(ids[name] ?? 1))
      for (const method of route.methods) if (method !== 'HEAD') routes.push({ method, url })
    }
  }
  return routes
}

async function seed() {
  const ctx = await setupMenuSchool()
  const meal = await subscriptionMeal()
  const item = await addItem(ctx.school, ctx.manager, MON, meal)
  const template = await MenuTemplate.create({
    schoolId: ctx.school.id,
    name: 'T',
    createdBy: null,
  })
  return { ...ctx, item, template, menu: await menuOf(ctx.school) }
}

async function snapshot(schoolId: number) {
  const menus = await WeeklyMenu.query().where('school_id', schoolId).orderBy('id')
  const items = await MenuItem.query().orderBy('id')
  const templates = await MenuTemplate.query().orderBy('id')
  return {
    menus: menus.map((m) => [
      m.id,
      m.status,
      m.publishAt?.toMillis(),
      m.orderDeadlineAt?.toMillis(),
    ]),
    items: items.map((i) => [i.id, i.date, i.mealId, i.isDefault, i.maxQuantity]),
    templates: templates.map((t) => [t.id, t.name]),
  }
}

const PAYLOAD = {
  date: TUE,
  mealId: 1,
  maxQuantity: 3,
  publishAt: '2026-11-18T10:00',
  orderDeadlineAt: '2026-11-21T20:00',
  templateId: 1,
  name: 'Hacked',
}

test.group('Menus | authorization', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  for (const role of ['kitchen', 'parent'] as const) {
    test('a {$self} cannot use any weekly menu route')
      .with([role])
      .run(async ({ client, assert }, userRole) => {
        const { school, item, template } = await seed()
        const user = await UserFactory.apply(userRole).merge({ schoolId: school.id }).create()
        const before = await snapshot(school.id)
        const routes = menuRoutes({ week: WEEK, id: item.id })
        assert.isAtLeast(routes.length, 14)
        for (const { method, url } of routes) {
          const target = url.startsWith('/admin/menu-templates')
            ? url.replace(/\d+$/, String(template.id))
            : url
          const request = client
            .request(target, method as any)
            .loginAs(user)
            .redirects(0)
          if (method !== 'GET')
            request.withCsrfToken().json({ ...PAYLOAD, templateId: template.id })
          const response = await request
          if (method === 'GET') assert.equal(response.status(), 403, `${method} ${target}`)
          else assert.include([302, 403], response.status(), `${method} ${target}`)
        }
        assert.deepEqual(await snapshot(school.id), before)
      })
  }

  test("staff of another school can't reach this school's menu, items or templates", async ({
    client,
    assert,
  }) => {
    const { school, item, template } = await seed()
    const other = await setupMenuSchool()
    const before = await snapshot(school.id)

    // Their own week page shows their own (empty) week, never this school's items.
    const page = await client.get(`/admin/menus/${WEEK}`).loginAs(other.manager).withInertia()
    const props = page.inertiaProps as any
    assert.isNull(props.menu)
    assert.isTrue(props.days.every((day: any) => day.items.length === 0))
    assert.deepEqual(props.templates, [])

    const attempts = [
      client.put(`/admin/menus/${WEEK}/items/${item.id}`).json({ maxQuantity: 1 }),
      client.post(`/admin/menus/${WEEK}/items/${item.id}/default`),
      client.delete(`/admin/menus/${WEEK}/items/${item.id}`),
      client.post(`/admin/menus/${WEEK}/schedule`),
      client.post(`/admin/menus/${WEEK}/publish`),
      client.post(`/admin/menus/${WEEK}/save-template`).json({ name: 'Copy' }),
      client.delete(`/admin/menu-templates/${template.id}`),
    ]
    for (const attempt of attempts) {
      const response = await attempt.loginAs(other.manager).withCsrfToken().redirects(0)
      response.assertStatus(404)
    }
    assert.deepEqual(await snapshot(school.id), before)
  })

  test('an item id of another week is a 404', async ({ client, assert }) => {
    const { school, manager, item } = await seed()
    await addItem(school, manager, '2026-11-30', await subscriptionMeal(), '2026-11-30')
    const response = await client
      .delete(`/admin/menus/2026-11-30/items/${item.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    response.assertStatus(404)
    assert.isNotNull(await MenuItem.find(item.id))
  })

  test('staff without a school cannot use the builder', async ({ client }) => {
    const manager = await UserFactory.apply('manager').merge({ schoolId: null }).create()
    const response = await client.get('/admin/menus').loginAs(manager)
    response.assertStatus(403)
  })

  test('admins and managers of the school can open the pages', async ({ client }) => {
    const { manager, admin } = await seed()
    for (const user of [manager, admin]) {
      ;(await client.get('/admin/menus').loginAs(user).withInertia()).assertStatus(200)
      ;(await client.get(`/admin/menus/${WEEK}`).loginAs(user).withInertia()).assertStatus(200)
    }
  })

  test('guests are sent to the login page', async ({ client }) => {
    const response = await client.get(`/admin/menus/${WEEK}`).redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('out-of-range ids are a 404', async ({ client }) => {
    const { manager } = await seed()
    const big = '99999999999999999999'
    for (const [method, url] of [
      ['PUT', `/admin/menus/${WEEK}/items/${big}`],
      ['DELETE', `/admin/menus/${WEEK}/items/${big}`],
      ['POST', `/admin/menus/${WEEK}/items/${big}/default`],
      ['DELETE', `/admin/menu-templates/${big}`],
    ]) {
      const response = await client
        .request(url, method as any)
        .loginAs(manager)
        .withCsrfToken()
        .json({ maxQuantity: 2 })
        .redirects(0)
      response.assertStatus(404)
    }
  })
})
