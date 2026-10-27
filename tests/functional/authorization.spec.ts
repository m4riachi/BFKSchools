import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { UserFactory } from '#database/factories/user_factory'

test.group('Authorization | role areas', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('guests are sent to /login', async ({ client, assert }) => {
    for (const path of ['/', '/admin', '/kitchen']) {
      const response = await client.get(path).redirects(0)
      assert.equal(response.header('location'), '/login', path)
    }
  })

  test('a parent gets 403 on /admin and /kitchen', async ({ client }) => {
    const parent = await UserFactory.apply('parent').create()

    for (const path of ['/admin', '/kitchen']) {
      const response = await client.get(path).loginAs(parent).withInertia().redirects(0)
      response.assertStatus(403)
      response.assertInertiaComponent('errors/forbidden')
    }
  })

  test('a parent gets 403 as plain HTML too', async ({ client }) => {
    const parent = await UserFactory.apply('parent').create()
    const response = await client.get('/admin').loginAs(parent).redirects(0)
    response.assertStatus(403)
  })

  test('a parent reaches the parent portal', async ({ client }) => {
    const parent = await UserFactory.apply('parent').create()
    const response = await client.get('/').loginAs(parent).withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('parent/home')
  })

  test('kitchen gets 403 on /admin and reaches /kitchen', async ({ client }) => {
    const kitchen = await UserFactory.apply('kitchen').create()

    const admin = await client.get('/admin').loginAs(kitchen).withInertia().redirects(0)
    admin.assertStatus(403)

    const area = await client.get('/kitchen').loginAs(kitchen).withInertia()
    area.assertStatus(200)
    area.assertInertiaComponent('kitchen/dashboard')
  })

  for (const role of ['admin', 'manager'] as const) {
    test('{0} reaches /admin and /kitchen')
      .with([role])
      .run(async ({ client }, userRole) => {
        const user = await UserFactory.apply(userRole).create()

        const admin = await client.get('/admin').loginAs(user).withInertia()
        admin.assertStatus(200)
        admin.assertInertiaComponent('admin/dashboard')

        const kitchen = await client.get('/kitchen').loginAs(user).withInertia()
        kitchen.assertStatus(200)
      })
  }

  test('staff visiting / are redirected to their home', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const kitchen = await UserFactory.apply('kitchen').create()

    const adminResponse = await client.get('/').loginAs(admin).redirects(0)
    assert.equal(adminResponse.header('location'), '/admin')

    const kitchenResponse = await client.get('/').loginAs(kitchen).redirects(0)
    assert.equal(kitchenResponse.header('location'), '/kitchen')
  })

  test('shared props never expose the password', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin').loginAs(admin).withInertia()

    const shared = response.inertiaProps.user
    assert.equal(shared.email, admin.email)
    assert.notProperty(shared, 'password')
  })
})
