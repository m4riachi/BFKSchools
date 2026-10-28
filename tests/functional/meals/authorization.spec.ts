import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import drive from '@adonisjs/drive/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import Meal from '#models/meal'
import { UserFactory } from '#database/factories/user_factory'
import { createMeal, createStaff, photosOf, pngBuffer } from '#tests/helpers/meals'

/** Every meal route of the router (admin and kitchen), params filled in. */
function mealRoutes(prefix: string, ids: Record<string, number>) {
  const routes: { method: string; url: string }[] = []
  for (const list of Object.values(router.toJSON())) {
    for (const route of list) {
      if (!route.pattern.startsWith(prefix)) continue
      const url = route.pattern.replace(/:(\w+)/g, (_, name: string) => String(ids[name] ?? 1))
      for (const method of route.methods) if (method !== 'HEAD') routes.push({ method, url })
    }
  }
  return routes
}

test.group('Meals | authorization', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    drive.fake('fs')
    return async () => {
      drive.restore('fs')
      await truncate()
    }
  })

  test('admin and manager reach the back-office catalog', async ({ client }) => {
    for (const role of ['admin', 'manager'] as const) {
      const user = await createStaff(role)
      const response = await client.get('/admin/meals').loginAs(user).withInertia()
      response.assertStatus(200)
      response.assertInertiaComponent('admin/meals/index')
      const create = await client.get('/admin/meals/create').loginAs(user)
      create.assertStatus(200)
    }
  })

  test('kitchen reads the catalog in the kitchen area only', async ({ client }) => {
    const kitchen = await createStaff('kitchen')
    const meal = await createMeal()

    const list = await client.get('/kitchen/meals').loginAs(kitchen).withInertia()
    list.assertStatus(200)
    list.assertInertiaComponent('kitchen/meals/index')
    const show = await client.get(`/kitchen/meals/${meal.id}`).loginAs(kitchen).withInertia()
    show.assertStatus(200)
    show.assertInertiaComponent('kitchen/meals/show')
  })

  for (const role of ['kitchen', 'parent'] as const) {
    test('a {$self} cannot use any /admin/meals route')
      .with([role])
      .run(async ({ client, assert }, userRole) => {
        const manager = await createStaff('manager')
        const user = await createStaff(userRole)
        const meal = await createMeal({ nameFr: 'Original' })
        await client
          .post(`/admin/meals/${meal.id}/photos`)
          .loginAs(manager)
          .withCsrfToken()
          .file('photos', await pngBuffer(), { filename: 'a.png' })
          .redirects(0)
        const [photo] = await photosOf(meal.id)

        const routes = mealRoutes('/admin/meals', { id: meal.id, photoId: photo.id })
        assert.isAtLeast(routes.length, 11)
        for (const { method, url } of routes) {
          const request = client
            .request(url, method as any)
            .loginAs(user)
            .redirects(0)
          if (method !== 'GET') {
            request.withCsrfToken().json({
              nameFr: 'Hacked',
              nameEn: 'Hacked',
              type: 'supplement',
              category: 'snack',
              price: '1',
              ids: [photo.id],
            })
          }
          const response = await request
          if (method === 'GET') assert.equal(response.status(), 403, `${method} ${url}`)
          else assert.include([302, 403], response.status(), `${method} ${url}`)
        }

        await meal.refresh()
        assert.equal(meal.nameFr, 'Original')
        assert.isNull(meal.deletedAt)
        assert.lengthOf(await Meal.all(), 1, 'no duplicate, no new meal')
        const photos = await photosOf(meal.id)
        assert.lengthOf(photos, 1)
        assert.isTrue(photos[0].isCover)
      })
  }

  test('parents cannot reach the kitchen catalog', async ({ client }) => {
    const parent = await createStaff('parent')
    const meal = await createMeal()
    for (const url of ['/kitchen/meals', `/kitchen/meals/${meal.id}`]) {
      const response = await client.get(url).loginAs(parent)
      response.assertStatus(403)
    }
  })

  test('inactive staff are refused', async ({ client }) => {
    const manager = await UserFactory.apply('manager').apply('inactive').create()
    const response = await client.get('/admin/meals').loginAs(manager).redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })

  test('guests are sent to the login page', async ({ client }) => {
    for (const url of ['/admin/meals', '/kitchen/meals']) {
      const response = await client.get(url).redirects(0)
      response.assertStatus(302)
      response.assertHeader('location', '/login')
    }
  })
})
