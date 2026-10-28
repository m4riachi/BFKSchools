import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import testUtils from '@adonisjs/core/services/test_utils'
import Holiday from '#models/holiday'
import { UserFactory } from '#database/factories/user_factory'
import { setupHolidaySchool, generateHolidays } from '#tests/helpers/holidays'

const IMPORT_ID = '0b9d6c1e-6a1f-4e8e-9b9e-2f4f1c9c7a10'

/** Every /admin/holidays route of the router, params filled in. */
function holidayRoutes(ids: Record<string, string | number>) {
  const routes: { method: string; url: string }[] = []
  for (const list of Object.values(router.toJSON())) {
    for (const route of list) {
      if (!route.pattern.startsWith('/admin/holidays')) continue
      const url = route.pattern
        .replace('import/:id', `import/${IMPORT_ID}`)
        .replace(/:(\w+)/g, (_, name: string) => String(ids[name] ?? 1))
      for (const method of route.methods) if (method !== 'HEAD') routes.push({ method, url })
    }
  }
  return routes
}

const PAYLOAD = {
  name: 'Hacked',
  date: '2026-10-14',
  startDate: '2026-10-13',
  endDate: '2026-10-16',
  active: false,
  ranges: ['x'],
  url: 'https://calendar.example.org/a.ics',
  generateMoroccanHolidays: true,
  confirmImpact: true,
}

async function seed() {
  const ctx = await setupHolidaySchool()
  await generateHolidays(ctx.school)
  const holiday = await Holiday.findByOrFail('rule_key', 'us_veterans_day_2026')
  const groupRow = await Holiday.create({
    schoolId: ctx.school.id,
    date: '2026-12-21',
    name: 'Winter break',
    source: 'manual',
    ruleKey: null,
    groupId: '7f0c5a0e-3f4b-4c55-9d1d-5b0f6b0a1c11',
    isActive: true,
  })
  return { ...ctx, holiday, groupRow }
}

async function snapshot(schoolId: number) {
  const rows = await Holiday.query().where('school_id', schoolId).orderBy('id')
  return rows.map((row) => [
    row.id,
    row.date,
    row.name,
    row.isActive,
    row.deletedAt?.toISO() ?? null,
  ])
}

test.group('Holidays | authorization', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  for (const role of ['kitchen', 'parent'] as const) {
    test('a {$self} cannot use any /admin/holidays route')
      .with([role])
      .run(async ({ client, assert }, userRole) => {
        const { school, holiday, groupRow } = await seed()
        const user = await UserFactory.apply(userRole).merge({ schoolId: school.id }).create()
        const before = await snapshot(school.id)

        const routes = holidayRoutes({
          id: holiday.id,
          groupId: groupRow.groupId!,
        })
        assert.isAtLeast(routes.length, 15)
        for (const { method, url } of routes) {
          const request = client
            .request(url, method as any)
            .loginAs(user)
            .redirects(0)
          if (method !== 'GET') request.withCsrfToken().json(PAYLOAD)
          const response = await request
          if (method === 'GET') assert.equal(response.status(), 403, `${method} ${url}`)
          else assert.include([302, 403], response.status(), `${method} ${url}`)
        }
        assert.deepEqual(await snapshot(school.id), before)
        await school.refresh()
        assert.notProperty(school.settings, 'generate_moroccan_holidays')
      })
  }

  test("staff of another school get a 404 on this school's holidays", async ({
    client,
    assert,
  }) => {
    const { school, holiday, groupRow } = await seed()
    const other = await setupHolidaySchool()
    const before = await snapshot(school.id)

    const attempts = [
      client.put(`/admin/holidays/${holiday.id}`).json({ name: 'Hacked' }),
      client.post(`/admin/holidays/${holiday.id}/toggle`).json({ active: false }),
      client.delete(`/admin/holidays/${holiday.id}`),
      client.put(`/admin/holidays/groups/${groupRow.groupId}`).json({ name: 'Hacked' }),
      client.post(`/admin/holidays/groups/${groupRow.groupId}/toggle`).json({ active: false }),
      client.delete(`/admin/holidays/groups/${groupRow.groupId}`),
    ]
    for (const attempt of attempts) {
      const response = await attempt.loginAs(other.manager).withCsrfToken().redirects(0)
      response.assertStatus(404)
    }
    assert.deepEqual(await snapshot(school.id), before)

    // Their own page never lists this school's rows.
    const page = await client
      .get('/admin/holidays?view=list&period=all')
      .loginAs(other.manager)
      .withInertia()
    assert.equal((page.inertiaProps as any).list.meta.total, 0)
  })

  test('staff without a school cannot manage holidays', async ({ client }) => {
    const manager = await UserFactory.apply('manager').merge({ schoolId: null }).create()
    const response = await client.get('/admin/holidays').loginAs(manager)
    response.assertStatus(403)
  })

  test('non-numeric ids and non-uuid groups are 404', async ({ client }) => {
    const { manager } = await setupHolidaySchool()
    for (const url of ['/admin/holidays/abc', '/admin/holidays/groups/not-a-uuid']) {
      const response = await client.delete(url).loginAs(manager).withCsrfToken().redirects(0)
      response.assertStatus(404)
    }
  })

  test('guests are sent to the login page', async ({ client }) => {
    const response = await client.get('/admin/holidays').redirects(0)
    response.assertStatus(302)
    response.assertHeader('location', '/login')
  })
})
