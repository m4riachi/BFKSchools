import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import Child from '#models/child'
import Subscription from '#models/subscription'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import { createChild, createParent, setupSchool } from '#tests/helpers/families'

test.group('Families | children', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('a manager adds a child with allergies to a parent', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id)

    const response = await client
      .post(`/admin/parents/${parent.id}/children`)
      .loginAs(manager)
      .json({
        firstName: 'Adam',
        lastName: 'Idrissi',
        grade: 'G3',
        className: '3B',
        allergies: ['gluten', 'milk'],
        dietaryNotes: 'No pork',
        isActive: true,
      })
      .withCsrfToken()
      .redirects(0)

    const child = await Child.findByOrFail('first_name', 'Adam')
    assert.equal(
      response.header('location'),
      `/admin/parents/${parent.id}/children/${child.id}/edit`
    )
    assert.equal(child.parentId, parent.id)
    assert.equal(child.schoolId, school.id)
    assert.deepEqual(child.allergies, ['gluten', 'milk'])
    assert.equal(child.dietaryNotes, 'No pork')
  })

  test('allergies outside the EU-14 list are rejected (validator)', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id)

    const response = await client
      .post(`/admin/parents/${parent.id}/children`)
      .loginAs(manager)
      .json({ firstName: 'Adam', lastName: 'Idrissi', allergies: ['gluten', 'kiwi'] })
      .withCsrfToken()
      .redirects(0)

    response.assertStatus(302)
    const bag = response.flashMessage('inputErrorsBag') as Record<string, string[]>
    assert.properties(bag, ['allergies.1'])
    assert.lengthOf(await Child.all(), 0)
  })

  test('allergies outside the EU-14 list are rejected (database check)', async ({ assert }) => {
    const { school } = await setupSchool()
    const parent = await createParent(school.id)
    await assert.rejects(
      () =>
        db.table('children').insert({
          parent_id: parent.id,
          school_id: school.id,
          first_name: 'A',
          last_name: 'B',
          allergies: ['kiwi'],
        }),
      /children_allergies_check/
    )
  })

  test('required fields and duplicates are reported per field', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id)
    await createChild(parent, { firstName: 'Lina', lastName: 'Idrissi' })

    const missing = await client
      .post(`/admin/parents/${parent.id}/children`)
      .loginAs(manager)
      .json({ firstName: '', lastName: 'X' })
      .withCsrfToken()
      .redirects(0)
    assert.deepEqual((missing.flashMessage('inputErrorsBag') as any).firstName, [
      'Le champ prénom est obligatoire.',
    ])

    const duplicate = await client
      .post(`/admin/parents/${parent.id}/children`)
      .loginAs(manager)
      .header('referer', `/admin/parents/${parent.id}/children/create`)
      .json({ firstName: 'LINA', lastName: 'idrissi' })
      .withCsrfToken()
      .redirects(0)
    assert.deepEqual((duplicate.flashMessage('inputErrorsBag') as any).firstName, [
      'Ce parent a déjà un enfant avec ce prénom et ce nom.',
    ])
  })

  test('a manager edits, deactivates and deletes a child', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id)
    const child = await createChild(parent, { allergies: ['eggs'] })

    await client
      .put(`/admin/parents/${parent.id}/children/${child.id}`)
      .loginAs(manager)
      .json({ firstName: 'Renamed', lastName: 'Child', allergies: [], isActive: false })
      .withCsrfToken()
      .redirects(0)
    await child.refresh()
    assert.equal(child.firstName, 'Renamed')
    assert.deepEqual(child.allergies, [])
    assert.isFalse(child.isActive)

    const page = await client
      .get(`/admin/parents/${parent.id}/children/${child.id}/edit`)
      .loginAs(manager)
      .withInertia()
    page.assertInertiaComponent('admin/children/form')

    const deleted = await client
      .delete(`/admin/parents/${parent.id}/children/${child.id}`)
      .loginAs(manager)
      .withCsrfToken()
      .redirects(0)
    assert.equal(deleted.header('location'), `/admin/parents/${parent.id}`)
    assert.isNull(await Child.find(child.id))
  })

  test('a child reached through another parent id is a 404', async ({ client }) => {
    const { school, manager } = await setupSchool()
    const parentA = await createParent(school.id)
    const parentB = await createParent(school.id)
    const child = await createChild(parentA)

    const response = await client
      .get(`/admin/parents/${parentB.id}/children/${child.id}/edit`)
      .loginAs(manager)
    response.assertStatus(404)
  })

  test('a manager of another school cannot edit the child', async ({ client, assert }) => {
    const { school } = await setupSchool()
    const parent = await createParent(school.id)
    const child = await createChild(parent)
    const otherSchool = await SchoolFactory.create()
    const otherManager = await UserFactory.apply('manager')
      .merge({ schoolId: otherSchool.id })
      .create()

    const page = await client
      .get(`/admin/parents/${parent.id}/children/${child.id}/edit`)
      .loginAs(otherManager)
      .withInertia()
    page.assertStatus(404)

    await client
      .put(`/admin/parents/${parent.id}/children/${child.id}`)
      .loginAs(otherManager)
      .json({ firstName: 'Hacked', lastName: 'X' })
      .withCsrfToken()
      .redirects(0)
    await child.refresh()
    assert.notEqual(child.firstName, 'Hacked')
  })

  test('Child.visibleTo: parents see their own children, staff their school', async ({
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const parentA = await createParent(school.id)
    const parentB = await createParent(school.id)
    const childA = await createChild(parentA)
    await createChild(parentB)
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const noSchoolAdmin = await UserFactory.apply('admin').create()

    const ids = async (user: any) =>
      Child.query()
        .withScopes((s) => s.visibleTo(user))
        .then((rows) => rows.map((c) => c.id))

    assert.deepEqual(await ids(parentA), [childA.id])
    assert.lengthOf(await ids(manager), 2)
    assert.lengthOf(await ids(kitchen), 0)
    assert.lengthOf(await ids(noSchoolAdmin), 0)
  })
})

test.group('Families | subscription periods', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  async function setup() {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id)
    const child = await createChild(parent)
    const url = `/admin/parents/${parent.id}/children/${child.id}/subscriptions`
    return { manager, parent, child, url }
  }

  test('creates, updates and deletes a period', async ({ client, assert }) => {
    const { manager, child, url } = await setup()

    await client
      .post(url)
      .loginAs(manager)
      .json({ startDate: '2026-09-01', endDate: '2026-12-18', status: 'active', notes: 'T1' })
      .withCsrfToken()
      .redirects(0)
    const period = await Subscription.findByOrFail('child_id', child.id)
    assert.equal(period.startDate, '2026-09-01')
    assert.equal(period.endDate, '2026-12-18')
    assert.isTrue(period.covers('2026-10-01'))
    assert.isFalse(period.covers('2027-01-04'))

    await client
      .put(`${url}/${period.id}`)
      .loginAs(manager)
      .json({ startDate: '2026-09-01', endDate: '', status: 'paused' })
      .withCsrfToken()
      .redirects(0)
    await period.refresh()
    assert.isNull(period.endDate)
    assert.equal(period.status, 'paused')
    assert.isFalse(period.covers('2026-10-01'))

    await client.delete(`${url}/${period.id}`).loginAs(manager).withCsrfToken().redirects(0)
    assert.isNull(await Subscription.find(period.id))
  })

  test('overlapping periods are rejected', async ({ client, assert }) => {
    const { manager, child, url } = await setup()
    await Subscription.create({
      childId: child.id,
      startDate: '2026-09-01',
      endDate: '2026-12-18',
      status: 'active',
    })
    await Subscription.create({
      childId: child.id,
      startDate: '2027-01-04',
      endDate: null,
      status: 'active',
    })

    for (const [startDate, endDate] of [
      ['2026-12-18', '2026-12-31'], // touches the last day
      ['2026-08-01', '2026-09-01'], // touches the first day
      ['2026-10-01', '2026-10-10'], // inside
      ['2026-12-20', ''], // open-ended, overlaps the open-ended period
      ['2030-01-01', '2030-02-01'], // inside the open-ended period
    ]) {
      const response = await client
        .post(url)
        .loginAs(manager)
        .json({ startDate, endDate, status: 'active' })
        .withCsrfToken()
        .redirects(0)
      const bag = response.flashMessage('inputErrorsBag') as Record<string, string[]>
      assert.match(bag?.startDate?.[0] ?? '', /chevauche/, `${startDate} → ${endDate}`)
    }
    assert.lengthOf(await Subscription.query().where('child_id', child.id), 2)

    // The gap between the two periods is free
    await client
      .post(url)
      .loginAs(manager)
      .json({ startDate: '2026-12-19', endDate: '2027-01-03', status: 'paused' })
      .withCsrfToken()
      .redirects(0)
    assert.lengthOf(await Subscription.query().where('child_id', child.id), 3)
  })

  test('editing a period does not clash with itself', async ({ client, assert }) => {
    const { manager, child, url } = await setup()
    const period = await Subscription.create({
      childId: child.id,
      startDate: '2026-09-01',
      endDate: '2026-12-18',
      status: 'active',
    })

    await client
      .put(`${url}/${period.id}`)
      .loginAs(manager)
      .json({ startDate: '2026-09-02', endDate: '2026-12-20', status: 'active' })
      .withCsrfToken()
      .redirects(0)
    await period.refresh()
    assert.equal(period.startDate, '2026-09-02')
  })

  test('the database refuses overlaps too (exclusion constraint)', async ({ assert }) => {
    const { child } = await setup()
    await Subscription.create({
      childId: child.id,
      startDate: '2026-09-01',
      endDate: null,
      status: 'active',
    })
    await assert.rejects(
      () =>
        Subscription.create({
          childId: child.id,
          startDate: '2027-01-01',
          endDate: '2027-02-01',
          status: 'ended',
        }),
      /subscriptions_no_overlap/
    )
  })

  test('invalid dates and end before start are rejected', async ({ client, assert }) => {
    const { manager, url } = await setup()

    const badDate = await client
      .post(url)
      .loginAs(manager)
      .json({ startDate: '2026-02-30', status: 'active' })
      .withCsrfToken()
      .redirects(0)
    assert.deepEqual((badDate.flashMessage('inputErrorsBag') as any).startDate, [
      'Saisissez une date au format AAAA-MM-JJ.',
    ])

    const reversed = await client
      .post(url)
      .loginAs(manager)
      .json({ startDate: '2026-09-10', endDate: '2026-09-01', status: 'active' })
      .withCsrfToken()
      .redirects(0)
    assert.deepEqual((reversed.flashMessage('inputErrorsBag') as any).endDate, [
      'La fin doit être le même jour ou après le début.',
    ])

    const badStatus = await client
      .post(url)
      .loginAs(manager)
      .json({ startDate: '2026-09-10', status: 'cancelled' })
      .withCsrfToken()
      .redirects(0)
    assert.properties(badStatus.flashMessage('inputErrorsBag') as any, ['status'])
  })
})
