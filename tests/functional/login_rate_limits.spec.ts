import { setTimeout as sleep } from 'node:timers/promises'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import type { ApiClient } from '@japa/api-client'
import type User from '#models/user'
import Clock from '#services/clock'
import LoginService from '#services/login_service'
import { UserFactory } from '#database/factories/user_factory'
import logger from '@adonisjs/core/services/logger'
import { LOGIN_LIMITS, loginEmailLimiter, loginIpEmailLimiter, loginKeys } from '#start/limiter'
import { KNOWN_DEVICE_COOKIE, knownDeviceHash } from '#support/known_device'

const PASSWORD = 'secret-password'
const INVALID = 'E-mail ou mot de passe incorrect.'
const BLOCKED_20 = 'Trop de tentatives de connexion. Réessayez dans 20 minutes.'

/**
 * Counts how many requests reach password verification. The delay widens
 * the window in which a non-atomic limiter would let parallel requests in.
 */
class CountingLoginService extends LoginService {
  calls = 0
  async verifyCredentials(email: string, password: string): Promise<User> {
    this.calls++
    await sleep(50)
    return super.verifyCredentials(email, password)
  }
}

function login(client: ApiClient, email: string, password: string, ip?: string) {
  const request = client.post('/login').form({ email, password }).withCsrfToken().redirects(0)
  // The test client connects from 127.0.0.1, a trusted proxy by default
  // (TRUST_PROXY unset → loopback), so X-Forwarded-For sets request.ip().
  if (ip) request.header('x-forwarded-for', ip)
  return request
}

/** 10 IPs x 5 attempts: uses the per-email budget (50) without tripping IP+email (5). */
async function exhaustEmailBudget(client: ApiClient, email: string) {
  for (let attempt = 0; attempt < LOGIN_LIMITS.email.requests; attempt++) {
    const response = await login(client, email, 'wrong', `198.51.100.${attempt % 10}`)
    response.assertFlashMessage('error', INVALID)
  }
}

/** Captures `logger.warn` calls until the returned restore(). */
function captureWarnings(lines: string[]) {
  const target = logger as unknown as { warn: (...args: unknown[]) => void }
  const original = target.warn
  target.warn = (...args: unknown[]) => void lines.push(JSON.stringify(args))
  return () => {
    target.warn = original
  }
}

test.group('Auth | login rate limits', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))
  group.each.teardown(() => app.container.restore(LoginService))

  test('parallel attempts are counted before the password check', async ({ client, assert }) => {
    const user = await UserFactory.apply('admin').create()
    const service = new CountingLoginService(new Clock())
    app.container.swap(LoginService, () => service)

    const responses = await Promise.all(
      Array.from({ length: 12 }, () => login(client, user.email, 'wrong-password'))
    )
    const errors = responses.map((response) => String(response.flashMessage('error')))

    assert.equal(service.calls, 5)
    assert.equal(errors.filter((message) => message === INVALID).length, 5)
    assert.equal(errors.filter((message) => message === BLOCKED_20).length, 7)
  })

  test('parallel attempts cannot get a correct password through once blocked', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('admin').create()
    const service = new CountingLoginService(new Clock())
    app.container.swap(LoginService, () => service)

    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        login(client, user.email, index === 7 ? PASSWORD : 'wrong-password')
      )
    )

    assert.isAtMost(service.calls, 5)
    assert.isAtMost(
      responses.filter((response) => response.header('location') === '/admin').length,
      1
    )
  })

  test('a successful login resets the IP+email and email counters', async ({ client, assert }) => {
    const user = await UserFactory.apply('admin').create()

    for (let attempt = 1; attempt <= 4; attempt++) {
      const response = await login(client, user.email, 'wrong-password')
      response.assertFlashMessage('error', INVALID)
    }

    const success = await login(client, user.email, PASSWORD)
    assert.equal(success.header('location'), '/admin')
    assert.isNull(await loginIpEmailLimiter().get(loginKeys.ipEmail('127.0.0.1', user.email)))
    assert.isNull(await loginEmailLimiter().get(loginKeys.email(user.email)))

    // Without the reset, the 2nd attempt below would already be refused (4 + 1 + 1 > 5).
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await login(client, user.email, 'wrong-password')
      response.assertFlashMessage('error', INVALID)
    }
    const blocked = await login(client, user.email, PASSWORD)
    blocked.assertFlashMessage('error', BLOCKED_20)
  })

  test('per email: 50 failures from many IPs block the account for every IP', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('parent').create()
    const other = await UserFactory.apply('parent').create()

    await exhaustEmailBudget(client, user.email)

    const blocked = await login(client, user.email, PASSWORD, '203.0.113.7')
    assert.equal(blocked.header('location'), '/login')
    const message = String(blocked.flashMessage('error'))
    assert.match(message, /^Trop de tentatives de connexion\. Réessayez dans 1?\d minutes?\.$/)
    assert.notEqual(message, BLOCKED_20)

    // No long block: the key just expires with its 15-minute window.
    const state = await loginEmailLimiter().get(loginKeys.email(user.email))
    assert.isAtMost(state!.availableIn, 15 * 60)

    // Other accounts are unaffected.
    const ok = await login(client, other.email, PASSWORD, '203.0.113.7')
    assert.equal(ok.header('location'), '/')
  })

  test('the per-email limit logs one masked warning when it trips', async ({ client, assert }) => {
    const user = await UserFactory.apply('parent').merge({ email: 'salma@example.test' }).create()
    const lines: string[] = []
    const restore = captureWarnings(lines)

    try {
      await exhaustEmailBudget(client, user.email)
      await login(client, user.email, PASSWORD, '203.0.113.7')
      await login(client, user.email, PASSWORD, '203.0.113.8')
    } finally {
      restore()
    }

    const warnings = lines.filter((line) => line.includes('per-email limit reached'))
    assert.lengthOf(warnings, 1)
    assert.include(warnings[0], 's***@example.test')
    assert.notInclude(warnings[0], 'salma@')
  })

  test('a known-device cookie lets the real user in after the per-email budget is exhausted', async ({
    client,
    assert,
  }) => {
    const victim = await UserFactory.apply('parent').create()

    // The victim signed in on this browser before: the response sets the cookie.
    const first = await login(client, victim.email, PASSWORD, '192.0.2.1')
    assert.equal(first.header('location'), '/')
    const cookie = first.cookie(KNOWN_DEVICE_COOKIE)
    assert.deepEqual(cookie?.value, [knownDeviceHash(victim)])

    await exhaustEmailBudget(client, victim.email)

    const withoutCookie = await login(client, victim.email, PASSWORD, '192.0.2.1')
    assert.equal(withoutCookie.header('location'), '/login')
    assert.match(String(withoutCookie.flashMessage('error')), /^Trop de tentatives/)

    const withCookie = await login(client, victim.email, PASSWORD, '192.0.2.1').withEncryptedCookie(
      KNOWN_DEVICE_COOKIE,
      cookie!.value
    )
    assert.equal(withCookie.header('location'), '/')
  })

  test('a known-device cookie stops bypassing the limit after the credentials change', async ({
    client,
    assert,
  }) => {
    const victim = await UserFactory.apply('parent').create()
    const first = await login(client, victim.email, PASSWORD, '192.0.2.1')
    const cookie = first.cookie(KNOWN_DEVICE_COOKIE)!

    // Password changed elsewhere (reset, invitation…): credentials version bumped
    victim.password = 'Changed-password-2026'
    await victim.save()
    assert.equal(victim.credentialsVersion, 1)

    await exhaustEmailBudget(client, victim.email)
    const response = await login(
      client,
      victim.email,
      'Changed-password-2026',
      '192.0.2.1'
    ).withEncryptedCookie(KNOWN_DEVICE_COOKIE, cookie.value)
    assert.equal(response.header('location'), '/login')
    assert.match(String(response.flashMessage('error')), /^Trop de tentatives/)
  })

  test('a known-device cookie for account A does not bypass the limit for account B', async ({
    client,
    assert,
  }) => {
    const accountA = await UserFactory.apply('parent').create()
    const accountB = await UserFactory.apply('parent').create()

    await exhaustEmailBudget(client, accountB.email)

    const response = await login(client, accountB.email, PASSWORD, '192.0.2.1').withEncryptedCookie(
      KNOWN_DEVICE_COOKIE,
      [knownDeviceHash(accountA)]
    )
    assert.equal(response.header('location'), '/login')
    assert.match(String(response.flashMessage('error')), /^Trop de tentatives/)

    // A forged (unencrypted) cookie is ignored too.
    const forged = await login(client, accountB.email, PASSWORD, '192.0.2.1').withPlainCookie(
      KNOWN_DEVICE_COOKIE,
      [knownDeviceHash(accountB)]
    )
    assert.equal(forged.header('location'), '/login')
  })

  test('the IP+email limit still applies to known-device holders', async ({ client }) => {
    const user = await UserFactory.apply('admin').create()
    const known = [knownDeviceHash(user)]

    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await login(client, user.email, 'wrong').withEncryptedCookie(
        KNOWN_DEVICE_COOKIE,
        known
      )
      response.assertFlashMessage('error', INVALID)
    }
    const blocked = await login(client, user.email, PASSWORD).withEncryptedCookie(
      KNOWN_DEVICE_COOKIE,
      known
    )
    blocked.assertFlashMessage('error', BLOCKED_20)
  })

  test('per IP: the 31st attempt in a minute is refused, whatever the email', async ({
    client,
    assert,
  }) => {
    const user = await UserFactory.apply('kitchen').create()

    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await login(client, `spray${attempt}@example.test`, 'Password1')
      response.assertFlashMessage('error', INVALID)
    }

    const blocked = await login(client, user.email, PASSWORD)
    assert.equal(blocked.header('location'), '/login')
    blocked.assertFlashMessage('error', 'Trop de tentatives de connexion. Réessayez dans 1 minute.')

    const otherIp = await login(client, user.email, PASSWORD, '192.0.2.10')
    assert.equal(otherIp.header('location'), '/kitchen')
  })

  test('per IP: IPv6 clients share one budget per /64', async ({ client, assert }) => {
    const user = await UserFactory.apply('kitchen').create()

    for (let attempt = 0; attempt < 30; attempt++) {
      const ip = `2001:db8:1:2::${(attempt + 1).toString(16)}`
      const response = await login(client, `spray${attempt}@example.test`, 'Password1', ip)
      response.assertFlashMessage('error', INVALID)
    }

    const sameSubnet = await login(client, user.email, PASSWORD, '2001:db8:1:2:ffff::1')
    assert.equal(sameSubnet.header('location'), '/login')

    const otherSubnet = await login(client, user.email, PASSWORD, '2001:db8:1:3::1')
    assert.equal(otherSubnet.header('location'), '/kitchen')
  })

  test('unknown email and wrong password consume the limit the same way', async ({ client }) => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      const response = await login(client, 'nobody@example.test', 'whatever')
      response.assertFlashMessage('error', INVALID)
    }
    const blocked = await login(client, 'nobody@example.test', 'whatever')
    blocked.assertFlashMessage('error', BLOCKED_20)
  })
})
