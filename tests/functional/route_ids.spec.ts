import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { UserFactory } from '#database/factories/user_factory'

/**
 * Numeric route params only match ids that fit PostgreSQL `integer`:
 * anything else is a 404 from the router, never a 500 from the database.
 */
test.group('Routes | out-of-range numeric ids', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  const tooBig = ['2147483648', '99999999999999999999']

  test('GET routes answer 404', async ({ client }) => {
    const manager = await UserFactory.apply('manager').create()
    for (const big of tooBig) {
      for (const url of [
        `/admin/parents/${big}`,
        `/admin/parents/${big}/edit`,
        `/admin/parents/${big}/children/create`,
        `/admin/parents/1/children/${big}/edit`,
        `/admin/meals/${big}/edit`,
        `/kitchen/meals/${big}`,
        `/admin/statements/parents/${big}`,
        `/admin/statements/parents/${big}/pdf`,
        `/media/meal-photos/${big}/full`,
        `/media/meal-photos/${big}/thumb`,
      ]) {
        const response = await client.get(url).loginAs(manager)
        response.assertStatus(404)
      }
    }
  })

  test('form routes answer 404', async ({ client }) => {
    const manager = await UserFactory.apply('manager').create()
    const big = '99999999999999999999'
    const routes: Array<[string, string]> = [
      ['PUT', `/admin/parents/${big}`],
      ['POST', `/admin/parents/${big}/invitation`],
      ['PUT', `/admin/parents/1/children/${big}`],
      ['POST', `/admin/parents/1/children/${big}/subscriptions`],
      ['DELETE', `/admin/parents/1/children/1/subscriptions/${big}`],
      ['PUT', `/admin/meals/${big}`],
      ['POST', `/admin/meals/${big}/duplicate`],
      ['DELETE', `/admin/meals/${big}`],
      ['POST', `/admin/meals/${big}/photos`],
      ['PUT', `/admin/meals/${big}/photos/order`],
      ['POST', `/admin/meals/1/photos/${big}/cover`],
      ['DELETE', `/admin/meals/1/photos/${big}`],
    ]
    for (const [method, url] of routes) {
      const response = await client
        .request(url, method as any)
        .loginAs(manager)
        .withCsrfToken()
        .json({ ids: [1] })
        .redirects(0)
      response.assertStatus(404)
    }
  })

  test('the largest valid id reaches the controller and is a plain 404', async ({ client }) => {
    const manager = await UserFactory.apply('manager').create()
    for (const url of [
      '/admin/meals/2147483647/edit',
      '/media/meal-photos/2147483647/full',
      '/admin/parents/2147483647',
    ]) {
      const response = await client.get(url).loginAs(manager)
      response.assertStatus(404)
    }
  })
})
