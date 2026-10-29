/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import HolidayImpactService from '#services/holiday_impact_service'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { addHoliday } from '#tests/helpers/menus'
import { MON, TUE, WED, FRI, orderSchool, orders } from '#tests/helpers/orders'
import { countQueries, order, pupil, reports } from '#tests/helpers/reports'

const OPEN = '2026-11-20T12:00'

/**
 * Tuesday 24 Nov 2026 (published menu: main 45 MAD, alt 50 MAD with nuts,
 * juice 10 MAD):
 * - Ada (G3 / 3B): main + juice ×2, dietary notes only
 * - Bob (G3 / 3A): alt + juice, then gets a nut allergy (conflict)
 * - Cy  (G4 / 4A, milk): main
 * - Dee: "no meal" (absent)          → not counted, but a choice
 * - Eve: main, cancelled by staff    → not counted
 * - Fay: subscribed, no order        → missing
 * - Gus: not subscribed, no order    → not eligible
 */
async function tuesday() {
  const ctx = await orderSchool()
  const { school, manager, main, alt, juice } = ctx
  const ada = await pupil(school, {
    grade: 'G3',
    className: '3B',
    firstName: 'Ada',
    lastName: 'Zed',
    dietaryNotes: 'Halal',
  })
  const bob = await pupil(school, {
    grade: 'G3',
    className: '3A',
    firstName: 'Bob',
    lastName: 'Young',
  })
  const cy = await pupil(school, {
    grade: 'G4',
    className: '4A',
    firstName: 'Cy',
    lastName: 'Xu',
    allergies: ['milk'],
  })
  const dee = await pupil(school, { firstName: 'Dee', lastName: 'Ward' })
  const eve = await pupil(school, { firstName: 'Eve', lastName: 'Vale' })
  const fay = await pupil(school, { firstName: 'Fay', lastName: 'Ure', className: '5C' })
  await pupil(school, { firstName: 'Gus', lastName: 'Tan', subscribed: false })

  freezeClock(OPEN)
  await order(ada.parent, ada.child, TUE, main.id, [{ mealId: juice.id, qty: 2 }])
  await order(bob.parent, bob.child, TUE, alt.id, [{ mealId: juice.id, qty: 1 }])
  await order(cy.parent, cy.child, TUE, main.id)
  await (await orders()).cancelDay(dee.child.id, TUE, { user: dee.parent })
  await order(eve.parent, eve.child, TUE, main.id)
  await (await orders()).cancelDay(eve.child.id, TUE, { user: manager }, { reason: 'Sick' })
  // An allergy added after ordering: the sheet must flag it.
  bob.child.allergies = ['nuts']
  await bob.child.save()
  return { ...ctx, ada, bob, cy, dee, eve, fay }
}

test.group('Reports | production aggregations', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('quantities per meal with grade/class breakdown, active orders only', async ({ assert }) => {
    const { school, main, alt, juice } = await tuesday()
    const sheet = await (await reports()).production(school.id, TUE)

    const byMeal = new Map(sheet.lines.map((line) => [line.meal.id, line]))
    assert.deepEqual(
      sheet.lines.map((line) => line.meal.id),
      [main.id, alt.id, juice.id],
      'main dishes first (most ordered first), then extras'
    )
    const mainLine = byMeal.get(main.id)!
    assert.equal(mainLine.total, 2) // Ada + Cy (Eve cancelled, Dee absent)
    assert.deepEqual(mainLine.byGrade, { G3: 1, G4: 1 })
    assert.deepEqual(mainLine.byClass, { '3B': 1, '4A': 1 })
    assert.equal(byMeal.get(alt.id)!.total, 1)
    const juiceLine = byMeal.get(juice.id)!
    assert.equal(juiceLine.mealType, 'supplement')
    assert.equal(juiceLine.total, 3)
    assert.deepEqual(juiceLine.byClass, { '3B': 2, '3A': 1 })

    assert.equal(sheet.totals.subscription.total, 3)
    assert.deepEqual(sheet.totals.subscription.byGrade, { G3: 2, G4: 1 })
    assert.equal(sheet.totals.supplement.total, 3)
    assert.deepEqual(sheet.grades, ['G3', 'G4'])
    assert.deepEqual(
      sheet.classes.map((entry) => entry.className),
      ['3A', '3B', '4A']
    )
    assert.deepEqual(sheet.orders, { active: 3, absent: 1, cancelled: 1, withAllergies: 2 })

    // Another day / another school: nothing.
    const monday = await (await reports()).production(school.id, MON)
    assert.lengthOf(monday.lines, 0)
    assert.equal(monday.totals.subscription.total, 0)
  })

  test('a holiday day is empty (its orders were cancelled) and costs nothing', async ({
    assert,
  }) => {
    const { school, main, juice, ada, bob } = await tuesday()
    await order(ada.parent, ada.child, WED, main.id, [{ mealId: juice.id, qty: 1 }])
    await order(bob.parent, bob.child, WED, main.id)
    const service = await reports()
    assert.equal((await service.production(school.id, WED)).totals.subscription.total, 2)

    await addHoliday(school, WED, 'Storm')
    const impact = await app.container.make(HolidayImpactService)
    await impact.cancelAffectedOrders(school.id, [WED])

    const sheet = await service.production(school.id, WED)
    assert.lengthOf(sheet.lines, 0)
    assert.equal(sheet.orders.active, 0)
    assert.equal(sheet.orders.cancelled, 2)
    const wednesday = await service.amounts(school.id, WED, WED)
    assert.deepEqual(wednesday, {
      subscriptionMeals: 0,
      supplementCount: 0,
      totalCents: 0,
      orders: 0,
    })
    assert.lengthOf(await service.labels(school.id, WED, { limit: 100 }), 0)
  })

  test('amounts of a period: supplements billed from snapshot prices, subscription meals counted (D31)', async ({
    assert,
  }) => {
    const { school, main, ada, juice } = await tuesday()
    // A later price change never touches what was ordered.
    juice.priceCents = 9900
    await juice.save()
    await order(ada.parent, ada.child, FRI, main.id, [{ mealId: juice.id, qty: 1 }])

    const service = await reports()
    const tuesdayOnly = await service.amounts(school.id, TUE, TUE)
    // Ada main + 2×1000, Bob alt + 1000, Cy main (Eve cancelled, Dee absent)
    assert.deepEqual(tuesdayOnly, {
      subscriptionMeals: 3,
      supplementCount: 3,
      totalCents: 3000,
      orders: 3,
    })
    // Even a legacy priced subscription snapshot is never billed.
    await db.rawQuery(
      `UPDATE meal_order_items SET unit_price_cents = 4500 WHERE meal_type = 'subscription'`
    )
    const week = await service.amounts(school.id, MON, FRI)
    assert.deepEqual(week, {
      subscriptionMeals: 4,
      supplementCount: 4,
      totalCents: 3000 + 9900,
      orders: 4,
    })
  })

  test('children without a selection: subscribed, active, no order row at all', async ({
    assert,
  }) => {
    const { school, fay, ada } = await tuesday()
    const missing = await (await reports()).missingSelections(school.id, TUE)
    // Eligible: Ada, Bob, Cy, Dee (absent = a choice), Eve (staff-cancelled row), Fay.
    assert.equal(missing.eligible, 6)
    assert.equal(missing.missing, 1)
    assert.deepEqual(
      missing.children.map((child) => child.id),
      [fay.child.id]
    )

    // An inactive child or parent is not chased.
    fay.parent.isActive = false
    await fay.parent.save()
    const after = await (await reports()).missingSelections(school.id, TUE)
    assert.equal(after.eligible, 5)
    assert.equal(after.missing, 0)

    // Monday: nobody ordered.
    const monday = await (await reports()).missingSelections(school.id, MON)
    assert.equal(monday.missing, 5)
    assert.notInclude(
      monday.children.map((child) => child.id),
      fay.child.id
    )
    assert.include(
      monday.children.map((child) => child.id),
      ada.child.id
    )
  })

  test('allergy sheet: children with allergies or notes who eat, conflicts first', async ({
    assert,
  }) => {
    const { school, ada, bob, cy, alt } = await tuesday()
    const rows = await (await reports()).allergySheet(school.id, TUE)
    assert.deepEqual(
      rows.map((row) => row.childId),
      [bob.child.id, ada.child.id, cy.child.id]
    )
    const [bobRow, adaRow, cyRow] = rows
    assert.isTrue(bobRow.hasConflict)
    const altLine = bobRow.lines.find((line) => line.mealId === alt.id)!
    assert.deepEqual(altLine.conflicts, ['nuts'])
    assert.deepEqual(
      bobRow.lines.filter((line) => line.mealId !== alt.id).flatMap((line) => line.conflicts),
      []
    )
    assert.isFalse(adaRow.hasConflict)
    assert.equal(adaRow.dietaryNotes, 'Halal')
    assert.deepEqual(adaRow.allergies, [])
    assert.isFalse(cyRow.hasConflict)
    assert.deepEqual(cyRow.allergies, ['milk'])
    // Dee (absent) and Eve (cancelled) never appear, nor children without allergies/notes.
    assert.lengthOf(rows, 3)
  })

  test('labels: one per active order, sorted by class then name, class filter', async ({
    assert,
  }) => {
    const { school, ada, bob, cy } = await tuesday()
    const service = await reports()
    const labels = await service.labels(school.id, TUE, { limit: 100 })
    assert.deepEqual(
      labels.map((label) => label.firstName),
      ['Bob', 'Ada', 'Cy'] // 3A, 3B, 4A
    )
    assert.equal(await service.countLabels(school.id, TUE), 3)
    const ada3b = await service.labels(school.id, TUE, { className: '3B', limit: 100 })
    assert.deepEqual(
      ada3b.map((label) => label.orderId),
      [labels[1].orderId]
    )
    assert.equal(await service.countLabels(school.id, TUE, '3B'), 1)
    assert.lengthOf(labels[1].lines, 2) // main + juice
    assert.isTrue(labels[0].hasConflict)
    assert.equal(ada.child.firstName, 'Ada')
    assert.equal(bob.child.className, '3A')
    assert.equal(cy.child.grade, 'G4')
    // Bounded by the limit.
    assert.lengthOf(await service.labels(school.id, TUE, { limit: 2 }), 2)
  })

  test('no N+1: the production sheet runs the same number of queries for 3 or 15 children', async ({
    assert,
  }) => {
    const { school, main, juice } = await tuesday()
    const service = await reports()
    const small = await countQueries(() => service.production(school.id, TUE))
    const smallAllergy = await countQueries(() => service.allergySheet(school.id, TUE))
    const smallLabels = await countQueries(() => service.labels(school.id, TUE, { limit: 100 }))
    for (let index = 0; index < 12; index += 1) {
      const extra = await pupil(school, {
        className: `${index % 4}X`,
        grade: `G${index % 3}`,
        allergies: index % 2 ? ['milk'] : [],
      })
      await order(extra.parent, extra.child, TUE, main.id, [{ mealId: juice.id, qty: 1 }])
    }
    assert.equal(await countQueries(() => service.production(school.id, TUE)), small)
    assert.equal(await countQueries(() => service.allergySheet(school.id, TUE)), smallAllergy)
    assert.equal(
      await countQueries(() => service.labels(school.id, TUE, { limit: 100 })),
      smallLabels
    )
    assert.isAtMost(small, 3)
    assert.equal(smallAllergy, 1)
    assert.equal(smallLabels, 1)
    assert.equal((await service.production(school.id, TUE)).totals.subscription.total, 15)
  })
})
