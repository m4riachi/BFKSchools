import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import User from '#models/user'
import { UserFactory } from '#database/factories/user_factory'

test.group('Auth | QA extras', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))

  test('email case and spaces do not give a fresh rate-limit bucket', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('admin').create()
    const variants = [
      user.email,
      user.email.toUpperCase(),
      ` ${user.email} `,
      user.email,
      user.email.toUpperCase(),
    ]
    for (const email of variants) {
      await client.post('/login').form({ email, password: 'wrong' }).withCsrfToken().redirects(0)
    }
    const blocked = await client
      .post('/login')
      .form({ email: user.email, password: 'wrong' })
      .withCsrfToken()
      .redirects(0)
    assert.equal(blocked.header('location'), '/login')
    blocked.assertFlashMessage(
      'error',
      'Trop de tentatives de connexion. Réessayez dans 20 minutes.'
    )
  })

  test('a deactivated user is also logged out on a POST request', async ({ client, assert }) => {
    const user = await UserFactory.apply('parent').create()
    await User.query().where('id', user.id).update({ is_active: false })

    const response = await client.post('/logout').loginAs(user).withCsrfToken().redirects(0)
    assert.equal(response.header('location'), '/login')
  })

  test('a deactivated user is blocked from every area', async ({ client, assert }) => {
    const user = await UserFactory.apply('kitchen').create()
    await User.query().where('id', user.id).update({ is_active: false })

    for (const path of ['/kitchen', '/admin', '/']) {
      const response = await client.get(path).loginAs(user).redirects(0)
      assert.equal(response.header('location'), '/login', path)
    }
  })
})
