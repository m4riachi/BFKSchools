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
import app from '@adonisjs/core/services/app'
import DeferredTasks from '#services/deferred_tasks'
import UserTokenService from '#services/user_token_service'
import User from '#models/user'

const SENT =
  "Si un compte existe pour cette adresse, un e-mail avec un lien de réinitialisation vient d'être envoyé. Le lien est valable 60 minutes."
const NEW_PASSWORD = 'Tajine2026!'

function postReset(client: any, email: string, ip = '203.0.113.7') {
  return client
    .post('/password/forgot')
    .header('x-forwarded-for', ip)
    .form({ email })
    .withCsrfToken()
    .redirects(0)
}

async function drainDeferred() {
  const tasks = await app.container.make(DeferredTasks)
  await tasks.drain()
}

/** Posts the form, then waits for the work deferred after the response. */
async function requestReset(client: any, email: string, ip = '203.0.113.7') {
  const response = await postReset(client, email, ip)
  await drainDeferred()
  return response
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

  test('the response is the same for existing, unknown, inactive and never-activated emails', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('parent').create()
    const inactive = await UserFactory.apply('parent').apply('inactive').create()
    const invited = await UserFactory.apply('parent').apply('invited').create()

    const responses = []
    for (const email of [user.email, 'nobody@example.test', inactive.email, invited.email]) {
      responses.push(await requestReset(client, email))
    }
    for (const response of responses) {
      response.assertStatus(302)
      assert.equal(response.header('location'), '/password/forgot')
      response.assertFlashMessage('success', SENT)
      assert.isUndefined(response.flashMessage('error'))
    }

    // Only the existing, active account with a password gets an email
    assert.lengthOf(mails.sent(), 1)
    assert.deepEqual(mails.sent()[0].message.toJSON().message.to, [user.email])
    const tokens = await UserToken.query().where('type', 'password_reset')
    assert.deepEqual(
      tokens.map((t) => t.userId),
      [user.id]
    )
  })

  test('the account lookup, token and email happen after the response', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('parent').create()

    const response = await postReset(client, user.email)
    response.assertFlashMessage('success', SENT)
    // Nothing account-specific ran on the request path
    assert.lengthOf(await UserToken.all(), 0)
    assert.lengthOf(mails.sent(), 0)

    await drainDeferred()
    assert.lengthOf(await UserToken.all(), 1)
    assert.lengthOf(mails.sent(), 1)
  })

  test('D17: a parent who never set a password gets no token and no email', async ({
    client,
    assert,
  }) => {
    const invited = await UserFactory.apply('parent').apply('invited').create()
    const response = await requestReset(client, invited.email)
    response.assertFlashMessage('success', SENT)
    assert.lengthOf(await UserToken.query().where('user_id', invited.id), 0)
    assert.lengthOf(mails.sent(), 0)
  })

  test('errors in the deferred work are logged, never surfaced', async ({ client, assert }) => {
    const user = await UserFactory.apply('parent').create()
    const original = User.findByEmail
    User.findByEmail = (() => Promise.reject(new Error('db down'))) as typeof User.findByEmail
    try {
      const response = await requestReset(client, user.email)
      response.assertStatus(302)
      response.assertFlashMessage('success', SENT)
    } finally {
      User.findByEmail = original
    }
    assert.lengthOf(mails.sent(), 0)
  })

  test('concurrent resets leave exactly one valid link', async ({ assert }) => {
    const user = await UserFactory.apply('parent').create()
    const tokens = await app.container.make(UserTokenService)

    const issued = await Promise.all(
      Array.from({ length: 5 }, () =>
        db.transaction((trx) => tokens.issue(user, 'password_reset', { trx }))
      )
    )
    assert.lengthOf(issued, 5)
    const open = await UserToken.query()
      .where('user_id', user.id)
      .whereNull('used_at')
      .whereNull('revoked_at')
    assert.lengthOf(open, 1)
  })

  test('the database refuses a second open link of the same type', async ({ assert }) => {
    const user = await UserFactory.apply('parent').create()
    const row = (hash: string) => ({
      user_id: user.id,
      type: 'invitation',
      token_hash: hash,
      expires_at: new Date(Date.now() + 3_600_000),
    })
    await db.table('user_tokens').insert(row('a'.repeat(64)))
    await assert.rejects(
      () => db.table('user_tokens').insert(row('b'.repeat(64))),
      /user_tokens_one_open_per_type/
    )
  })

  test('the reset link works once, within 60 minutes, and logs the user in', async ({
    client,
    assert,
  }) => {
    const clock = freezeClock('2026-11-02T08:00')
    const user = await UserFactory.apply('parent').merge({ locale: 'en' }).create()

    await requestReset(client, user.email)
    const message = mails.sent()[0]
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
    const path = pathOf(mails.sent()[0])

    clock.travel({ minutes: 61 })
    const page = await client.get(path).withInertia()
    assert.isFalse((page.inertiaProps as any).valid)
  })

  test('a new request revokes the previous reset link', async ({ client, assert }) => {
    const user = await UserFactory.apply('parent').create()
    await requestReset(client, user.email)
    await requestReset(client, user.email)
    const [first, second] = mails.sent().map(pathOf)

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
      .post(pathOf(mails.sent()[0]))
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
    assert.lengthOf(mails.sent(), 0)

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
    assert.lengthOf(mails.sent(), limit)
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
