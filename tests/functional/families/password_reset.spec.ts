import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import UserToken from '#models/user_token'
import { UserFactory } from '#database/factories/user_factory'
import { KNOWN_DEVICE_COOKIE, knownDeviceHash } from '#support/known_device'
import { LOGIN_LIMITS, PASSWORD_LINK_LIMITS } from '#start/limiter'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { linkValid, pathOf } from '#tests/helpers/families'

const SENT =
  "Si un compte existe pour cette adresse, un e-mail avec un lien de réinitialisation vient d'être envoyé. Le lien est valable 60 minutes."
const NEW_PASSWORD = 'Tajine2026!'

function requestReset(client: any, email: string, ip = '203.0.113.7') {
  return client
    .post('/password/forgot')
    .header('x-forwarded-for', ip)
    .form({ email })
    .withCsrfToken()
    .redirects(0)
}

test.group('Families | password reset', (group) => {
  let mails: ReturnType<typeof mail.fake>['mails']
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
  group.each.setup(() => {
    mails = mail.fake().mails
    return () => {
      mail.restore()
      restoreClock()
    }
  })

  test('the response is the same for existing, unknown and inactive emails', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('parent').create()
    const inactive = await UserFactory.apply('parent').apply('inactive').create()

    const responses = []
    for (const email of [user.email, 'nobody@example.test', inactive.email]) {
      responses.push(await requestReset(client, email))
    }
    for (const response of responses) {
      response.assertStatus(302)
      assert.equal(response.header('location'), '/password/forgot')
      response.assertFlashMessage('success', SENT)
      assert.isUndefined(response.flashMessage('error'))
    }

    // Only the existing, active account gets an email (queued, not awaited)
    assert.lengthOf(mails.queued(), 1)
    assert.lengthOf(mails.sent(), 0)
    assert.lengthOf(await UserToken.query().where('type', 'password_reset'), 1)
  })

  test('the reset link works once, within 60 minutes, and logs the user in', async ({
    client,
    assert,
  }) => {
    const clock = freezeClock('2026-11-02T08:00')
    const user = await UserFactory.apply('parent').merge({ locale: 'en' }).create()

    await requestReset(client, user.email)
    const message = mails.queued()[0]
    await message.buildWithContents()
    assert.equal(message.message.toJSON().message.subject, 'Reset your password')
    const path = pathOf(message)
    assert.match(path, /^\/password\/reset\/[A-Za-z0-9_-]{43}$/)

    clock.travel({ minutes: 59 })
    const response = await client
      .post(path)
      .form({ password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(response.header('location'), '/')
    await user.refresh()
    assert.equal(user.credentialsVersion, 1)
    assert.deepEqual(response.cookie(KNOWN_DEVICE_COOKIE)?.value, [knownDeviceHash(user)])

    const reuse = await client
      .post(path)
      .form({ password: 'Other2026pass', password_confirmation: 'Other2026pass' })
      .withCsrfToken()
      .redirects(0)
    assert.equal(reuse.header('location'), path)
  })

  test('a reset link older than 60 minutes fails', async ({ client, assert }) => {
    const clock = freezeClock('2026-11-02T08:00')
    const user = await UserFactory.apply('parent').create()
    await requestReset(client, user.email)
    const path = pathOf(mails.queued()[0])

    clock.travel({ minutes: 61 })
    const page = await client.get(path).withInertia()
    assert.isFalse((page.inertiaProps as any).valid)
  })

  test('a new request revokes the previous reset link', async ({ client, assert }) => {
    const user = await UserFactory.apply('parent').create()
    await requestReset(client, user.email)
    await requestReset(client, user.email)
    const [first, second] = mails.queued().map(pathOf)

    assert.isFalse(await linkValid(client, first))
    assert.isTrue(await linkValid(client, second))
  })

  test('resetting ends old sessions, remember-me tokens and known-device cookies', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('parent').create()

    const login = await client
      .post('/login')
      .form({ email: user.email, password: 'secret-password', remember: 'on' })
      .withCsrfToken()
      .redirects(0)
    const oldCookie = login.cookie(KNOWN_DEVICE_COOKIE)!.value
    assert.lengthOf(await db.from('remember_me_tokens').where('tokenable_id', user.id), 1)

    const sessionBefore = await client
      .get('/')
      .loginAs(user)
      .withSession({ auth_cv: 0 })
      .redirects(0)
    sessionBefore.assertStatus(200)

    await requestReset(client, user.email)
    await client
      .post(pathOf(mails.queued()[0]))
      .form({ password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)

    assert.lengthOf(await db.from('remember_me_tokens').where('tokenable_id', user.id), 0)

    const sessionAfter = await client
      .get('/')
      .loginAs(user)
      .withSession({ auth_cv: 0 })
      .redirects(0)
    assert.equal(sessionAfter.header('location'), '/login')
    sessionAfter.assertFlashMessage(
      'error',
      'Votre session a pris fin car les informations de connexion du compte ont changé. Reconnectez-vous.'
    )

    // The old known-device cookie no longer matches the account
    await user.refresh()
    assert.notDeepEqual(oldCookie, [knownDeviceHash(user)])
  })

  test('the request endpoint is rate-limited per IP without consuming login limits', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('parent').create()
    const limit = PASSWORD_LINK_LIMITS.requestIp.requests

    for (let i = 0; i < limit; i++) {
      const response = await requestReset(client, `someone${i}@example.test`, '198.51.100.9')
      response.assertFlashMessage('success', SENT)
    }
    const blocked = await requestReset(client, user.email, '198.51.100.9')
    assert.match(String(blocked.flashMessage('error')), /^Trop de demandes/)
    assert.lengthOf(mails.queued(), 0)

    // Another IP is not affected
    const other = await requestReset(client, user.email, '198.51.100.10')
    other.assertFlashMessage('success', SENT)

    // Login from the blocked IP still has its full budget
    for (let i = 0; i < LOGIN_LIMITS.ipEmail.requests - 1; i++) {
      await client
        .post('/login')
        .header('x-forwarded-for', '198.51.100.9')
        .form({ email: user.email, password: 'wrong' })
        .withCsrfToken()
        .redirects(0)
    }
    const login = await client
      .post('/login')
      .header('x-forwarded-for', '198.51.100.9')
      .form({ email: user.email, password: 'secret-password' })
      .withCsrfToken()
      .redirects(0)
    assert.equal(login.header('location'), '/')
  })

  test('the per-email limit silently stops sending, with the same response', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('parent').create()
    const limit = PASSWORD_LINK_LIMITS.requestEmail.requests

    for (let i = 0; i < limit + 2; i++) {
      const response = await requestReset(client, user.email, `192.0.2.${i + 1}`)
      response.assertFlashMessage('success', SENT)
    }
    assert.lengthOf(mails.queued(), limit)
  })

  test('the set-password endpoint is rate-limited per IP', async ({ client, assert }) => {
    const limit = PASSWORD_LINK_LIMITS.confirmIp.requests
    for (let i = 0; i < limit; i++) {
      await client
        .post(`/password/reset/${'a'.repeat(43)}`)
        .header('x-forwarded-for', '198.51.100.77')
        .form({ password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD })
        .withCsrfToken()
        .redirects(0)
    }
    const blocked = await client
      .post(`/password/reset/${'a'.repeat(43)}`)
      .header('x-forwarded-for', '198.51.100.77')
      .form({ password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.match(String(blocked.flashMessage('error')), /^Trop de tentatives/)
  })

  test('the login page links to the forgot-password page', async ({ client }) => {
    const page = await client.get('/password/forgot').withInertia()
    page.assertStatus(200)
    page.assertInertiaComponent('auth/forgot_password')
  })
})
