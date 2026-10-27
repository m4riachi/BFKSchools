import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import User from '#models/user'
import { UserFactory } from '#database/factories/user_factory'
import { freezeClock, restoreClock } from '#tests/helpers/clock'

const PASSWORD = 'secret-password'

test.group('Auth | login', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
  group.each.teardown(() => restoreClock())

  test('shows the login page to guests', async ({ client }) => {
    const response = await client.get('/login').withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('auth/login')
  })

  for (const [role, home] of [
    ['admin', '/admin'],
    ['manager', '/admin'],
    ['kitchen', '/kitchen'],
    ['parent', '/'],
  ] as const) {
    test('a {0} is redirected to {1} after login')
      .with([[role, home]] as const)
      .run(async ({ client, assert }, [userRole, expected]) => {
        const user = await UserFactory.apply(userRole).create()

        const response = await client
          .post('/login')
          .form({ email: user.email, password: PASSWORD })
          .withCsrfToken()
          .redirects(0)

        response.assertStatus(302)
        assert.equal(response.header('location'), expected)
      })
  }

  test('email matching is case-insensitive and records last_login_at', async ({
    client,
    assert,
  }) => {
    freezeClock('2026-11-02T08:59')
    const user = await UserFactory.apply('admin').merge({ email: 'nadia@example.test' }).create()

    const response = await client
      .post('/login')
      .form({ email: '  NADIA@Example.TEST ', password: PASSWORD })
      .withCsrfToken()
      .redirects(0)

    assert.equal(response.header('location'), '/admin')
    await user.refresh()
    assert.equal(
      user.lastLoginAt?.setZone('Africa/Casablanca').toFormat('yyyy-MM-dd HH:mm'),
      '2026-11-02 08:59'
    )
  })

  test('a wrong password shows a translated error', async ({ client, assert }) => {
    const user = await UserFactory.apply('admin').create()

    const response = await client
      .post('/login')
      .form({ email: user.email, password: 'wrong-password' })
      .withCsrfToken()
      .redirects(0)

    assert.equal(response.header('location'), '/login')
    response.assertFlashMessage('error', 'E-mail ou mot de passe incorrect.')
  })

  test('the error follows the browser language for guests', async ({ client }) => {
    const response = await client
      .post('/login')
      .header('accept-language', 'en-US,en;q=0.9')
      .form({ email: 'nobody@example.test', password: 'whatever' })
      .withCsrfToken()
      .redirects(0)

    response.assertFlashMessage('error', 'Incorrect email or password.')
  })

  test('an unknown email or a user without password gets the same error', async ({ client }) => {
    const invited = await UserFactory.merge({ password: null }).create()

    for (const email of ['nobody@example.test', invited.email]) {
      const response = await client
        .post('/login')
        .form({ email, password: PASSWORD })
        .withCsrfToken()
        .redirects(0)
      response.assertFlashMessage('error', 'E-mail ou mot de passe incorrect.')
    }
  })

  test('invalid input returns field errors', async ({ client, assert }) => {
    const response = await client
      .post('/login')
      .form({ email: 'not-an-email', password: '' })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    // v7 flashes field errors in `inputErrorsBag` (the session plugin's
    // assertValidationErrors still reads the old `errors` key).
    const bag = response.flashMessage('inputErrorsBag') as Record<string, string[]>
    assert.deepEqual(bag.email, ['Saisissez une adresse e-mail valide.'])
  })

  test('an inactive user cannot log in', async ({ client, assert }) => {
    const user = await UserFactory.apply('parent').apply('inactive').create()

    const response = await client
      .post('/login')
      .form({ email: user.email, password: PASSWORD })
      .withCsrfToken()
      .redirects(0)

    assert.equal(response.header('location'), '/login')
    response.assertFlashMessage('error', 'Votre compte est désactivé. Contactez BFK.')

    const home = await client.get('/').redirects(0)
    assert.equal(home.header('location'), '/login')
  })

  test('the 6th failed login within a minute is refused', async ({ client, assert }) => {
    const user = await UserFactory.apply('admin').create()

    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await client
        .post('/login')
        .form({ email: user.email, password: 'wrong-password' })
        .withCsrfToken()
        .redirects(0)
      response.assertFlashMessage('error', 'E-mail ou mot de passe incorrect.')
    }

    const blocked = await client
      .post('/login')
      .form({ email: user.email, password: PASSWORD })
      .withCsrfToken()
      .redirects(0)

    assert.equal(blocked.header('location'), '/login')
    blocked.assertFlashMessage(
      'error',
      'Trop de tentatives de connexion. Réessayez dans 20 minutes.'
    )
  })

  test('the limit is per email: another account can still log in', async ({ client, assert }) => {
    const target = await UserFactory.apply('admin').create()
    const other = await UserFactory.apply('kitchen').create()

    for (let attempt = 1; attempt <= 6; attempt++) {
      await client
        .post('/login')
        .form({ email: target.email, password: 'wrong-password' })
        .withCsrfToken()
        .redirects(0)
    }

    const response = await client
      .post('/login')
      .form({ email: other.email, password: PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(response.header('location'), '/kitchen')
  })

  test('"keep me signed in" creates a remember-me token', async ({ client, assert }) => {
    const user = await UserFactory.apply('parent').create()

    const response = await client
      .post('/login')
      .form({ email: user.email, password: PASSWORD, remember: 'on' })
      .withCsrfToken()
      .redirects(0)

    assert.equal(response.header('location'), '/')
    const tokens = await db.from('remember_me_tokens').where('tokenable_id', user.id)
    assert.lengthOf(tokens, 1)
  })

  test('without "keep me signed in" no token is stored', async ({ client, assert }) => {
    const user = await UserFactory.apply('parent').create()

    await client
      .post('/login')
      .form({ email: user.email, password: PASSWORD })
      .withCsrfToken()
      .redirects(0)

    const tokens = await db.from('remember_me_tokens').where('tokenable_id', user.id)
    assert.lengthOf(tokens, 0)
  })

  test('login without a CSRF token is refused', async ({ client, assert }) => {
    const user = await UserFactory.apply('admin').create()

    const response = await client
      .post('/login')
      .form({ email: user.email, password: PASSWORD })
      .redirects(0)

    assert.notEqual(response.header('location'), '/admin')
  })

  test('a logged-in user visiting /login goes to their home', async ({ client, assert }) => {
    const user = await UserFactory.apply('kitchen').create()
    const response = await client.get('/login').loginAs(user).redirects(0)
    assert.equal(response.header('location'), '/kitchen')
  })

  test('logout ends the session', async ({ client, assert }) => {
    const user = await UserFactory.apply('admin').create()

    const response = await client.post('/logout').loginAs(user).withCsrfToken().redirects(0)
    assert.equal(response.header('location'), '/login')
  })
})

test.group('Auth | deactivated while logged in', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a user deactivated after login is logged out on the next request', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('manager').create()

    const before = await client.get('/admin').loginAs(user).redirects(0)
    before.assertStatus(200)

    await User.query().where('id', user.id).update({ is_active: false })

    const after = await client.get('/admin').loginAs(user).redirects(0)
    assert.equal(after.header('location'), '/login')
    after.assertFlashMessage('error', 'Votre compte est désactivé. Contactez BFK.')
  })
})
