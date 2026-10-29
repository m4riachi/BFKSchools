import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import User from '#models/user'
import { UserFactory } from '#database/factories/user_factory'
import { SchoolFactory } from '#database/factories/school_factory'
import { createChild, createParent, setupSchool } from '#tests/helpers/families'

const PASSWORD = 'secret-password'

test.group('Families | parents CRUD', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  let mails: ReturnType<typeof mail.fake>['mails']
  group.each.setup(() => {
    mails = mail.fake().mails
    return () => mail.restore()
  })

  test('a manager creates a parent without sending an invitation', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()

    const response = await client
      .post('/admin/parents')
      .loginAs(manager)
      .form({
        fullName: '  Salma   Idrissi ',
        email: ' Salma.Idrissi@Example.com ',
        phone: '+212 6 12-34-56-78',
        locale: 'en',
        sendInvitation: false,
      })
      .withCsrfToken()
      .redirects(0)

    const parent = await User.findByOrFail('email', 'salma.idrissi@example.com')
    assert.equal(response.header('location'), `/admin/parents/${parent.id}`)
    assert.equal(parent.fullName, 'Salma Idrissi')
    assert.equal(parent.phone, '+212612345678')
    assert.equal(parent.role, 'parent')
    assert.equal(parent.schoolId, school.id)
    assert.isNull(parent.password)
    assert.equal(parent.locale, 'en')
    mails.assertNoneSent()
  })

  test('creating with "send invitation" emails the parent', async ({ client, assert }) => {
    const { manager } = await setupSchool()

    await client
      .post('/admin/parents')
      .loginAs(manager)
      .form({
        fullName: 'John Smith',
        email: 'john@example.com',
        locale: 'en',
        sendInvitation: true,
      })
      .withCsrfToken()
      .redirects(0)

    const parent = await User.findByOrFail('email', 'john@example.com')
    assert.isNotNull(parent.invitedAt)
    mails.assertSentCount(1)
  })

  test('validation errors are returned per field in the user language', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    await createParent(school.id, { email: 'taken@example.com' })

    for (const [payload, field, expected] of [
      [
        { fullName: '', email: 'x@example.com', locale: 'fr' },
        'fullName',
        'Le champ nom complet est obligatoire.',
      ],
      [
        { fullName: 'A', email: 'not-an-email', locale: 'fr' },
        'email',
        'Saisissez une adresse e-mail valide.',
      ],
      [
        { fullName: 'A', email: '"a b"@example.com', locale: 'fr' },
        'email',
        'Saisissez une adresse e-mail valide.',
      ],
      [
        { fullName: 'A', email: 'TAKEN@example.com', locale: 'fr' },
        'email',
        'Un compte existe déjà avec cet e-mail.',
      ],
      [
        { fullName: 'A', email: 'a@example.com', locale: 'de' },
        'locale',
        "La valeur du champ langue n'est pas valide.",
      ],
      [
        { fullName: 'A', email: 'a@example.com', locale: 'fr', phone: 'call me' },
        'phone',
        'Saisissez un numéro de téléphone valide (chiffres, espaces, +).',
      ],
    ] as const) {
      const response = await client
        .post('/admin/parents')
        .loginAs(manager)
        .form(payload)
        .withCsrfToken()
        .redirects(0)
      const bag = response.flashMessage('inputErrorsBag') as Record<string, string[]>
      assert.deepEqual(bag?.[field], [expected], `${field}: ${JSON.stringify(payload)}`)
    }
    assert.lengthOf(await User.query().where('role', 'parent'), 1)
  })

  test('validation errors are in English for an English-speaking manager', async ({
    client,
    assert,
  }) => {
    const { manager } = await setupSchool()
    manager.locale = 'en'
    await manager.save()

    const response = await client
      .post('/admin/parents')
      .loginAs(manager)
      .form({ fullName: '', email: 'x@example.com', locale: 'fr' })
      .withCsrfToken()
      .redirects(0)
    const bag = response.flashMessage('inputErrorsBag') as Record<string, string[]>
    assert.deepEqual(bag.fullName, ['The full name field is required.'])
  })

  test('a manager edits a parent; an email change ends logins and revokes links', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, { email: 'old@example.com' })
    await db.table('remember_me_tokens').insert({
      tokenable_id: parent.id,
      hash: 'h1',
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: new Date(Date.now() + 86_400_000),
    })

    const response = await client
      .put(`/admin/parents/${parent.id}`)
      .loginAs(manager)
      .form({ fullName: 'New Name', email: 'new@example.com', locale: 'fr', phone: '' })
      .withCsrfToken()
      .redirects(0)

    assert.equal(response.header('location'), `/admin/parents/${parent.id}`)
    await parent.refresh()
    assert.equal(parent.fullName, 'New Name')
    assert.equal(parent.email, 'new@example.com')
    assert.isNull(parent.phone)
    assert.equal(parent.credentialsVersion, 1)
    assert.lengthOf(await db.from('remember_me_tokens').where('tokenable_id', parent.id), 0)
  })

  test('keeping the same email is allowed on edit and does not end logins', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, { email: 'same@example.com' })

    await client
      .put(`/admin/parents/${parent.id}`)
      .loginAs(manager)
      .form({ fullName: 'Same', email: 'SAME@example.com', locale: 'en' })
      .withCsrfToken()
      .redirects(0)

    await parent.refresh()
    assert.equal(parent.fullName, 'Same')
    assert.equal(parent.credentialsVersion, 0)
  })

  test('the detail page shows children and subscriptions', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id)
    const child = await createChild(parent, { firstName: 'Adam', allergies: ['milk'] })
    await db
      .table('subscriptions')
      .insert({ child_id: child.id, start_date: '2026-09-01', end_date: null })

    const response = await client.get(`/admin/parents/${parent.id}`).loginAs(manager).withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('admin/parents/show')
    const props = response.inertiaProps as any
    assert.equal(props.parent.accessStatus, 'active')
    assert.equal(props.children[0].firstName, 'Adam')
    assert.deepEqual(props.children[0].allergies, ['milk'])
    assert.equal(props.children[0].subscriptions[0].startDate, '2026-09-01')
    assert.notProperty(props.parent, 'password')
    assert.notProperty(props.parent, 'credentialsVersion')
  })

  test('staff only reach parents of their own school', async ({ client }) => {
    const { manager } = await setupSchool()
    const otherSchool = await SchoolFactory.create()
    const foreign = await createParent(otherSchool.id)

    const show = await client.get(`/admin/parents/${foreign.id}`).loginAs(manager).withInertia()
    show.assertStatus(404)

    const update = await client
      .put(`/admin/parents/${foreign.id}`)
      .loginAs(manager)
      .form({ fullName: 'Hacked', email: foreign.email, locale: 'fr' })
      .withCsrfToken()
      .redirects(0)
    update.assertStatus(404)
    await foreign.refresh()
    if (foreign.fullName === 'Hacked') throw new Error('foreign parent was updated')
  })

  test('staff without a school cannot use the families area', async ({ client }) => {
    const admin = await UserFactory.apply('admin').create()
    const response = await client.get('/admin/parents').loginAs(admin).withInertia()
    response.assertStatus(403)
  })

  test('a staff account id behind /admin/parents/:id is a 404', async ({ client }) => {
    const { manager } = await setupSchool()
    const response = await client.get(`/admin/parents/${manager.id}`).loginAs(manager)
    response.assertStatus(404)
  })
})

test.group('Families | parents list', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('lists parents of the school with search, filters and pagination', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const other = await SchoolFactory.create()
    await createParent(other.id, { fullName: 'Other School Parent' })

    const active = await createParent(school.id, {
      fullName: 'Amina Active',
      email: 'amina@example.com',
      phone: '+212600000001',
    })
    active.lastLoginAt = active.createdAt
    await active.save()
    await createParent(school.id, { fullName: 'Bilal NeverLogged', email: 'bilal@example.com' })
    const invited = await createParent(school.id, {
      fullName: 'Chaima Invited',
      email: 'chaima@example.com',
      password: null,
    })
    await createParent(school.id, {
      fullName: 'Driss NotInvited',
      email: 'driss@example.com',
      password: null,
    })
    await createParent(school.id, { fullName: 'Ehsan Inactive', isActive: false })

    // An open invitation for Chaima
    const { default: UserTokenService } = await import('#services/user_token_service')
    const { default: app } = await import('@adonisjs/core/services/app')
    const tokens = await app.container.make(UserTokenService)
    await db.transaction((trx) => tokens.issue(invited, 'invitation', { trx }))

    const names = async (qs: string) => {
      const response = await client.get(`/admin/parents${qs}`).loginAs(manager).withInertia()
      response.assertStatus(200)
      return (response.inertiaProps as any).parents.map((p: any) => p.fullName)
    }

    assert.deepEqual(await names(''), [
      'Amina Active',
      'Bilal NeverLogged',
      'Chaima Invited',
      'Driss NotInvited',
      'Ehsan Inactive',
    ])
    assert.deepEqual(await names('?q=amina'), ['Amina Active'])
    assert.deepEqual(await names('?q=BILAL@EXAMPLE'), ['Bilal NeverLogged'])
    assert.deepEqual(await names('?q=600000001'), ['Amina Active'])
    assert.deepEqual(await names('?q=%25'), [])
    assert.deepEqual(await names('?status=active'), ['Amina Active', 'Bilal NeverLogged'])
    assert.deepEqual(await names('?status=invited'), ['Chaima Invited'])
    assert.deepEqual(await names('?status=not_invited'), ['Driss NotInvited'])
    assert.deepEqual(await names('?status=never_logged_in'), [
      'Bilal NeverLogged',
      'Chaima Invited',
      'Driss NotInvited',
    ])
    assert.deepEqual(await names('?status=inactive'), ['Ehsan Inactive'])
    // Unknown filter values fall back to "all"
    assert.lengthOf(await names('?status=bogus&page=-3'), 5)

    const response = await client.get('/admin/parents').loginAs(manager).withInertia()
    const rows = (response.inertiaProps as any).parents
    const statusOf = (name: string) => rows.find((p: any) => p.fullName === name).accessStatus
    assert.equal(statusOf('Chaima Invited'), 'invited')
    assert.equal(statusOf('Driss NotInvited'), 'not_invited')
    assert.equal(statusOf('Ehsan Inactive'), 'inactive')
    assert.isString(rows.find((p: any) => p.fullName === 'Chaima Invited').invitationExpiresAt)
  })

  test('paginates by 20', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    for (let i = 0; i < 23; i++) await createParent(school.id)

    const page2 = await client.get('/admin/parents?page=2').loginAs(manager).withInertia()
    const props = page2.inertiaProps as any
    assert.lengthOf(props.parents, 3)
    assert.deepEqual(props.meta, { total: 23, perPage: 20, currentPage: 2, lastPage: 2 })
  })
})

test.group('Families | activate / deactivate', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear(['memory']))

  test('deactivating ends sessions and remember-me tokens; the parent cannot log in', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id)

    // A remember-me login exists
    const login = await client
      .post('/login')
      .form({ email: parent.email, password: PASSWORD, remember: 'on' })
      .withCsrfToken()
      .redirects(0)
    assert.equal(login.header('location'), '/')
    assert.lengthOf(await db.from('remember_me_tokens').where('tokenable_id', parent.id), 1)

    // A live session bound to the current credentials version
    const before = await client.get('/').loginAs(parent).withSession({ auth_cv: 0 }).redirects(0)
    before.assertStatus(200)

    const response = await client
      .post(`/admin/parents/${parent.id}/deactivate`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.equal(response.header('location'), `/admin/parents/${parent.id}`)

    await parent.refresh()
    assert.isFalse(parent.isActive)
    assert.equal(parent.credentialsVersion, 1)
    assert.lengthOf(await db.from('remember_me_tokens').where('tokenable_id', parent.id), 0)

    const after = await client.get('/').loginAs(parent).withSession({ auth_cv: 0 }).redirects(0)
    assert.equal(after.header('location'), '/login')

    const relogin = await client
      .post('/login')
      .form({ email: parent.email, password: PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(relogin.header('location'), '/login')
    relogin.assertFlashMessage('error', 'Votre compte est désactivé. Contactez BFK.')
  })

  test('reactivating lets the parent log in again', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, { isActive: false })

    await client
      .post(`/admin/parents/${parent.id}/activate`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)

    const login = await client
      .post('/login')
      .form({ email: parent.email, password: PASSWORD })
      .withCsrfToken()
      .redirects(0)
    assert.equal(login.header('location'), '/')
  })
})
