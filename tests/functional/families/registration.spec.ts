/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import hash from '@adonisjs/core/services/hash'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import mail from '@adonisjs/mail/services/main'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import RegistrationTaskQueue from '#services/registration_task_queue'
import AccountLinkMail from '#mails/account_link_mail'
import { CSV_COLUMNS } from '#services/family_import_service'
import { REGISTRATION_MAX_PENDING } from '#services/parent_registration_service'
import { registrationKeys, registrationSchoolLimiter } from '#start/limiter'
import User from '#models/user'
import Child from '#models/child'
import School from '#models/school'
import StaffRole from '#models/staff_role'
import { UserFactory } from '#database/factories/user_factory'
import { SchoolFactory } from '#database/factories/school_factory'
import SchoolSettingsService from '#services/school_settings_service'
import { createParent } from '#tests/helpers/families'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { orderSchool } from '#tests/helpers/orders'

const PASSWORD = 'Inscription2026'
const BOARD_SLUG = 'bfk-registration-board'

async function setup(settings: Record<string, unknown> = {}) {
  const school = await SchoolFactory.merge({
    settings: {
      allergens_enabled: true,
      labels_enabled: true,
      grade_enabled: true,
      class_enabled: true,
      ...settings,
    },
  }).create()
  const admin = await UserFactory.apply('admin').merge({ schoolId: school.id }).create()
  const manager = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
  return { school, admin, manager }
}

async function tokenOf(schoolId: number) {
  const school = await School.findOrFail(schoolId)
  return new SchoolSettingsService().get(school).registration_token
}

async function enableRegistration(client: any, admin: User) {
  const response = await client
    .post('/admin/settings/registration')
    .loginAs(admin)
    .withCsrfToken()
    .redirects(0)
  response.assertStatus(302)
  const token = await tokenOf(admin.schoolId!)
  if (!token) throw new Error('no registration token')
  return token
}

function signUp(overrides: Record<string, unknown> = {}) {
  return {
    fullName: '  Nadia   Bennani ',
    email: ' Nadia.Bennani@Example.com ',
    phone: '06 12 34 56 78',
    locale: 'fr',
    password: PASSWORD,
    password_confirmation: PASSWORD,
    website: '',
    children: [
      {
        firstName: 'Yasmine',
        lastName: 'Bennani',
        grade: 'Year 3',
        className: '3B',
        allergies: ['peanuts', 'milk'],
        dietaryNotes: 'Pas de porc',
      },
      { firstName: 'Omar', lastName: 'Bennani' },
    ],
    ...overrides,
  }
}

let mails: ReturnType<typeof mail.fake>['mails']

/** Posts the form, then waits for the sign-up work deferred after the response. */
async function submit(client: any, token: string, body: Record<string, unknown>) {
  const response = await client
    .post(`/inscription/${token}`)
    .withCsrfToken()
    .json(body)
    .redirects(0)
  await (await app.container.make(RegistrationTaskQueue)).drain()
  return response
}

/** The confirmation emails sent to `email`. */
function confirmationMails(email: string) {
  return mails
    .sent()
    .filter(
      (sent): sent is AccountLinkMail =>
        sent instanceof AccountLinkMail &&
        sent.kind === 'email_confirmation' &&
        sent.user.email === email
    )
}

/** Path of the last confirmation link emailed to `email`. */
function confirmationPath(email: string) {
  const sent = confirmationMails(email).at(-1)
  if (!sent) throw new Error(`no confirmation mail for ${email}`)
  return new URL(sent.url).pathname
}

async function confirmEmail(client: any, path: string) {
  return client.post(path).withCsrfToken().redirects(0)
}

/** A pending sign-up created through the public form (email confirmed unless told not to). */
async function pendingParent(
  client: any,
  token: string,
  overrides: Record<string, unknown> = {},
  options: { confirm?: boolean } = {}
) {
  const response = await submit(client, token, signUp(overrides))
  response.assertStatus(302)
  const email = String((overrides.email as string | undefined) ?? 'nadia.bennani@example.com')
    .trim()
    .toLowerCase()
  if (options.confirm !== false) {
    ;(await confirmEmail(client, confirmationPath(email))).assertStatus(302)
  }
  return User.query().whereRaw('lower(email) = ?', [email]).firstOrFail()
}

test.group('Families | parent self-registration (D59)', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await limiter.clear(['memory'])
    mails = mail.fake().mails
    return async () => {
      mail.restore()
      restoreClock()
      await truncate()
    }
  })

  test('a parent signs up: pending account, inactive children without a kiosk code, a confirmation email', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await setup()
    const token = await enableRegistration(client, admin)
    assert.match(token, /^[A-Za-z0-9_-]{32}$/)

    const page = await client.get(`/inscription/${token}`).withInertia()
    page.assertStatus(200)
    page.assertInertiaComponent('auth/register')
    assert.equal(page.header('cache-control'), 'no-store')
    const props = page.body().props
    assert.deepEqual(props.fields, { grade: true, className: true, allergens: true })
    assert.lengthOf(props.allergens, 14)
    assert.isFalse(props.sent)

    const response = await submit(client, token, signUp())
    response.assertStatus(302)
    assert.equal(response.header('location'), `/inscription/${token}`)

    const parent = await User.findByOrFail('email', 'nadia.bennani@example.com')
    assert.equal(parent.fullName, 'Nadia Bennani')
    assert.equal(parent.role, 'parent')
    assert.equal(parent.schoolId, school.id)
    assert.equal(parent.phone, '0612345678')
    assert.isFalse(parent.isActive)
    assert.equal(parent.registrationStatus, 'pending')
    assert.isNotNull(parent.registeredAt)
    assert.isTrue(await hash.verify(parent.password!, PASSWORD))

    const children = await Child.query().where('parent_id', parent.id).orderBy('first_name')
    assert.deepEqual(
      children.map((c) => [c.firstName, c.isActive, c.schoolId]),
      [
        ['Omar', false, school.id],
        ['Yasmine', false, school.id],
      ]
    )
    // H2: no kiosk code is spent on a sign-up waiting for the school.
    for (const child of children) {
      assert.isNull(child.pin)
      assert.isTrue(child.registrationPending)
    }
    assert.isNull(parent.emailConfirmedAt)
    const yasmine = children[1]
    assert.equal(yasmine.grade, 'Year 3')
    assert.equal(yasmine.className, '3B')
    assert.sameMembers(yasmine.allergies, ['peanuts', 'milk'])
    assert.equal(yasmine.dietaryNotes, 'Pas de porc')

    // The redirect shows the "awaiting validation" state (flash).
    response.assertFlashMessage('registrationSent', true)

    // H1: one confirmation email in the parent's language, single-use link.
    const sent = confirmationMails(parent.email)
    assert.lengthOf(sent, 1)
    assert.deepEqual(sent[0].message.toJSON().message.to, [parent.email])
    const path = confirmationPath(parent.email)
    assert.match(path, /^\/inscription\/confirmer\/[A-Za-z0-9_-]{43}$/)
    const confirmPage = await client.get(path).withInertia()
    confirmPage.assertInertiaComponent('auth/confirm_email')
    assert.equal(confirmPage.body().props.state, 'valid')
    // M2: what was submitted, phone masked, first names only.
    assert.deepEqual(confirmPage.body().props.summary, {
      fullName: 'Nadia Bennani',
      phone: '+212 6•• ••• •78',
      children: ['Yasmine', 'Omar'],
    })
    await parent.refresh()
    assert.isNull(parent.emailConfirmedAt) // the GET consumes nothing

    const confirmed = await confirmEmail(client, path)
    confirmed.assertFlashMessage('emailConfirmation', 'confirmed')
    await parent.refresh()
    assert.isNotNull(parent.emailConfirmedAt)
    // Used once: the link no longer works.
    const again = await client.get(path).withInertia()
    assert.equal(again.body().props.state, 'invalid')
    const replay = await confirmEmail(client, path)
    replay.assertFlashMissing('emailConfirmation')
  })

  test('the confirmation link expires; staff resend a new one (the old one stops)', async ({
    client,
    assert,
  }) => {
    const { admin, manager } = await setup()
    const token = await enableRegistration(client, admin)
    freezeClock('2026-11-16T10:00')
    const parent = await pendingParent(client, token, {}, { confirm: false })
    const first = confirmationPath(parent.email)

    freezeClock('2026-11-19T10:01') // 72 h + 1 min later
    assert.equal((await client.get(first).withInertia()).body().props.state, 'invalid')
    await confirmEmail(client, first)
    await parent.refresh()
    assert.isNull(parent.emailConfirmedAt)

    freezeClock('2026-11-19T11:00')
    await client
      .post(`/admin/parents/${parent.id}/registration/confirmation`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.lengthOf(confirmationMails(parent.email), 2)
    const second = confirmationPath(parent.email)
    assert.notEqual(second, first)
    await confirmEmail(client, second)
    await parent.refresh()
    assert.isNotNull(parent.emailConfirmedAt)
  })

  test('unknown token, turned-off sign-ups and a replaced token answer 404', async ({
    client,
    assert,
  }) => {
    const { admin } = await setup()
    const unknown = 'A'.repeat(32)
    ;(await client.get(`/inscription/${unknown}`)).assertStatus(404)

    const token = await enableRegistration(client, admin)
    ;(await client.get(`/inscription/${token}`)).assertStatus(200)
    ;(await submit(client, unknown, signUp())).assertStatus(404)

    // A new link: the old QR stops working.
    await client
      .post('/admin/settings/registration/token')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    const renewed = await tokenOf(admin.schoolId!)
    assert.notEqual(renewed, token)
    ;(await client.get(`/inscription/${token}`)).assertStatus(404)
    ;(await submit(client, token, signUp())).assertStatus(404)
    ;(await client.get(`/inscription/${renewed}`)).assertStatus(200)

    // Turned off: 404, then on again with the same link.
    await client.delete('/admin/settings/registration').loginAs(admin).withCsrfToken().redirects(0)
    ;(await client.get(`/inscription/${renewed}`)).assertStatus(404)
    ;(await submit(client, renewed!, signUp())).assertStatus(404)
    assert.isNull(await User.findBy('email', 'nadia.bennani@example.com'))
    await enableRegistration(client, admin)
    assert.equal(await tokenOf(admin.schoolId!), renewed)
  })

  test('a known email gets the same answer and nothing is created', async ({ client, assert }) => {
    const { school, admin } = await setup()
    const token = await enableRegistration(client, admin)
    const existing = await createParent(school.id, { email: 'nadia.bennani@example.com' })

    const response = await submit(client, token, signUp({ email: 'NADIA.bennani@example.com' }))
    response.assertStatus(302)
    assert.equal(response.header('location'), `/inscription/${token}`)
    response.assertFlashMessage('registrationSent', true)
    const fresh = await submit(client, token, signUp({ email: 'someone.else@example.com' }))
    assert.equal(fresh.header('location'), response.header('location'))

    // Nothing is sent to the existing account; the new address gets its link.
    assert.lengthOf(confirmationMails(existing.email), 0)
    assert.lengthOf(mails.sent(), 1)
    await existing.refresh()
    assert.isNull(existing.registrationStatus)
    assert.isTrue(existing.isActive)
    assert.isTrue(await hash.verify(existing.password!, 'secret-password'))
    assert.lengthOf(await Child.query().where('parent_id', existing.id), 0)
    const parents = await User.query().where('role', 'parent')
    assert.lengthOf(parents, 2)
  })

  test('the honeypot and invalid input create nothing', async ({ client, assert }) => {
    const { admin } = await setup()
    const token = await enableRegistration(client, admin)

    const robot = await submit(client, token, signUp({ website: 'https://spam.example' }))
    robot.assertStatus(302)
    assert.isNull(await User.findBy('email', 'nadia.bennani@example.com'))

    const invalid = await client
      .post(`/inscription/${token}`)
      .withCsrfToken()
      .header('accept', 'application/json')
      .json(
        signUp({
          phone: '12',
          password: 'short',
          password_confirmation: 'short',
          children: [],
        })
      )
    invalid.assertStatus(422)
    const fields = (invalid.body().errors as { field: string }[]).map((error) => error.field)
    assert.includeMembers(fields, ['phone', 'password', 'children'])

    const tooMany = await client
      .post(`/inscription/${token}`)
      .withCsrfToken()
      .header('accept', 'application/json')
      .json(
        signUp({
          children: Array.from({ length: 7 }, (_, i) => ({ firstName: `C${i}`, lastName: 'X' })),
        })
      )
    tooMany.assertStatus(422)
    assert.lengthOf(await User.query().where('role', 'parent'), 0)
  })

  test('submissions are rate-limited per address', async ({ client, assert }) => {
    const { admin } = await setup()
    const token = await enableRegistration(client, admin)
    for (let i = 0; i < 20; i++) {
      const ok = await submit(client, token, signUp({ website: 'robot' }))
      ok.assertStatus(302)
    }
    const blocked = await submit(client, token, signUp())
    assert.equal(blocked.header('location'), `/inscription/${token}`)
    blocked.assertFlashMissing('registrationSent')
    assert.isNull(await User.findBy('email', 'nadia.bennani@example.com'))
  })

  test('modules turned off: the form hides the fields and the server ignores them', async ({
    client,
    assert,
  }) => {
    const { admin } = await setup({
      allergens_enabled: false,
      grade_enabled: false,
      class_enabled: false,
    })
    const token = await enableRegistration(client, admin)
    const page = await client.get(`/inscription/${token}`).withInertia()
    assert.deepEqual(page.body().props.fields, {
      grade: false,
      className: false,
      allergens: false,
    })
    assert.deepEqual(page.body().props.allergens, [])

    const parent = await pendingParent(client, token)
    const yasmine = await Child.query()
      .where('parent_id', parent.id)
      .where('first_name', 'Yasmine')
      .firstOrFail()
    assert.isNull(yasmine.grade)
    assert.isNull(yasmine.className)
    assert.deepEqual(yasmine.allergies, [])
    assert.equal(yasmine.dietaryNotes, 'Pas de porc')
  })

  test('a pending parent cannot log in and sees why; a refused one is deactivated', async ({
    client,
    assert,
  }) => {
    const { admin, manager } = await setup()
    const token = await enableRegistration(client, admin)
    const parent = await pendingParent(client, token)

    const login = await client
      .post('/login')
      .withCsrfToken()
      .form({ email: parent.email, password: PASSWORD })
      .redirects(0)
    assert.equal(login.header('location'), '/login')
    login.assertFlashMessage(
      'error',
      'Votre compte est en attente de validation par l’école. Vous pourrez vous connecter dès qu’il sera activé.'
    )
    // A wrong password does not reveal the pending account.
    const wrong = await client
      .post('/login')
      .withCsrfToken()
      .form({ email: parent.email, password: 'Wrong-password-1' })
      .redirects(0)
    wrong.assertFlashMessage('error', 'E-mail ou mot de passe incorrect.')

    // Even a session for that user is ended on the next request.
    const portal = await client.get('/').loginAs(parent).redirects(0)
    assert.equal(portal.header('location'), '/login')

    await client
      .post(`/admin/parents/${parent.id}/registration/refuse`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    await parent.refresh()
    assert.equal(parent.registrationStatus, 'refused')
    assert.isFalse(parent.isActive)
    assert.equal(parent.registrationReviewedBy, manager.id)
    // H2: a refused sign-up keeps no kiosk code.
    const refusedChildren = await Child.query().where('parent_id', parent.id)
    assert.isTrue(refusedChildren.every((c) => c.pin === null && !c.isActive))
    const refused = await client
      .post('/login')
      .withCsrfToken()
      .form({ email: parent.email, password: PASSWORD })
      .redirects(0)
    refused.assertFlashMessage('error', 'Votre compte est désactivé. Contactez BFK.')
  })

  test('the "À activer" list, activation and the WhatsApp message with the codes', async ({
    client,
    assert,
  }) => {
    const { admin, manager } = await setup()
    const token = await enableRegistration(client, admin)
    const parent = await pendingParent(client, token, {}, { confirm: false })
    await createParent(admin.schoolId!) // a normal parent is not listed

    // H1: Activer is refused until the parent confirmed the email (both routes).
    for (const url of [
      `/admin/parents/${parent.id}/registration/approve`,
      `/admin/parents/${parent.id}/activate`,
    ]) {
      const early = await client.post(url).loginAs(manager).withCsrfToken().redirects(0)
      early.assertStatus(302)
      early.assertFlashMessage('error', 'Le parent doit d’abord confirmer son e-mail.')
    }
    await parent.refresh()
    assert.equal(parent.registrationStatus, 'pending')
    assert.isFalse(parent.isActive)
    const unconfirmed = await client
      .get('/admin/parents?status=pending')
      .loginAs(manager)
      .withInertia()
    assert.isFalse(unconfirmed.body().props.registrations[0].emailConfirmed)
    await confirmEmail(client, confirmationPath(parent.email))

    // M2: children staff deactivated or the import added are not switched on.
    const staffChild = await Child.create({
      parentId: parent.id,
      schoolId: parent.schoolId!,
      firstName: 'Ines',
      lastName: 'Bennani',
      isActive: false,
    })
    await staffChild.refresh()
    assert.match(staffChild.pin!, /^\d{4}$/) // not a sign-up child: code given as usual

    const list = await client.get('/admin/parents?status=pending').loginAs(manager).withInertia()
    list.assertStatus(200)
    const props = list.body().props
    assert.equal(props.pendingCount, 1)
    assert.equal(props.access.pendingRegistrations, 1)
    assert.lengthOf(props.registrations, 1)
    const row = props.registrations[0]
    assert.equal(row.id, parent.id)
    assert.equal(row.phone, '0612345678')
    assert.isTrue(row.emailConfirmed)
    assert.isNotNull(row.registeredAt)
    assert.notProperty(row, 'password')
    const yasmine = row.children.find((c: { firstName: string }) => c.firstName === 'Yasmine')
    assert.sameMembers(yasmine.allergies, ['peanuts', 'milk'])
    assert.equal(yasmine.dietaryNotes, 'Pas de porc')

    const all = await client.get('/admin/parents').loginAs(manager).withInertia()
    assert.equal(all.body().props.pendingCount, 1)
    const listed = all.body().props.parents.find((p: { id: number }) => p.id === parent.id)
    assert.equal(listed.accessStatus, 'pending')

    const approve = await client
      .post(`/admin/parents/${parent.id}/registration/approve`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.equal(approve.header('location'), `/admin/parents/${parent.id}`)
    await parent.refresh()
    assert.isTrue(parent.isActive)
    assert.equal(parent.registrationStatus, 'approved')
    assert.equal(parent.registrationReviewedBy, manager.id)
    const children = await Child.query()
      .where('parent_id', parent.id)
      .where('first_name', '!=', 'Ines')
    assert.lengthOf(children, 2)
    // H2: each sign-up child gets its kiosk code at the approval.
    for (const child of children) {
      assert.isTrue(child.isActive)
      assert.isFalse(child.registrationPending)
      assert.match(child.pin!, /^\d{4}$/)
    }
    await staffChild.refresh()
    assert.isFalse(staffChild.isActive)

    // Approving twice is refused (already reviewed).
    await client
      .post(`/admin/parents/${parent.id}/registration/refuse`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    await parent.refresh()
    assert.equal(parent.registrationStatus, 'approved')

    const show = await client.get(`/admin/parents/${parent.id}`).loginAs(manager).withInertia()
    const link = show.body().props.activationWhatsapp as string
    assert.match(link, /^https:\/\/wa\.me\/212612345678\?text=/)
    const message = decodeURIComponent(link.split('?text=')[1])
    for (const child of children) {
      assert.include(message, `${child.firstName} ${child.lastName} : ${child.pin}`)
    }
    assert.notInclude(message, 'Ines')
    assert.include(message, '/login')
    assert.include(message, parent.email)
    assert.equal(show.body().props.registration.status, 'approved')

    // The parent now logs in with the password chosen at sign-up.
    const login = await client
      .post('/login')
      .withCsrfToken()
      .form({ email: parent.email, password: PASSWORD })
      .redirects(0)
    assert.equal(login.header('location'), '/')

    const after = await client.get('/admin/parents').loginAs(manager).withInertia()
    assert.equal(after.body().props.pendingCount, 0)
  })

  test('only staff with the families area review sign-ups', async ({ client, assert }) => {
    const { school, admin } = await setup()
    const token = await enableRegistration(client, admin)
    const parent = await pendingParent(client, token)

    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const cashierRole = await StaffRole.create({
      schoolId: school.id,
      name: 'Caisse',
      permissions: ['pos', 'orders'],
    })
    const cashier = await UserFactory.apply('manager')
      .merge({ schoolId: school.id, staffRoleId: cashierRole.id })
      .create()
    const otherSchool = await SchoolFactory.create()
    const otherManager = await UserFactory.apply('manager')
      .merge({ schoolId: otherSchool.id })
      .create()
    const otherParent = await createParent(school.id)

    for (const user of [otherParent, kitchen, cashier, otherManager]) {
      for (const action of ['approve', 'refuse']) {
        const response = await client
          .post(`/admin/parents/${parent.id}/registration/${action}`)
          .loginAs(user)
          .withCsrfToken()
          .redirects(0)
        assert.include([302, 403, 404], response.status())
      }
      const page = await client.get('/admin/parents?status=pending').loginAs(user).withInertia()
      if (user === otherManager) {
        // Their own school's list: someone else's sign-up never shows.
        page.assertStatus(200)
        assert.lengthOf(page.body().props.registrations, 0)
        assert.equal(page.body().props.pendingCount, 0)
      } else {
        assert.include([403, 302], page.status())
      }
    }
    await parent.refresh()
    assert.equal(parent.registrationStatus, 'pending')
    assert.isFalse(parent.isActive)

    // A custom role with the families area can.
    const familiesRole = await StaffRole.create({
      schoolId: school.id,
      name: 'Accueil',
      permissions: ['families'],
    })
    const desk = await UserFactory.apply('manager')
      .merge({ schoolId: school.id, staffRoleId: familiesRole.id })
      .create()
    await client
      .post(`/admin/parents/${parent.id}/registration/approve`)
      .loginAs(desk)
      .withCsrfToken()
      .redirects(0)
    await parent.refresh()
    assert.equal(parent.registrationStatus, 'approved')
  })

  test('the CSV import never merges into a pending or refused sign-up', async ({
    client,
    assert,
  }) => {
    const { admin, manager } = await setup()
    const token = await enableRegistration(client, admin)
    const parent = await pendingParent(client, token)
    const content = Buffer.from(
      `${CSV_COLUMNS.join(',')}\r\nNadia Bennani,nadia.bennani@example.com,,fr,Sami,Bennani,,,,,\r\n`,
      'utf8'
    )
    const upload = await client
      .post('/admin/imports/families')
      .loginAs(manager)
      .file('file', content, { filename: 'families.csv', contentType: 'text/csv' })
      .withCsrfToken()
      .redirects(0)
    const id = /([0-9a-f-]{36})$/.exec(String(upload.header('location')))![1]
    const preview = await client.get(`/admin/imports/families/${id}`).loginAs(manager).withInertia()
    const plan = preview.body().props.plan
    assert.isFalse(plan.valid)
    assert.match(plan.rows[0].errors[0], /inscription QR en attente ou refusée/)
    await client
      .post(`/admin/imports/families/${id}/confirm`)
      .loginAs(manager)
      .form({ sendInvitations: false })
      .withCsrfToken()
      .redirects(0)
    assert.lengthOf(await Child.query().where('parent_id', parent.id), 2)
  })

  test('the waiting list and the school are capped (same answer, nothing created)', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await setup()
    const token = await enableRegistration(client, admin)
    await db.table('users').multiInsert(
      Array.from({ length: REGISTRATION_MAX_PENDING }, (_, i) => ({
        full_name: `Waiting ${i}`,
        email: `waiting${i}@example.com`,
        role: 'parent',
        school_id: school.id,
        locale: 'fr',
        is_active: false,
        notification_prefs: '{}',
        credentials_version: 0,
        registration_status: 'pending',
        email_confirmed_at: new Date(),
        created_at: new Date(),
        updated_at: new Date(),
      }))
    )
    const full = await submit(client, token, signUp())
    full.assertFlashMessage('registrationSent', true)
    assert.isNull(await User.findBy('email', 'nadia.bennani@example.com'))
    assert.lengthOf(mails.sent(), 0)

    // M3: unconfirmed sign-ups whose link expired no longer take a place.
    await db.from('users').where('registration_status', 'pending').update({
      email_confirmed_at: null,
    })
    await submit(client, token, signUp())
    const created = await User.findByOrFail('email', 'nadia.bennani@example.com')
    assert.equal(created.registrationStatus, 'pending')
    // …and they show as "lien expiré" in the list, the fresh one does not.
    const list = await client.get('/admin/parents?status=pending').loginAs(admin).withInertia()
    const rows = list.body().props.registrations as { id: number; confirmationExpired: boolean }[]
    assert.isFalse(rows.find((row) => row.id === created.id)!.confirmationExpired)
    assert.isTrue(
      rows.filter((row) => row.id !== created.id).every((row) => row.confirmationExpired)
    )

    // Per school, whatever the address (M1).
    // The two submissions above already counted: spend the rest of the day's budget.
    const remaining = 200 - 2
    for (let i = 0; i < remaining; i++) {
      await registrationSchoolLimiter().consume(registrationKeys.school(school.id))
    }
    const limited = await submit(client, token, signUp({ email: 'limited@example.com' }))
    limited.assertFlashMissing('registrationSent')
    assert.isNull(await User.findBy('email', 'limited@example.com'))
  })

  test('"This wasn\'t me": the email owner refuses the sign-up with the same link', async ({
    client,
    assert,
  }) => {
    const { admin } = await setup()
    const token = await enableRegistration(client, admin)
    const parent = await pendingParent(client, token, {}, { confirm: false })
    const path = confirmationPath(parent.email)

    const declined = await client
      .post(path)
      .withCsrfToken()
      .form({ decision: 'decline' })
      .redirects(0)
    declined.assertFlashMessage('emailConfirmation', 'declined')
    await parent.refresh()
    assert.equal(parent.registrationStatus, 'refused')
    assert.isFalse(parent.isActive)
    assert.isNull(parent.emailConfirmedAt)
    assert.isNull(parent.registrationReviewedBy)
    const children = await Child.query().where('parent_id', parent.id)
    assert.isTrue(children.every((c) => c.pin === null && !c.isActive))

    // The link is used up: confirming afterwards does nothing.
    await confirmEmail(client, path)
    await parent.refresh()
    assert.isNull(parent.emailConfirmedAt)
    assert.equal((await client.get(path).withInertia()).body().props.state, 'invalid')
  })

  test('a refused sign-up can get a new link; confirming keeps it refused, staff then approve', async ({
    client,
    assert,
  }) => {
    const { admin, manager } = await setup()
    const token = await enableRegistration(client, admin)
    const parent = await pendingParent(client, token, {}, { confirm: false })
    await client
      .post(`/admin/parents/${parent.id}/registration/refuse`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    await parent.refresh()
    assert.equal(parent.registrationStatus, 'refused')

    // L3: staff resend the link to a refused, unconfirmed sign-up.
    await client
      .post(`/admin/parents/${parent.id}/registration/confirmation`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.lengthOf(confirmationMails(parent.email), 2)
    const confirmed = await confirmEmail(client, confirmationPath(parent.email))
    confirmed.assertFlashMessage('emailConfirmation', 'confirmed')
    await parent.refresh()
    assert.isNotNull(parent.emailConfirmedAt)
    assert.equal(parent.registrationStatus, 'refused')
    assert.isFalse(parent.isActive)

    await client
      .post(`/admin/parents/${parent.id}/registration/approve`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    await parent.refresh()
    assert.equal(parent.registrationStatus, 'approved')
    const children = await Child.query().where('parent_id', parent.id)
    assert.isTrue(children.every((c) => c.isActive && /^\d{4}$/.test(c.pin ?? '')))
  })

  test('settings: admin only; the poster is a PDF', async ({ client, assert }) => {
    const { admin, manager } = await setup()

    const off = await client.get('/admin/settings').loginAs(admin).withInertia()
    assert.deepEqual(off.body().props.registration, { enabled: false, url: null, qr: null })
    const noPoster = await client
      .get('/admin/settings/registration/poster')
      .loginAs(admin)
      .redirects(0)
    assert.equal(noPoster.header('location'), '/admin/settings')

    for (const request of [
      client.post('/admin/settings/registration').withCsrfToken(),
      client.post('/admin/settings/registration/token').withCsrfToken(),
      client.get('/admin/settings/registration/poster'),
    ]) {
      const response = await request.loginAs(manager).redirects(0)
      assert.include([302, 403], response.status())
    }
    assert.isNull(await tokenOf(admin.schoolId!))

    const token = await enableRegistration(client, admin)
    const on = await client.get('/admin/settings').loginAs(admin).withInertia()
    assert.isTrue(on.body().props.registration.enabled)
    assert.match(on.body().props.registration.url, new RegExp(`/inscription/${token}$`))
    assert.match(on.body().props.registration.qr, /^data:image\/svg\+xml;base64,/)

    const pdf = await client.get('/admin/settings/registration/poster').loginAs(admin)
    pdf.assertStatus(200)
    assert.include(String(pdf.header('content-type')), 'application/pdf')
    assert.match(String(pdf.header('content-disposition')), /inscription-parents\.pdf/)
    assert.equal((pdf.body() as Buffer).subarray(0, 5).toString('latin1'), '%PDF-')
  })

  test('the board shows the sign-up QR only while sign-ups are on', async ({ client, assert }) => {
    const { admin } = await setup()
    await client
      .post('/admin/settings/board')
      .loginAs(admin)
      .withCsrfToken()
      .json({ board_slug: BOARD_SLUG })
      .redirects(0)

    const before = await client.get(`/board/${BOARD_SLUG}`).withInertia()
    before.assertStatus(200)
    assert.isNull(before.body().props.registration)

    const token = await enableRegistration(client, admin)
    const after = await client.get(`/board/${BOARD_SLUG}`).withInertia()
    const registration = after.body().props.registration
    assert.deepEqual(Object.keys(registration), ['qr'])
    assert.match(registration.qr, /^data:image\/svg\+xml;base64,/)
    const svg = Buffer.from(registration.qr.split(',')[1], 'base64').toString('utf8')
    assert.include(svg, '<svg')
    assert.isString(token)

    await client.delete('/admin/settings/registration').loginAs(admin).withCsrfToken().redirects(0)
    const offAgain = await client.get(`/board/${BOARD_SLUG}`).withInertia()
    assert.isNull(offAgain.body().props.registration)
  })

  test('the kiosk refuses the children of a pending sign-up', async ({ client, assert }) => {
    const ctx = await orderSchool()
    await client
      .post('/admin/settings/board')
      .loginAs(ctx.admin)
      .withCsrfToken()
      .json({ board_slug: BOARD_SLUG })
      .redirects(0)
    const token = await enableRegistration(client, ctx.admin)
    const parent = await pendingParent(client, token)
    const child = await Child.query().where('parent_id', parent.id).firstOrFail()
    // Nothing to type on the kiosk: no code until the approval…
    assert.isNull(child.pin)

    // …and even with a code (a child staff added), an inactive family is refused.
    const added = await Child.create({
      parentId: parent.id,
      schoolId: parent.schoolId!,
      firstName: 'Ines',
      lastName: 'Bennani',
      isActive: true,
    })
    await added.refresh()
    freezeClock('2026-11-24T08:00')
    const start = await client.post(`/board/${BOARD_SLUG}/kiosk/session`).json({ pin: added.pin })
    start.assertStatus(422)
  })
})

test.group('Families | sign-up confirmation email (D59, FR + EN)', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await limiter.clear(['memory'])
    mails = mail.fake().mails
    return async () => {
      mail.restore()
      await truncate()
    }
  })

  test('the confirmation email follows the language chosen on the form', async ({
    client,
    assert,
  }) => {
    const { admin } = await setup()
    const token = await enableRegistration(client, admin)
    const expected = {
      fr: 'Confirmez votre adresse e-mail',
      en: 'Confirm your email address',
    } as const
    for (const locale of ['fr', 'en'] as const) {
      const email = `parent.${locale}@example.com`
      await submit(client, token, signUp({ email, locale }))
      const sent = confirmationMails(email)
      assert.lengthOf(sent, 1)
      await sent[0].buildWithContents()
      const json = sent[0].message.toJSON().message
      assert.equal(String(json.subject), expected[locale])
      assert.include(String(json.html), '/inscription/confirmer/')
      assert.notMatch(String(json.html), /emails\.email_confirmation/)
    }
  })
})
