import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import { UserFactory } from '#database/factories/user_factory'

test.group('Locale', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('the back-office defaults to French', async ({ client, assert }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin').loginAs(admin).withInertia()

    assert.equal(response.inertiaProps.locale, 'fr')
    assert.equal(response.inertiaProps.messages['nav.dashboard'], 'Tableau de bord')
  })

  test('switching to EN saves the user locale and changes UI strings', async ({
    client,
    assert,
  }) => {
    const parent = await UserFactory.apply('parent').create()

    const switched = await client
      .post('/locale')
      .form({ locale: 'en' })
      .loginAs(parent)
      .withCsrfToken()
      .redirects(0)
    switched.assertStatus(302)

    await parent.refresh()
    assert.equal(parent.locale, 'en')

    const page = await client.get('/').loginAs(parent).withInertia()
    assert.equal(page.inertiaProps.locale, 'en')
    assert.equal(page.inertiaProps.messages['nav.parent_orders'], 'Orders')
    assert.equal(page.inertiaProps.messages['pages.parent_home.title'], 'Lunch orders')
  })

  test('guests switch with a cookie', async ({ client, assert }) => {
    const switched = await client
      .post('/locale')
      .form({ locale: 'en' })
      .withCsrfToken()
      .redirects(0)
    switched.assertStatus(302)
    assert.equal(switched.cookie('bfk_locale')?.value, 'en')

    const page = await client.get('/login').withPlainCookie('bfk_locale', 'en').withInertia()
    assert.equal(page.inertiaProps.locale, 'en')
    assert.equal(page.inertiaProps.messages['auth.login.title'], 'Sign in')
  })

  test('an unknown locale is rejected', async ({ client, assert }) => {
    const parent = await UserFactory.apply('parent').create()

    await client.post('/locale').form({ locale: 'de' }).loginAs(parent).withCsrfToken().redirects(0)

    await parent.refresh()
    assert.equal(parent.locale, 'fr')
  })

  test('server-only translations are not sent to the browser', async ({ client, assert }) => {
    const response = await client.get('/login').withInertia()
    const keys = Object.keys(response.inertiaProps.messages)
    assert.isTrue(keys.length > 0)
    assert.isFalse(keys.some((key) => key.startsWith('validator.')))
  })
})
