/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import drive from '@adonisjs/drive/services/main'
import limiter from '@adonisjs/limiter/services/main'
import SchoolSeeder, { schoolYearFor } from '#database/seeders/01_school_seeder'
import DemoUsersSeeder, { DEMO_USERS } from '#database/seeders/02_demo_users_seeder'
import DemoFamilySeeder from '#database/seeders/03_demo_family_seeder'
import HolidaySeeder from '#database/seeders/04_holiday_seeder'
import DemoCatalogSeeder from '#database/seeders/05_demo_catalog_seeder'
import DemoFamiliesSeeder from '#database/seeders/06_demo_families_seeder'
import DemoMenusOrdersSeeder from '#database/seeders/07_demo_menus_orders_seeder'
import ace from '@adonisjs/core/services/ace'
import BfkSeed from '#commands/bfk_seed'
import { DEMO_ACTIVE_SUPPLEMENTS, DEMO_MEALS } from '#database/seeders/05_demo_catalog_seeder'
import { BFK_MENU_PHOTO_DIR, loadBfkMenu, seedBfkMenu } from '#database/catalog/bfk_menu'
import app from '@adonisjs/core/services/app'
import { existsSync } from 'node:fs'
import { MEAL_CATEGORIES } from '#enums/meals'
import { MEAL_DESCRIPTION_MAX_LENGTH, MEAL_NAME_MAX_LENGTH } from '#config/meals'
import { DEMO_PASSWORD, assertDemoSeeding, demoPassword } from '#database/demo/support'

const SEEDERS = [
  SchoolSeeder,
  DemoUsersSeeder,
  DemoFamilySeeder,
  HolidaySeeder,
  DemoCatalogSeeder,
  DemoFamiliesSeeder,
  DemoMenusOrdersSeeder,
]

async function seed() {
  for (const Seeder of SEEDERS) {
    await new Seeder(db.connection()).run()
  }
}

async function counts() {
  const tables = [
    'schools',
    'users',
    'children',
    'subscriptions',
    'meals',
    'meal_photos',
    'holidays',
    'weekly_menus',
    'menu_items',
    'meal_orders',
    'meal_order_items',
    'notifications',
    'outbound_emails',
  ]
  const result: Record<string, number> = {}
  for (const table of tables) {
    const row = await db.from(table).count('* as total').first()
    result[table] = Number(row.total)
  }
  return result
}

test.group('Hardening | demo seeders', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    const truncate = await testUtils.db().truncate()
    drive.fake('fs')
    return async () => {
      drive.restore('fs')
      await truncate()
    }
  })

  test('school year of the bootstrap seeder', ({ assert }) => {
    assert.deepEqual(schoolYearFor('2026-10-29'), { start: '2026-08-24', end: '2027-06-11' })
    assert.deepEqual(schoolYearFor('2027-03-01'), { start: '2026-08-24', end: '2027-06-11' })
    assert.deepEqual(schoolYearFor('2027-09-01').start, '2027-08-23')
  })

  test('demo data is complete, idempotent, and every demo account signs in', async ({
    client,
    assert,
  }) => {
    await seed()
    const first = await counts()
    assert.equal(first.schools, 1)
    assert.equal(
      Number((await db.from('users').where('role', 'parent').count('* as t').first()).t),
      15
    )
    // 13 trays + the BFK menu; only DEMO_ACTIVE_SUPPLEMENTS are active supplements.
    assert.equal(first.meals, DEMO_MEALS.length + (await loadBfkMenu()).length)
    assert.equal(first.meal_photos, first.meals)
    const activeSupplements = await db
      .from('meals')
      .where({ type: 'supplement', is_active: true })
      .orderBy('external_recipe_ref')
      .select('external_recipe_ref')
    assert.deepEqual(
      activeSupplements.map((row) => row.external_recipe_ref),
      Object.keys(DEMO_ACTIVE_SUPPLEMENTS).sort()
    )
    assert.isAtLeast(first.children, 15)
    assert.isAtLeast(first.holidays, 5)
    assert.isAtLeast(first.weekly_menus, 2)
    assert.isAbove(first.meal_orders, 50)
    // Seeding never emails anyone (in-app notifications only), and restores the setting.
    assert.equal(first.outbound_emails, 0)
    const school = await db.from('schools').first()
    assert.deepEqual(school.settings, {})

    const statuses = (await db.from('weekly_menus').select('status')).map((r) => r.status)
    assert.include(statuses, 'published')
    assert.include(statuses, 'scheduled')
    // Some children with allergies, some without a subscription.
    const allergic = await db
      .from('children')
      .whereRaw('cardinality(allergies) > 0')
      .count('* as t')
    assert.isAbove(Number(allergic[0].t), 3)
    const unsubscribed = await db
      .from('children')
      .whereNotExists((q) =>
        q.from('subscriptions').whereRaw('subscriptions.child_id = children.id')
      )
      .count('* as t')
    assert.isAbove(Number(unsubscribed[0].t), 1)
    // D9: no order line contains one of the child's allergens.
    const conflicts = await db.rawQuery(`
      SELECT count(*) AS total FROM meal_order_items moi
      JOIN meal_orders mo ON mo.id = moi.meal_order_id AND mo.status = 'active'
      JOIN children c ON c.id = mo.child_id
      JOIN meals m ON m.id = moi.meal_id
      WHERE m.allergens && c.allergies`)
    assert.equal(Number(conflicts.rows[0].total), 0)

    await seed()
    assert.deepEqual(await counts(), first)

    for (const email of [...DEMO_USERS.map((u) => u.email), 'karima.alaoui@demo.bfk.test']) {
      const login = await client
        .post('/login')
        .form({ email, password: DEMO_PASSWORD })
        .withCsrfToken()
        .redirects(0)
      assert.notEqual(login.header('location'), '/login', email)
    }
  }).timeout(120_000)

  test('bfk:seed catalog: school, meals with photos and one admin — no demo account', async ({
    client,
    assert,
  }) => {
    process.env.BFK_NEW_PASSWORD = 'ChefBfk2026!'
    try {
      for (let run = 0; run < 2; run++) {
        const command = await ace.create(BfkSeed, [
          'catalog',
          '--email=Chef@BFK.ma',
          '--name=Chef BFK',
        ])
        await command.exec()
        assert.equal(command.exitCode, 0)
      }
    } finally {
      delete process.env.BFK_NEW_PASSWORD
    }
    const users = await db.from('users').select('email', 'role')
    assert.deepEqual(users, [{ email: 'chef@bfk.ma', role: 'admin' }])
    const first = await counts()
    assert.equal(first.schools, 1)
    const menu = await loadBfkMenu()
    assert.equal(first.meals, DEMO_MEALS.length + menu.length)
    assert.equal(first.meal_photos, first.meals)
    assert.equal(first.children, 0)
    assert.equal(first.weekly_menus, 0)
    const creator = await db.from('meals').distinct('created_by')
    assert.equal(creator.length, 1)
    // Trays active and free; the restaurant menu inactive supplements, no demo supplement.
    const byKind = await db
      .from('meals')
      .select('type', 'is_active')
      .count('* as total')
      .groupBy('type', 'is_active')
      .orderBy('type')
    assert.deepEqual(
      byKind.map((row) => ({ ...row, total: Number(row.total) })),
      [
        { type: 'subscription', is_active: true, total: DEMO_MEALS.length },
        { type: 'supplement', is_active: false, total: menu.length },
      ]
    )

    const login = await client
      .post('/login')
      .form({ email: 'chef@bfk.ma', password: 'ChefBfk2026!' })
      .withCsrfToken()
      .redirects(0)
    assert.notEqual(login.header('location'), '/login')
  }).timeout(180_000)

  test('bfk:seed catalog needs --email; unknown profiles are refused', async ({ assert }) => {
    for (const argv of [['catalog'], ['everything']]) {
      const command = await ace.create(BfkSeed, argv)
      await command.exec()
      assert.equal(command.exitCode, 1)
    }
    assert.equal((await counts()).schools, 0)
  })

  test('production demo seeding needs ALLOW_DEMO_SEED and a strong BFK_DEMO_PASSWORD', ({
    assert,
  }) => {
    const saved = { ...process.env }
    try {
      delete process.env.ALLOW_DEMO_SEED
      delete process.env.BFK_DEMO_PASSWORD
      assert.throws(() => assertDemoSeeding(true), /ALLOW_DEMO_SEED/)
      assert.doesNotThrow(() => assertDemoSeeding(false))
      assert.equal(demoPassword(false), DEMO_PASSWORD)
      assert.throws(() => demoPassword(true), /BFK_DEMO_PASSWORD/)

      process.env.ALLOW_DEMO_SEED = 'true'
      process.env.BFK_DEMO_PASSWORD = 'short'
      assert.doesNotThrow(() => assertDemoSeeding(true))
      assert.throws(() => demoPassword(true), /BFK_DEMO_PASSWORD/)
      process.env.BFK_DEMO_PASSWORD = 'TestDeploy2026'
      assert.equal(demoPassword(true), 'TestDeploy2026')
    } finally {
      process.env.ALLOW_DEMO_SEED = saved.ALLOW_DEMO_SEED
      process.env.BFK_DEMO_PASSWORD = saved.BFK_DEMO_PASSWORD
      if (saved.ALLOW_DEMO_SEED === undefined) delete process.env.ALLOW_DEMO_SEED
      if (saved.BFK_DEMO_PASSWORD === undefined) delete process.env.BFK_DEMO_PASSWORD
    }
  })

  test('BFK menu data: valid names, categories, prices and a photo for each item', async ({
    assert,
  }) => {
    const menu = await loadBfkMenu()
    assert.isAbove(menu.length, 100)
    assert.equal(new Set(menu.map((item) => item.ref)).size, menu.length)
    for (const item of menu) {
      assert.match(item.ref, /^bfk-site:\d+$/)
      for (const name of [item.nameFr, item.nameEn]) {
        assert.isTrue(name.trim().length > 0 && name.length <= MEAL_NAME_MAX_LENGTH, item.ref)
      }
      for (const text of [item.descriptionFr, item.descriptionEn]) {
        assert.isTrue(text === null || text.length <= MEAL_DESCRIPTION_MAX_LENGTH, item.ref)
      }
      assert.include(MEAL_CATEGORIES, item.category)
      assert.isTrue(Number.isInteger(item.priceCents) && item.priceCents > 0, item.ref)
      assert.isTrue(existsSync(app.makePath(BFK_MENU_PHOTO_DIR, item.photo)), item.photo)
    }
  })

  test('BFK menu seeding: inactive supplements, staff edits kept, deleted ones not recreated', async ({
    assert,
  }) => {
    const items = (await loadBfkMenu()).slice(0, 3)
    await seedBfkMenu(items)
    const meals = await db.from('meals').orderBy('id')
    assert.lengthOf(meals, 3)
    for (const meal of meals) {
      assert.equal(meal.type, 'supplement')
      assert.isFalse(meal.is_active)
      assert.deepEqual(meal.allergens, [])
    }
    assert.equal(Number((await db.from('meal_photos').count('* as t').first()).t), 3)

    await db.from('meals').where('id', meals[0].id).update({ price_cents: 1234, is_active: true })
    await db.from('meals').where('id', meals[1].id).update({ deleted_at: new Date() })
    await seedBfkMenu(items)
    const again = await db.from('meals').orderBy('id')
    assert.lengthOf(again, 3)
    assert.equal(again[0].price_cents, 1234)
    assert.isTrue(again[0].is_active)
    assert.equal(Number((await db.from('meal_photos').count('* as t').first()).t), 3)
  })
})
