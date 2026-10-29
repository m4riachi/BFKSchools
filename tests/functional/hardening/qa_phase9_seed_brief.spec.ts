/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import { rm } from 'node:fs/promises'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import SchoolSeeder from '#database/seeders/01_school_seeder'
import DemoUsersSeeder from '#database/seeders/02_demo_users_seeder'
import DemoFamilySeeder from '#database/seeders/03_demo_family_seeder'
import HolidaySeeder from '#database/seeders/04_holiday_seeder'
import DemoCatalogSeeder from '#database/seeders/05_demo_catalog_seeder'
import DemoFamiliesSeeder from '#database/seeders/06_demo_families_seeder'
import DemoMenusOrdersSeeder from '#database/seeders/07_demo_menus_orders_seeder'
import ImportStore, { MAX_PENDING_IMPORTS_PER_USER } from '#services/import_store'
import { freezeClock, restoreClock } from '#tests/helpers/clock'

/** Phase 9 QA — the seeds match PROJECT_BRIEF §7. */
test.group('Phase 9 QA | demo seed vs brief §7', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    drive.fake('fs')
    return async () => {
      drive.restore('fs')
      await truncate()
    }
  })

  test('1 school, 13 trays + active supplements with photos, 15 parents with 1-3 children, 2 weeks of menus, a demo account per role', async ({
    assert,
  }) => {
    for (const Seeder of [
      SchoolSeeder,
      DemoUsersSeeder,
      DemoFamilySeeder,
      HolidaySeeder,
      DemoCatalogSeeder,
      DemoFamiliesSeeder,
      DemoMenusOrdersSeeder,
    ]) {
      await new Seeder(db.connection()).run()
    }
    assert.equal(Number((await db.from('schools').count('* as t').first()).t), 1)

    // ~13 subscription trays + a few active supplements (the rest of the BFK menu is inactive, D32).
    const offered = await db
      .from('meals')
      .where('is_active', true)
      .select('type')
      .count('* as t')
      .groupBy('type')
    const byType = Object.fromEntries(offered.map((row) => [row.type, Number(row.t)]))
    assert.isAtLeast(byType.subscription, 10)
    assert.isAtLeast(byType.supplement, 4)
    const withoutPhoto = await db
      .from('meals')
      .whereNotExists((q) => q.from('meal_photos').whereRaw('meal_photos.meal_id = meals.id'))
    assert.lengthOf(withoutPhoto, 0)

    const perParent = await db.rawQuery(
      `SELECT u.id, count(c.id)::int AS n FROM users u LEFT JOIN children c ON c.parent_id = u.id
       WHERE u.role = 'parent' GROUP BY u.id`
    )
    assert.lengthOf(perParent.rows, 15)
    for (const row of perParent.rows) assert.isTrue(row.n >= 1 && row.n <= 3, `parent ${row.id}`)

    const roles = (await db.from('users').distinct('role')).map((r) => r.role)
    assert.includeMembers(roles, ['admin', 'manager', 'kitchen', 'parent'])

    // Two consecutive weeks (current published + next scheduled) exist, Monday-based.
    const weeks = await db.from('weekly_menus').whereIn('status', ['published', 'scheduled'])
    assert.lengthOf(weeks, 2)
    const [a, b] = weeks.map((w) => String(w.week_start).slice(0, 10)).sort()
    assert.equal(
      (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
      7
    )
    // Holidays cover the school year of the schools row.
    const school = await db.from('schools').first()
    const outside = await db
      .from('holidays')
      .where((q) =>
        q.where('date', '<', school.school_year_start).orWhere('date', '>', school.school_year_end)
      )
    assert.lengthOf(outside, 0)
  }).timeout(120_000)
})

test.group('Phase 9 QA | ImportStore cap', (group) => {
  group.each.teardown(async () => {
    restoreClock()
    await rm(app.tmpPath('imports'), { recursive: true, force: true })
  })

  // Two uploads in the same millisecond (same createdAt) must not make the
  // cap drop the *newest* previews: ties are broken by the store's
  // in-process sequence number.
  test('same-instant uploads: the cap keeps the most recent previews', async ({ assert }) => {
    freezeClock('2026-11-05T10:00')
    const store = await app.container.make(ImportStore)
    const ids: string[] = []
    for (let i = 0; i < MAX_PENDING_IMPORTS_PER_USER + 3; i++) {
      ids.push(await store.put(515151, 1, `file ${i}`))
    }
    const kept: string[] = []
    for (const id of ids) if ((await store.get(id, 515151, 1)) !== null) kept.push(id)
    assert.lengthOf(kept, MAX_PENDING_IMPORTS_PER_USER)
    assert.deepEqual(kept, ids.slice(-MAX_PENDING_IMPORTS_PER_USER))
    for (const id of ids) await store.delete(id)
  })
})
