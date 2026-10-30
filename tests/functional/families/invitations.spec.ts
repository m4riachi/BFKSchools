/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import type User from '#models/user'
import UserToken from '#models/user_token'
import UserTokenService from '#services/user_token_service'
import type AccountLinkMail from '#mails/account_link_mail'
import { KNOWN_DEVICE_COOKIE, knownDeviceHash } from '#support/known_device'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { createParent, linkValid, pathOf, setupSchool, tokenOf } from '#tests/helpers/families'

const NEW_PASSWORD = 'Couscous2026'

async function whatsappFamily(phone: string | null, locale: 'fr' | 'en' = 'fr') {
  const school = await SchoolFactory.create()
  const manager = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
  const parent = await UserFactory.apply('invited')
    .merge({ schoolId: school.id, phone, locale, role: 'parent' })
    .create()
  return { school, manager, parent }
}

test.group('Families | invitations', (group) => {
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

  async function inviteWhatsapp(client: any, staff: User, parent: User) {
    return client
      .post(`/admin/parents/${parent.id}/invitation/whatsapp`)
      .loginAs(staff)
      .header('referer', `/admin/parents/${parent.id}`)
      .withCsrfToken()
      .redirects(0)
  }

  test('WhatsApp: a working link in the parent’s language, ready to send, and no email', async ({
    client,
    assert,
  }) => {
    const { manager, parent } = await whatsappFamily('0612345678', 'en')
    const response = await inviteWhatsapp(client, manager, parent)
    response.assertStatus(302)

    const url = new URL(response.flashMessage('whatsappInvite') as string)
    assert.equal(url.origin + url.pathname, 'https://wa.me/212612345678')
    const message = url.searchParams.get('text')!
    assert.include(message, 'Hello')
    assert.include(message, parent.fullName)
    mails.assertNoneSent()

    const link = message.match(/https?:\/\/\S+\/invitation\/\S+/)![0]
    const path = new URL(link).pathname
    // Opening the link (or WhatsApp previewing it) does not use it up.
    ;(await client.get(path)).assertStatus(200)
    ;(await client.get(path)).assertStatus(200)

    await parent.refresh()
    assert.isNotNull(parent.invitedAt)
    const page = await client.get(`/admin/parents/${parent.id}`).loginAs(manager).withInertia()
    assert.equal(page.body().props.parent.accessStatus, 'invited')
    assert.isTrue(page.body().props.hasWhatsapp)
    assert.isNull(page.body().props.whatsappInvite)
  })

  test('WhatsApp: a new link ends the previous one', async ({ client, assert }) => {
    const { manager, parent } = await whatsappFamily('+212612345678')
    const linkPath = (response: any) => {
      const message = new URL(response.flashMessage('whatsappInvite')).searchParams.get('text')!
      return new URL(message.match(/https?:\/\/\S+\/invitation\/\S+/)![0]).pathname
    }
    const first = linkPath(await inviteWhatsapp(client, manager, parent))
    const second = linkPath(await inviteWhatsapp(client, manager, parent))
    ;(await client.get(second)).assertStatus(200)
    assert.notEqual(first, second)
    const open = await UserToken.query()
      .where('user_id', parent.id)
      .whereNull('revoked_at')
      .whereNull('used_at')
    assert.lengthOf(open, 1)
  })

  test('WhatsApp: refused without a number, or once the parent has access', async ({
    client,
    assert,
  }) => {
    const none = await whatsappFamily(null)
    const noPhone = await inviteWhatsapp(client, none.manager, none.parent)
    assert.isUndefined(noPhone.flashMessage('whatsappInvite'))
    await none.parent.refresh()
    assert.isNull(none.parent.invitedAt)

    const active = await whatsappFamily('0612345678')
    active.parent.password = 'Secret12345'
    await active.parent.save()
    const refused = await inviteWhatsapp(client, active.manager, active.parent)
    assert.isUndefined(refused.flashMessage('whatsappInvite'))
  })

  test('WhatsApp: kitchen, parents and other schools cannot', async ({ client, assert }) => {
    const { school, parent } = await whatsappFamily('0612345678')
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const other = await SchoolFactory.create()
    const stranger = await UserFactory.apply('manager').merge({ schoolId: other.id }).create()
    for (const [user, status] of [
      [kitchen, 403],
      [parent, 403],
      [stranger, 404],
    ] as const) {
      const response = await client
        .post(`/admin/parents/${parent.id}/invitation/whatsapp`)
        .loginAs(user)
        .withCsrfToken()
        .header('Accept', 'application/json')
      assert.equal(response.status(), status)
    }
    await parent.refresh()
    assert.isNull(parent.invitedAt)
  })

  async function invite(client: any, manager: User, parent: User) {
    const response = await client
      .post(`/admin/parents/${parent.id}/invitation`)
      .loginAs(manager)
      .header('referer', `/admin/parents/${parent.id}`)
      .withCsrfToken()
      .redirects(0)
    return response
  }

  test('sends a link in the parent language and stores only the token hash', async ({
    client,
    assert,
  }) => {
    freezeClock('2026-11-02T08:00')
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, {
      password: null,
      locale: 'en',
      fullName: 'John Smith',
    })

    const response = await invite(client, manager, parent)
    assert.equal(response.header('location'), `/admin/parents/${parent.id}`)
    response.assertFlashMessage('success', `Invitation envoyée à ${parent.email}.`)

    const sent = mails.sent()
    assert.lengthOf(sent, 1)
    const message = sent[0] as AccountLinkMail
    await message.buildWithContents()
    assert.equal(
      message.message.toJSON().message.subject,
      'Your British Academy × Beldi Fusion access'
    )
    assert.deepEqual(message.message.toJSON().message.to, [parent.email])
    assert.include(message.message.toJSON().message.html as string, message.url)
    assert.include(message.message.toJSON().message.text as string, 'Hello John Smith,')
    assert.match(pathOf(message), /^\/invitation\/[A-Za-z0-9_-]{43}$/)

    const rows = await UserToken.query().where('user_id', parent.id)
    assert.lengthOf(rows, 1)
    assert.match(rows[0].tokenHash, /^[0-9a-f]{64}$/)
    assert.equal(rows[0].tokenHash, UserTokenService.hash(tokenOf(message)))
    assert.notEqual(rows[0].tokenHash, tokenOf(message))
    assert.equal(rows[0].createdBy, manager.id)
    assert.equal(
      rows[0].expiresAt.setZone('Africa/Casablanca').toFormat('yyyy-MM-dd HH:mm'),
      '2026-11-05 08:00'
    )
    const raw = await db.from('user_tokens').select('*')
    assert.notInclude(JSON.stringify(raw), tokenOf(message))

    await parent.refresh()
    assert.isNotNull(parent.invitedAt)
  })

  test('the link sets the password once, logs the parent in and marks the device', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, { password: null })
    await invite(client, manager, parent)
    const path = pathOf(mails.sent()[0])

    const page = await client.get(path).withInertia()
    page.assertInertiaComponent('auth/set_password')
    assert.isTrue((page.inertiaProps as any).valid)
    assert.equal((page.inertiaProps as any).email, parent.email)
    assert.equal(page.header('cache-control'), 'no-store')

    const accepted = await client
      .post(path)
      .form({ password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(accepted.header('location'), '/')
    accepted.assertFlashMessage('success', 'Votre compte est activé. Bienvenue !')

    await parent.refresh()
    assert.isNotNull(parent.password)
    assert.isNotNull(parent.lastLoginAt)
    const cookie = accepted.cookie(KNOWN_DEVICE_COOKIE)
    assert.deepEqual(cookie?.value, [knownDeviceHash(parent)])

    // Reused link: refused
    const again = await client.get(path).withInertia()
    assert.isFalse((again.inertiaProps as any).valid)
    const reuse = await client
      .post(path)
      .form({ password: 'Another2026x', password_confirmation: 'Another2026x' })
      .withCsrfToken()
      .redirects(0)
    assert.equal(reuse.header('location'), path)
    reuse.assertFlashMessage('error', "Ce lien n'est plus valable.")

    // The new password works for a normal login
    const login = await client
      .post('/login')
      .form({ email: parent.email, password: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(login.header('location'), '/')
  })

  test('a link older than 72 hours fails', async ({ client, assert }) => {
    const clock = freezeClock('2026-11-02T08:00')
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, { password: null })
    await invite(client, manager, parent)
    const path = pathOf(mails.sent()[0])

    clock.travel({ hours: 71, minutes: 59 })
    assert.isTrue(await linkValid(client, path))

    clock.travel({ minutes: 2 })
    assert.isFalse(await linkValid(client, path))

    const response = await client
      .post(path)
      .form({ password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(response.header('location'), path)
    await parent.refresh()
    assert.isNull(parent.password)
  })

  test('resending invalidates the previous link; the new one works', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, { password: null })

    await invite(client, manager, parent)
    const resend = await invite(client, manager, parent)
    resend.assertFlashMessage(
      'success',
      `Nouvelle invitation envoyée à ${parent.email}. L'ancien lien ne fonctionne plus.`
    )
    const [first, second] = mails.sent().map(pathOf)
    assert.notEqual(first, second)

    const old = await client
      .post(first)
      .form({ password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(old.header('location'), first)
    await parent.refresh()
    assert.isNull(parent.password)

    const fresh = await client
      .post(second)
      .form({ password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(fresh.header('location'), '/')
  })

  test('the set-password page enforces the strength rules', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, { password: null })
    await invite(client, manager, parent)
    const path = pathOf(mails.sent()[0])

    for (const [password, confirmation, field, message] of [
      [
        'short1',
        'short1',
        'password',
        'Le mot de passe doit contenir au moins 10 caractères, dont une lettre et un chiffre.',
      ],
      [
        'onlyletterspassword',
        'onlyletterspassword',
        'password',
        'Le mot de passe doit contenir au moins 10 caractères, dont une lettre et un chiffre.',
      ],
      [
        '1234567890123',
        '1234567890123',
        'password',
        'Le mot de passe doit contenir au moins 10 caractères, dont une lettre et un chiffre.',
      ],
      [
        NEW_PASSWORD,
        'different2026',
        'password_confirmation',
        'Les deux mots de passe ne sont pas identiques.',
      ],
    ]) {
      const response = await client
        .post(path)
        .form({ password, password_confirmation: confirmation })
        .withCsrfToken()
        .redirects(0)
      const bag = response.flashMessage('inputErrorsBag') as Record<string, string[]>
      assert.deepEqual(bag?.[field], [message], password)
    }
    // A failed validation does not burn the link
    assert.isTrue(await linkValid(client, path))
  })

  test('a deactivated parent cannot use an invitation, and cannot be invited', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, { password: null })
    await invite(client, manager, parent)
    const path = pathOf(mails.sent()[0])

    await client.post(`/admin/parents/${parent.id}/deactivate`).loginAs(manager).withCsrfToken()
    assert.isFalse(await linkValid(client, path))

    const response = await invite(client, manager, parent)
    response.assertFlashMessage('error', "Réactivez le compte avant d'envoyer une invitation.")
    assert.lengthOf(mails.sent(), 1)
  })

  test('a parent who already has a password is not re-invited', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id)
    const response = await invite(client, manager, parent)
    response.assertFlashMessage(
      'error',
      'Ce parent a déjà choisi son mot de passe. Il peut utiliser « Mot de passe oublié ».'
    )
    assert.lengthOf(mails.sent(), 0)
  })

  test('malformed or unknown tokens show the invalid-link page', async ({ client, assert }) => {
    for (const token of ['abc', 'x'.repeat(43)]) {
      const page = await client.get(`/invitation/${token}`).withInertia()
      page.assertStatus(200)
      assert.isFalse((page.inertiaProps as any).valid)
    }
    const traversal = await client.get('/invitation/..%2F..%2Fadmin')
    traversal.assertStatus(404)
  })

  test('accepting while logged in as someone else switches to the invited account', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, { password: null })
    await invite(client, manager, parent)
    const path = pathOf(mails.sent()[0])

    const response = await client
      .post(path)
      .loginAs(manager)
      .form({ password: NEW_PASSWORD, password_confirmation: NEW_PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(response.header('location'), '/')
  })
})
