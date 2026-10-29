import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { UserFactory } from '#database/factories/user_factory'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { SESSION_ABSOLUTE_HOURS, SESSION_IDLE_MINUTES } from '#support/login_session'

const MINUTE = 60_000

/** Security review M1: cookie sessions expire server-side (idle + absolute). */
test.group('Hardening | session lifetime', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return testUtils.db().truncate()
  })
  group.each.teardown(() => restoreClock())

  function session(userId: number, issuedAgoMin: number, seenAgoMin: number, now: number) {
    return {
      auth_web: userId,
      auth_cv: 0,
      auth_iat: now - issuedAgoMin * MINUTE,
      auth_seen: now - seenAgoMin * MINUTE,
    }
  }

  test('an active session keeps working and its last-seen time moves', async ({
    client,
    assert,
  }) => {
    const clock = freezeClock('2026-11-02T10:00')
    const now = clock.now().toMillis()
    const user = await UserFactory.apply('parent').create()
    const res = await client
      .get('/')
      .withSession(session(user.id, 180, SESSION_IDLE_MINUTES - 1, now))
      .redirects(0)
    res.assertStatus(200)
    assert.equal(res.session().auth_seen, now)
    assert.equal(res.session().auth_iat, now - 180 * MINUTE)

    // Seen less than a minute ago: not rewritten (limits cookie churn).
    const recent = await client
      .get('/')
      .withSession(session(user.id, 10, 0.5, now))
      .redirects(0)
    recent.assertStatus(200)
    assert.equal(recent.session().auth_seen, now - 0.5 * MINUTE)
  })

  test('idle for too long → signed out with a message', async ({ client, assert }) => {
    const clock = freezeClock('2026-11-02T10:00')
    const now = clock.now().toMillis()
    const user = await UserFactory.apply('parent').create()
    const res = await client
      .get('/')
      .withSession(session(user.id, 200, SESSION_IDLE_MINUTES + 1, now))
      .redirects(0)
    assert.equal(res.header('location'), '/login')
    res.assertFlashMessage('error', 'Votre session a expiré. Reconnectez-vous.')
    assert.notProperty(res.session(), 'auth_web')
    assert.notProperty(res.session(), 'auth_cv')
  })

  test('older than the absolute lifetime → signed out even if active', async ({
    client,
    assert,
  }) => {
    const clock = freezeClock('2026-11-02T10:00')
    const now = clock.now().toMillis()
    const user = await UserFactory.apply('parent').create()
    const res = await client
      .get('/')
      .withSession(session(user.id, SESSION_ABSOLUTE_HOURS * 60 + 1, 1, now))
      .redirects(0)
    assert.equal(res.header('location'), '/login')
    const fine = await client
      .get('/')
      .withSession(session(user.id, SESSION_ABSOLUTE_HOURS * 60 - 1, 1, now))
      .redirects(0)
    fine.assertStatus(200)
  })

  test('with a remember-me cookie, an expired session restarts fresh', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('parent').create()
    const clock = freezeClock('2026-11-02T10:00')
    const login = await client
      .post('/login')
      .form({ email: user.email, password: 'secret-password', remember: 'on' })
      .withCsrfToken()
      .redirects(0)
    const remember = login.cookie('remember_web')!.value

    clock.travel({ hours: SESSION_ABSOLUTE_HOURS + 1 })
    const now = clock.now().toMillis()
    const expired = await client
      .get('/orders/history')
      .withSession(session(user.id, SESSION_ABSOLUTE_HOURS * 60 + 60, 30, now))
      .withEncryptedCookie('remember_web', remember)
      .redirects(0)
    assert.equal(expired.header('location'), '/orders/history')

    const restored = await client
      .get('/orders/history')
      .withEncryptedCookie('remember_web', remember)
      .redirects(0)
    restored.assertStatus(200)
    assert.equal(restored.session().auth_iat, now)
    assert.equal(restored.session().auth_seen, now)
  })
})
