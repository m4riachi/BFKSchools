/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import AccountLinkMail from '#mails/account_link_mail'
import StaffRole from '#models/staff_role'
import User from '#models/user'
import { areaOfRoute, PERMISSIONS } from '#enums/permissions'

async function adminOfNewSchool() {
  const school = await SchoolFactory.create()
  const admin = await UserFactory.apply('admin').merge({ schoolId: school.id }).create()
  return { school, admin }
}

async function userWithRole(schoolId: number, permissions: string[], role: 'manager' | 'kitchen') {
  const staffRole = await StaffRole.create({ schoolId, name: `Rôle ${Math.random()}`, permissions })
  const user = await UserFactory.apply(role).merge({ schoolId, staffRoleId: staffRole.id }).create()
  return { user, staffRole }
}

test.group('Permissions of custom roles', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('every back-office route belongs to an area, or is one of the admin-only pages', ({
    assert,
  }) => {
    const adminOnly = new Set(['settings', 'users', 'roles'])
    for (const list of Object.values(router.toJSON())) {
      for (const route of list) {
        if (!/^\/(admin|kitchen)(\/|$)/.test(route.pattern)) continue
        const section = route.pattern.split('/')[2]
        if (route.pattern.startsWith('/admin') && adminOnly.has(section)) {
          assert.isNull(areaOfRoute(route.pattern), route.pattern)
        } else {
          assert.include(PERMISSIONS, areaOfRoute(route.pattern)!, route.pattern)
        }
      }
    }
  })

  test('a role opens its areas and nothing else, reads and writes alike', async ({
    client,
    assert,
  }) => {
    const { school } = await adminOfNewSchool()
    const { user } = await userWithRole(school.id, ['families'], 'manager')

    const allowed = await client.get('/admin/parents').loginAs(user).withInertia()
    allowed.assertStatus(200)
    assert.deepEqual(allowed.body().props.access.permissions, ['families'])

    for (const path of [
      '/admin/meals',
      '/admin/menus',
      '/admin/holidays',
      '/admin/orders',
      '/admin/pos',
      '/admin/statements',
      '/admin/reports',
      '/kitchen',
      '/admin/settings',
      '/admin/users',
      '/admin/roles',
    ]) {
      const response = await client
        .get(path)
        .loginAs(user)
        .header('Accept', 'application/json')
        .redirects(0)
      response.assertStatus(403)
    }
    const write = await client
      .post('/admin/meals')
      .loginAs(user)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({})
    write.assertStatus(403)
  })

  test('without the dashboard, /admin leads to the first allowed area', async ({
    client,
    assert,
  }) => {
    const { school } = await adminOfNewSchool()
    const { user } = await userWithRole(school.id, ['meals', 'reports'], 'manager')
    const response = await client.get('/admin').loginAs(user).redirects(0)
    assert.equal(response.status(), 302)
    assert.equal(response.header('location'), '/admin/meals')
  })

  test('money needs an area about money, whatever the rest of the role', async ({
    client,
    assert,
  }) => {
    const { school } = await adminOfNewSchool()
    const monthToDate = async (permissions: string[]) => {
      const { user } = await userWithRole(school.id, permissions, 'manager')
      const page = await client.get('/admin').loginAs(user).withInertia()
      page.assertStatus(200)
      return page.body().props.dashboard.monthToDate
    }
    assert.isNull(await monthToDate(['dashboard', 'holidays']))
    assert.isNotNull(await monthToDate(['dashboard', 'statements']))
    assert.isNotNull(await monthToDate(['dashboard', 'reports']))

    const manager = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
    const page = await client.get('/admin').loginAs(manager).withInertia()
    assert.isNotNull(page.body().props.dashboard.monthToDate)
  })

  test('built-in roles keep their access', async ({ client }) => {
    const { school, admin } = await adminOfNewSchool()
    const manager = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    for (const path of ['/admin', '/admin/meals', '/kitchen']) {
      ;(await client.get(path).loginAs(manager).withInertia()).assertStatus(200)
    }
    ;(await client.get('/admin/users').loginAs(admin).withInertia()).assertStatus(200)
    ;(await client.get('/kitchen').loginAs(kitchen).withInertia()).assertStatus(200)
    for (const [user, path] of [
      [manager, '/admin/users'],
      [manager, '/admin/settings'],
      [kitchen, '/admin'],
    ] as const) {
      const response = await client.get(path).loginAs(user).header('Accept', 'application/json')
      response.assertStatus(403)
    }
  })
})

test.group('Roles page', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('an admin creates a role; a kitchen-only role is at kitchen level', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await adminOfNewSchool()
    const created = await client
      .post('/admin/roles')
      .loginAs(admin)
      .withCsrfToken()
      .json({ name: 'Caissier', permissions: ['pos', 'orders'] })
      .redirects(0)
    created.assertStatus(302)
    const role = await StaffRole.query().where('school_id', school.id).firstOrFail()
    assert.deepEqual(role.permissions, ['orders', 'pos'])

    const member = await UserFactory.apply('manager')
      .merge({ schoolId: school.id, staffRoleId: role.id })
      .create()
    await client
      .put(`/admin/roles/${role.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ name: 'Caissier', permissions: ['kitchen'] })
      .redirects(0)
    await member.refresh()
    assert.equal(member.role, 'kitchen')
  })

  test('settings, users and unknown permissions are refused; so is an empty role', async ({
    client,
    assert,
  }) => {
    const { admin } = await adminOfNewSchool()
    for (const permissions of [['settings'], ['users'], ['nope'], [], ['pos', 'pos']]) {
      const response = await client
        .post('/admin/roles')
        .loginAs(admin)
        .withCsrfToken()
        .json({ name: 'Essai', permissions })
        .redirects(0)
      const fields = Object.keys(response.flashMessage('inputErrorsBag') ?? {})
      assert.isTrue(
        fields.some((field) => field.startsWith('permissions')),
        JSON.stringify(permissions)
      )
    }
    assert.lengthOf(await StaffRole.all(), 0)
  })

  test('a name is unique in a school; a used role cannot be deleted', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await adminOfNewSchool()
    const { staffRole } = await userWithRole(school.id, ['pos'], 'manager')
    await client
      .post('/admin/roles')
      .loginAs(admin)
      .withCsrfToken()
      .json({ name: staffRole.name.toUpperCase(), permissions: ['pos'] })
      .redirects(0)
    assert.lengthOf(await StaffRole.all(), 1)

    await client.delete(`/admin/roles/${staffRole.id}`).loginAs(admin).withCsrfToken().redirects(0)
    assert.isNotNull(await StaffRole.find(staffRole.id))

    const unused = await StaffRole.create({
      schoolId: school.id,
      name: 'Libre',
      permissions: ['pos'],
    })
    await client.delete(`/admin/roles/${unused.id}`).loginAs(admin).withCsrfToken().redirects(0)
    assert.isNull(await StaffRole.find(unused.id))
  })

  test('another school’s role cannot be changed or given', async ({ client, assert }) => {
    const { admin } = await adminOfNewSchool()
    const other = await adminOfNewSchool()
    const foreign = await StaffRole.create({
      schoolId: other.school.id,
      name: 'Ailleurs',
      permissions: ['pos'],
    })
    const changed = await client
      .put(`/admin/roles/${foreign.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .header('Accept', 'application/json')
      .json({ name: 'Volé', permissions: ['kitchen'] })
    changed.assertStatus(404)

    const given = await client
      .post('/admin/users')
      .loginAs(admin)
      .withCsrfToken()
      .json({
        fullName: 'Nouvelle',
        email: 'nouvelle@bfk.test',
        locale: 'fr',
        access: `role:${foreign.id}`,
      })
      .redirects(0)
    assert.equal(given.status(), 302)
    assert.isNull(await User.findByEmail('nouvelle@bfk.test'))
  })
})

test.group('Users page', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('an admin creates a user with an invitation written for staff', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await adminOfNewSchool()
    const mails = mail.fake()
    const role = await StaffRole.create({
      schoolId: school.id,
      name: 'Caisse',
      permissions: ['pos'],
    })
    const response = await client
      .post('/admin/users')
      .loginAs(admin)
      .withCsrfToken()
      .json({
        fullName: 'Nadia Test',
        email: 'NADIA@bfk.test',
        phone: '+212 600 000 000',
        locale: 'fr',
        access: `role:${role.id}`,
      })
      .redirects(0)
    response.assertStatus(302)

    const user = await User.findByEmail('nadia@bfk.test')
    assert.equal(user?.role, 'manager')
    assert.equal(user?.staffRoleId, role.id)
    assert.equal(user?.schoolId, school.id)
    assert.isNull(user?.password)
    mails.mails.assertSent(AccountLinkMail, (message: AccountLinkMail) => {
      const content = message.buildContent()
      assert.notInclude(content.paragraphs.join(' '), 'enfants')
      return message.kind === 'invitation'
    })
    mail.restore()
  })

  test('the list shows staff of this school, not parents or other schools', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await adminOfNewSchool()
    const manager = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
    await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
    await adminOfNewSchool()
    const page = await client.get('/admin/users').loginAs(admin).withInertia()
    assert.sameMembers(
      page.body().props.users.map((user: { id: number }) => user.id),
      [admin.id, manager.id]
    )
    assert.notInclude(JSON.stringify(page.body().props.users), 'password":"')
  })

  test('an admin cannot change their own role or deactivate themselves', async ({
    client,
    assert,
  }) => {
    const { admin } = await adminOfNewSchool()
    await client
      .put(`/admin/users/${admin.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ fullName: admin.fullName, email: admin.email, locale: 'fr', access: 'kitchen' })
      .redirects(0)
    await client
      .put(`/admin/users/${admin.id}/active`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ isActive: false })
      .redirects(0)
    await admin.refresh()
    assert.equal(admin.role, 'admin')
    assert.isTrue(admin.isActive)
  })

  test('changing a role applies at once; deactivating ends the session', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await adminOfNewSchool()
    const manager = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
    await client
      .put(`/admin/users/${manager.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ fullName: 'Gardé', email: manager.email, locale: 'fr', access: 'kitchen' })
      .redirects(0)
    await manager.refresh()
    assert.equal(manager.role, 'kitchen')
    assert.equal(manager.fullName, 'Gardé')

    const version = manager.credentialsVersion
    await client
      .put(`/admin/users/${manager.id}/active`)
      .loginAs(admin)
      .withCsrfToken()
      .json({ isActive: false })
      .redirects(0)
    await manager.refresh()
    assert.isFalse(manager.isActive)
    assert.isAbove(manager.credentialsVersion, version)
  })

  test('parents and other schools’ users cannot be reached', async ({ client, assert }) => {
    const { school, admin } = await adminOfNewSchool()
    const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
    const other = await adminOfNewSchool()
    for (const target of [parent, other.admin]) {
      const response = await client
        .put(`/admin/users/${target.id}`)
        .loginAs(admin)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json({ fullName: 'Pirate', email: target.email, locale: 'fr', access: 'admin' })
      response.assertStatus(404)
      await target.refresh()
      assert.notEqual(target.fullName, 'Pirate')
    }
  })

  test('only admins of the school, whatever the route', async ({ client, assert }) => {
    const { school } = await adminOfNewSchool()
    const manager = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
    const { user: custom } = await userWithRole(school.id, [...PERMISSIONS], 'manager')
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
    for (const user of [manager, custom, kitchen, parent]) {
      for (const [method, path] of [
        ['get', '/admin/users'],
        ['post', '/admin/users'],
        ['put', `/admin/users/${manager.id}`],
        ['put', `/admin/users/${manager.id}/active`],
        ['post', `/admin/users/${manager.id}/invite`],
        ['get', '/admin/roles'],
        ['post', '/admin/roles'],
      ] as const) {
        const response = await client[method](path)
          .loginAs(user)
          .withCsrfToken()
          .header('Accept', 'application/json')
        assert.equal(response.status(), 403, `${user.role} ${method} ${path}`)
      }
    }
    const adminWithoutSchool = await UserFactory.apply('admin').merge({ schoolId: null }).create()
    const noSchool = await client
      .get('/admin/users')
      .loginAs(adminWithoutSchool)
      .header('Accept', 'application/json')
    noSchool.assertStatus(403)
  })
})
