/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import hash from '@adonisjs/core/services/hash'
import limiter from '@adonisjs/limiter/services/main'
import db from '@adonisjs/lucid/services/db'
import { UserFactory } from '#database/factories/user_factory'
import User from '#models/user'
import UserToken from '#models/user_token'
import { KNOWN_DEVICE_COOKIE, knownDeviceHash } from '#support/known_device'
import { setupSchool } from '#tests/helpers/families'

const CURRENT = 'secret-password'
const NEW_PASSWORD = 'Brand-new-pass-2026'

function change(client: any, user: User, body: Record<string, string>) {
  return client.put('/account/password').loginAs(user).form(body).withCsrfToken().redirects(0)
}

/** D30 — parent "Account" tab: change password. */
test.group('Account | change password (D30)', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return testUtils.db().truncate()
  })

  test('the account page renders for parents only', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()

    const page = await client.get('/account').loginAs(parent).withInertia()
    page.assertStatus(200)
    page.assertInertiaComponent('parent/account/index')
    const props = page.inertiaProps as any
    assert.equal(props.account.email, parent.email)
    assert.equal(props.minLength, 10)
    assert.notProperty(props.account, 'password')

    const staff = await client.get('/account').loginAs(manager).withInertia()
    staff.assertStatus(403)
    const guest = await client.get('/account').redirects(0)
    assert.equal(guest.header('location'), '/login')
  })

  test('a wrong current password changes nothing and is never flashed back', async ({
    client,
    assert,
  }) => {
    const { school } = await setupSchool()
    const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()

    const res = await change(client, parent, {
      currentPassword: 'not-my-password1',
      password: NEW_PASSWORD,
      password_confirmation: NEW_PASSWORD,
    })
    res.assertStatus(302)
    assert.equal(res.header('location'), '/account')
    const errors = res.flashMessage('inputErrorsBag') as Record<string, string[]>
    assert.match(errors.currentPassword[0], /actuel est incorrect/)
    assert.notInclude(JSON.stringify(res.flashMessages()), 'not-my-password1')
    assert.notInclude(JSON.stringify(res.flashMessages()), NEW_PASSWORD)

    const fresh = await User.findOrFail(parent.id)
    assert.isTrue(await hash.verify(fresh.password!, CURRENT))
    assert.equal(fresh.credentialsVersion, 0)
  })

  test('the new password follows the strength rules and must differ', async ({
    client,
    assert,
  }) => {
    const { school } = await setupSchool()
    const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()

    const weak = await change(client, parent, {
      currentPassword: CURRENT,
      password: 'short1',
      password_confirmation: 'short1',
    })
    const weakErrors = weak.flashMessage('inputErrorsBag') as Record<string, string[]>
    assert.property(weakErrors, 'password')
    assert.notInclude(JSON.stringify(weak.flashMessages()), CURRENT)

    const mismatch = await change(client, parent, {
      currentPassword: CURRENT,
      password: NEW_PASSWORD,
      password_confirmation: `${NEW_PASSWORD}x`,
    })
    assert.property(mismatch.flashMessage('inputErrorsBag'), 'password_confirmation')

    const same = await change(client, parent, {
      currentPassword: 'secret-password',
      password: 'secret-password1',
      password_confirmation: 'secret-password1',
    })
    same.assertStatus(302)
    const fresh = await User.findOrFail(parent.id)
    // 'secret-password1' differs from the current one: accepted.
    assert.isTrue(await hash.verify(fresh.password!, 'secret-password1'))

    const identical = await change(client, fresh, {
      currentPassword: 'secret-password1',
      password: 'secret-password1',
      password_confirmation: 'secret-password1',
    })
    const errors = identical.flashMessage('inputErrorsBag') as Record<string, string[]>
    assert.match(errors.password[0], /différent/)
  })

  test('success: password saved, other sessions and links end, this session stays', async ({
    client,
    assert,
  }) => {
    const { school } = await setupSchool()
    const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
    // A remember-me login elsewhere and an open reset link.
    await client
      .post('/login')
      .form({ email: parent.email, password: CURRENT, remember: 'on' })
      .withCsrfToken()
      .redirects(0)
    await parent.refresh()
    assert.lengthOf(await db.from('remember_me_tokens').where('tokenable_id', parent.id), 1)
    await UserToken.create({
      userId: parent.id,
      type: 'password_reset',
      tokenHash: 'a'.repeat(64),
      expiresAt: (await import('luxon')).DateTime.now().plus({ hours: 1 }),
      createdBy: null,
      requestIp: null,
    })
    const before = parent.credentialsVersion

    const res = await change(client, parent, {
      currentPassword: CURRENT,
      password: NEW_PASSWORD,
      password_confirmation: NEW_PASSWORD,
    })
    res.assertStatus(302)
    assert.equal(res.header('location'), '/account')
    res.assertFlashMessage(
      'success',
      'Votre mot de passe a été changé. Vos autres appareils ont été déconnectés.'
    )

    const fresh = await User.findOrFail(parent.id)
    assert.isTrue(await hash.verify(fresh.password!, NEW_PASSWORD))
    assert.equal(fresh.credentialsVersion, before + 1)
    assert.lengthOf(await db.from('remember_me_tokens').where('tokenable_id', parent.id), 0)
    const open = await UserToken.query()
      .where('user_id', parent.id)
      .whereNull('used_at')
      .whereNull('revoked_at')
    assert.lengthOf(open, 0)

    // This browser: session re-bound to the new version + known-device cookie renewed.
    assert.equal(res.session().auth_cv, fresh.credentialsVersion)
    assert.deepEqual(res.cookie(KNOWN_DEVICE_COOKIE)?.value, [knownDeviceHash(fresh)])
    const stays = await client.get('/').loginAs(fresh).redirects(0)
    stays.assertStatus(200)

    // Any other session (old version) is logged out on its next request.
    // (loginAs binds the session to the version of the object it gets: the
    // stale `parent` still holds the old one.)
    assert.equal(parent.credentialsVersion, before)
    const other = await client.get('/').loginAs(parent).redirects(0)
    assert.equal(other.header('location'), '/login')

    // The new password signs in; the old one no longer does.
    const oldLogin = await client
      .post('/login')
      .form({ email: parent.email, password: CURRENT })
      .withCsrfToken()
      .redirects(0)
    assert.equal(oldLogin.header('location'), '/login')
    const newLogin = await client
      .post('/login')
      .form({ email: parent.email, password: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(newLogin.header('location'), '/')
  })

  test('rate-limited: 5 attempts per 15 minutes per user', async ({ client, assert }) => {
    const { school } = await setupSchool()
    const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
    for (let i = 0; i < 5; i++) {
      const res = await change(client, parent, {
        currentPassword: `wrong-password-${i}`,
        password: NEW_PASSWORD,
        password_confirmation: NEW_PASSWORD,
      })
      assert.property(res.flashMessage('inputErrorsBag'), 'currentPassword')
    }
    const blocked = await change(client, parent, {
      currentPassword: CURRENT,
      password: NEW_PASSWORD,
      password_confirmation: NEW_PASSWORD,
    })
    assert.match(String(blocked.flashMessage('error')), /Trop de tentatives/)
    const fresh = await User.findOrFail(parent.id)
    assert.isTrue(await hash.verify(fresh.password!, CURRENT))
  })
})
