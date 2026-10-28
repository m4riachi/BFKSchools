import { test } from '@japa/runner'
import { Bouncer } from '@adonisjs/bouncer'
import testUtils from '@adonisjs/core/services/test_utils'
import type User from '#models/user'
import Child from '#models/child'
import Subscription from '#models/subscription'
import ChildPolicy from '#policies/child_policy'
import ParentPolicy from '#policies/parent_policy'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import { SubscriptionFactory } from '#database/factories/subscription_factory'
import { createChild, createParent, setupSchool } from '#tests/helpers/families'

/** QA: cross-family / cross-school isolation, policies never read school_id null as "all". */
test.group('Families | isolation', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  async function world() {
    const { school, manager } = await setupSchool()
    const parentA = await createParent(school.id)
    const parentB = await createParent(school.id)
    const childA = await createChild(parentA)
    const childB = await createChild(parentB)
    const sub = await SubscriptionFactory.merge({ childId: childA.id }).create()
    const otherSchool = await SchoolFactory.create()
    const otherManager = await UserFactory.apply('manager')
      .merge({ schoolId: otherSchool.id })
      .create()
    const otherParent = await createParent(otherSchool.id)
    const otherChild = await createChild(otherParent)
    return {
      school,
      manager,
      parentA,
      parentB,
      childA,
      childB,
      sub,
      otherManager,
      otherParent,
      otherChild,
    }
  }

  const can = (user: User, policy: any, action: string, resource?: any) =>
    new Bouncer(() => user).with(policy).allows(action, ...(resource ? [resource] : []))

  test('ChildPolicy: parents only own children, null-school staff nothing, other school nothing', async ({
    assert,
  }) => {
    const w = await world()
    const nullAdmin = await UserFactory.apply('admin').create()
    const nullManager = await UserFactory.apply('manager').create()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: w.school.id }).create()

    assert.isTrue(await can(w.parentA, ChildPolicy, 'view', w.childA))
    assert.isFalse(await can(w.parentA, ChildPolicy, 'view', w.childB))
    assert.isFalse(await can(w.parentA, ChildPolicy, 'view', w.otherChild))
    assert.isFalse(await can(w.parentA, ChildPolicy, 'manage', w.childA))
    assert.isTrue(await can(w.manager, ChildPolicy, 'manage', w.childA))
    assert.isFalse(await can(w.manager, ChildPolicy, 'manage', w.otherChild))
    assert.isFalse(await can(w.otherManager, ChildPolicy, 'view', w.childA))
    for (const user of [nullAdmin, nullManager, kitchen]) {
      assert.isFalse(await can(user, ChildPolicy, 'view', w.childA))
      assert.isFalse(await can(user, ChildPolicy, 'manage', w.childA))
    }
    w.manager.isActive = false
    assert.isFalse(await can(w.manager, ChildPolicy, 'view', w.childA))
  })

  test('ParentPolicy: school bound, null school is never "all schools", parents/kitchen refused', async ({
    assert,
  }) => {
    const w = await world()
    const nullAdmin = await UserFactory.apply('admin').create()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: w.school.id }).create()

    assert.isTrue(await can(w.manager, ParentPolicy, 'manage', w.parentA))
    assert.isFalse(await can(w.manager, ParentPolicy, 'manage', w.otherParent))
    assert.isFalse(await can(w.manager, ParentPolicy, 'manage', w.manager))
    for (const user of [nullAdmin, kitchen, w.parentA]) {
      assert.isFalse(await can(user, ParentPolicy, 'viewAny'))
      assert.isFalse(await can(user, ParentPolicy, 'create'))
      assert.isFalse(await can(user, ParentPolicy, 'import'))
      assert.isFalse(await can(user, ParentPolicy, 'manage', w.parentA))
    }
    // a "parent" row without a school is never manageable
    const orphan = await createParent(w.school.id)
    orphan.schoolId = null
    assert.isFalse(await can(w.manager, ParentPolicy, 'manage', orphan))
    assert.isFalse(await can(nullAdmin, ParentPolicy, 'manage', orphan))
  })

  test('Child.visibleTo never lets a parent or a foreign school see other children', async ({
    assert,
  }) => {
    const w = await world()
    const ids = (user: User) =>
      Child.query()
        .withScopes((s) => s.visibleTo(user))
        .then((rows) => rows.map((c) => c.id).sort())
    assert.deepEqual(await ids(w.parentB), [w.childB.id])
    assert.deepEqual(await ids(w.otherParent), [w.otherChild.id])
    assert.deepEqual(await ids(w.otherManager), [w.otherChild.id])
    w.parentA.isActive = false
    assert.lengthOf(await ids(w.parentA), 0)
  })

  test('a manager of another school gets nothing on every parent/child/subscription route', async ({
    client,
    assert,
  }) => {
    const w = await world()
    const p = `/admin/parents/${w.parentA.id}`
    const c = `${p}/children/${w.childA.id}`
    const s = `${c}/subscriptions/${w.sub.id}`
    const body = {
      fullName: 'Hacked',
      firstName: 'Hacked',
      lastName: 'Hacked',
      email: 'hacked@example.com',
      locale: 'fr',
      startDate: '2030-01-01',
      endDate: '2030-02-01',
      status: 'active',
    }
    const attempts: [string, string][] = [
      ['get', p],
      ['get', `${p}/edit`],
      ['put', p],
      ['post', `${p}/deactivate`],
      ['post', `${p}/activate`],
      ['post', `${p}/invitation`],
      ['get', `${p}/children/create`],
      ['post', `${p}/children`],
      ['get', `${c}/edit`],
      ['put', c],
      ['delete', c],
      ['post', `${c}/subscriptions`],
      ['put', s],
      ['delete', s],
    ]
    for (const [method, url] of attempts) {
      const req = (client as any)[method](url).loginAs(w.otherManager).redirects(0)
      if (method !== 'get') req.json(body).withCsrfToken()
      const res = await req
      assert.include([302, 403, 404], res.status(), `${method} ${url}`)
      if (res.status() === 302) {
        assert.notMatch(res.header('location') ?? '', /\/admin\/parents\/\d+/, `${method} ${url}`)
      }
    }
    await w.parentA.refresh()
    await w.childA.refresh()
    assert.notEqual(w.parentA.fullName, 'Hacked')
    assert.isTrue(w.parentA.isActive)
    assert.isNull(w.parentA.invitedAt)
    assert.notEqual(w.childA.firstName, 'Hacked')
    assert.isNotNull(await Child.find(w.childA.id))
    assert.isNotNull(await Subscription.find(w.sub.id))
    assert.lengthOf(await Subscription.query().where('child_id', w.childA.id), 1)
    assert.lengthOf(await Child.query().where('parent_id', w.parentA.id), 1)
  })

  test('a child or subscription under the wrong parent / child id is a 404, in the same school', async ({
    client,
  }) => {
    const w = await world()
    const wrongChild = await client
      .put(`/admin/parents/${w.parentB.id}/children/${w.childA.id}`)
      .loginAs(w.manager)
      .json({ firstName: 'Hacked', lastName: 'X' })
      .withCsrfToken()
      .redirects(0)
    wrongChild.assertStatus(404)
    const wrongDelete = await client
      .delete(`/admin/parents/${w.parentB.id}/children/${w.childA.id}`)
      .loginAs(w.manager)
      .withCsrfToken()
      .redirects(0)
    wrongDelete.assertStatus(404)
    const wrongSub = await client
      .delete(`/admin/parents/${w.parentA.id}/children/${w.childB.id}/subscriptions/${w.sub.id}`)
      .loginAs(w.manager)
      .withCsrfToken()
      .redirects(0)
    wrongSub.assertStatus(404)
    const wrongSubPut = await client
      .put(`/admin/parents/${w.parentA.id}/children/${w.childB.id}/subscriptions/${w.sub.id}`)
      .loginAs(w.manager)
      .json({ startDate: '2030-01-01', endDate: '', status: 'paused' })
      .withCsrfToken()
      .redirects(0)
    wrongSubPut.assertStatus(404)
    const stillThere = await Subscription.find(w.sub.id)
    if (!stillThere || stillThere.status === 'paused') throw new Error('subscription changed')
  })

  test('creating a child under another school parent is refused and creates nothing', async ({
    client,
    assert,
  }) => {
    const w = await world()
    const res = await client
      .post(`/admin/parents/${w.otherParent.id}/children`)
      .loginAs(w.manager)
      .json({ firstName: 'Evil', lastName: 'Kid', allergies: [], isActive: true })
      .withCsrfToken()
      .redirects(0)
    assert.include([302, 403, 404], res.status())
    assert.lengthOf(await Child.query().where('first_name', 'Evil'), 0)
  })

  test('staff without a school are refused on child, subscription and import routes', async ({
    client,
    assert,
  }) => {
    const w = await world()
    const admin = await UserFactory.apply('admin').create()
    const p = `/admin/parents/${w.parentA.id}`
    for (const [method, url] of [
      ['get', `${p}/children/create`],
      ['get', `${p}/children/${w.childA.id}/edit`],
      ['get', '/admin/imports/families'],
      ['get', '/admin/imports/families/template'],
    ] as const) {
      const res = await client[method](url).loginAs(admin).redirects(0)
      assert.equal(res.status(), 403, url)
    }
    const del = await client
      .delete(`${p}/children/${w.childA.id}`)
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    assert.notEqual(del.status(), 200)
    assert.isNotNull(await Child.find(w.childA.id))
  })

  test('a parent cannot read or change another family through any /admin URL', async ({
    client,
    assert,
  }) => {
    const w = await world()
    const own = await client.get(`/admin/parents/${w.parentA.id}`).loginAs(w.parentA).redirects(0)
    assert.equal(own.status(), 403)
    const other = await client
      .get(`/admin/parents/${w.parentB.id}/children/${w.childB.id}/edit`)
      .loginAs(w.parentA)
      .redirects(0)
    assert.equal(other.status(), 403)
    const del = await client
      .delete(`/admin/parents/${w.parentB.id}/children/${w.childB.id}`)
      .loginAs(w.parentA)
      .withCsrfToken()
      .redirects(0)
    assert.notEqual(del.status(), 200)
    assert.isNotNull(await Child.find(w.childB.id))
  })
})
