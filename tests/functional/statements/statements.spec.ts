/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import ExcelJS from 'exceljs'
import { UserFactory } from '#database/factories/user_factory'
import { SchoolFactory } from '#database/factories/school_factory'
import HolidayImpactService from '#services/holiday_impact_service'
import StatementService from '#services/statement_service'
import StatementPdfService from '#services/statement_pdf_service'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { addHoliday } from '#tests/helpers/menus'
import { MON, TUE, WED, THU, FRI, addChild, orderSchool, orders } from '#tests/helpers/orders'
import { asBinary, order, pupil } from '#tests/helpers/reports'
import { centsToNumber } from '#services/statement_export_service'
import {
  isProvisional,
  isStatementMonth,
  monthRange,
  maxStatementMonth,
} from '#support/statement_month'
import { DateTime } from 'luxon'

const OPEN = '2026-11-20T12:00'
const MONTH = '2026-11'

type Props = Record<string, any>

/**
 * November 2026, week of Mon 23 (main 45 MAD, alt 50 MAD, juice 10 MAD):
 * - Adam (subscribed): Mon main 45 + juice ×2 @10; then main → 60 MAD and
 *   juice → 12 MAD; Tue main @60 + juice ×1 @12; Wed ordered then
 *   "absent"; Thu ordered then the day becomes a holiday (cancelled);
 *   Fri nothing.
 * - Lina (same parent, not subscribed): Mon juice ×1 @12 only.
 * - Other family: Mon alt 50.
 */
async function november() {
  const ctx = await orderSchool()
  const { school, main, alt, juice } = ctx
  const family = await pupil(school, { firstName: 'Adam', lastName: 'Benali' })
  const lina = await addChild(family.parent, {
    subscribed: false,
    child: { firstName: 'Lina', lastName: 'Benali' },
  })
  const other = await pupil(school, { firstName: 'Omar', lastName: 'Zid' })

  freezeClock(OPEN)
  await order(family.parent, family.child, MON, main.id, [{ mealId: juice.id, qty: 2 }])
  main.priceCents = 6000
  await main.save()
  juice.priceCents = 1200
  await juice.save()
  await order(family.parent, family.child, TUE, main.id, [{ mealId: juice.id, qty: 1 }])
  await order(family.parent, family.child, WED, main.id)
  await (await orders()).cancelDay(family.child.id, WED, { user: family.parent })
  await order(family.parent, family.child, THU, main.id, [{ mealId: juice.id, qty: 3 }])
  await order(family.parent, lina, MON, null, [{ mealId: juice.id, qty: 1 }])
  await order(other.parent, other.child, MON, alt.id)

  // Thursday becomes a holiday: the order is cancelled (reason holiday).
  await addHoliday(school, THU, 'Storm')
  await (await app.container.make(HolidayImpactService)).cancelAffectedOrders(school.id, [THU])

  return { ...ctx, parent: family.parent, adam: family.child, lina, other }
}

async function service() {
  return app.container.make(StatementService)
}

async function familyStatement(
  ctx: Awaited<ReturnType<typeof november>>,
  month = MONTH,
  today = '2026-11-20'
) {
  const children = [ctx.adam, ctx.lina].map((child) => ({
    id: child.id,
    firstName: child.firstName,
    lastName: child.lastName,
    grade: child.grade,
    className: child.className,
    isActive: child.isActive,
  }))
  return (await service()).family({
    school: ctx.school,
    parent: { id: ctx.parent.id, fullName: ctx.parent.fullName, email: ctx.parent.email },
    children,
    month,
    today,
  })
}

/** Sum of the snapshot line totals of active orders, straight from SQL. */
async function sqlTotal(childIds: number[], from: string, to: string) {
  const result = await db.rawQuery(
    `SELECT COALESCE(SUM(moi.line_total_cents), 0)::int AS total
       FROM meal_orders mo JOIN meal_order_items moi ON moi.meal_order_id = mo.id
      WHERE mo.child_id = ANY(?::int[]) AND mo.status = 'active' AND mo.date BETWEEN ? AND ?`,
    [childIds, from, to]
  )
  return Number(result.rows[0].total)
}

test.group('Statements | math', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('snapshots, cancelled and holiday days, several children, family total', async ({
    assert,
  }) => {
    const ctx = await november()
    const statement = await familyStatement(ctx)

    assert.equal(statement.month, MONTH)
    assert.equal(statement.from, '2026-11-01')
    assert.equal(statement.to, '2026-11-30')
    assert.isTrue(statement.provisional)
    assert.equal(statement.billingMode, 'per_meal')
    assert.deepEqual(
      statement.children.map((child) => child.firstName),
      ['Adam', 'Lina']
    )
    const [adam, lina] = statement.children

    // Mid-month price change: one subscription line per snapshot price.
    assert.equal(adam.subscription.count, 2)
    assert.deepEqual(
      adam.subscription.lines.map((line) => [line.unitPriceCents, line.quantity, line.amountCents]),
      [
        [4500, 1, 4500],
        [6000, 1, 6000],
      ]
    )
    assert.equal(adam.subscription.amountCents, 10500)
    assert.equal(adam.subscription.billedAs, 'per_meal')
    // Supplements: one line per item and snapshot price.
    assert.deepEqual(
      adam.supplements.lines.map((line) => [
        line.mealId,
        line.unitPriceCents,
        line.quantity,
        line.amountCents,
      ]),
      [
        [ctx.juice.id, 1000, 2, 2000],
        [ctx.juice.id, 1200, 1, 1200],
      ]
    )
    assert.equal(adam.supplements.lines[0].nameFr, ctx.juice.nameFr)
    assert.equal(adam.supplements.count, 3)
    assert.equal(adam.totalCents, 13700)
    // Wed (absent), Thu (holiday) and Fri (no order) contribute nothing.
    assert.deepEqual(
      adam.days.map((day) => [day.date, day.totalCents]),
      [
        [MON, 6500],
        [TUE, 7200],
      ]
    )
    assert.notInclude(
      adam.days.map((day) => day.date),
      THU
    )
    assert.notInclude(
      adam.days.map((day) => day.date),
      FRI
    )

    // Lina: extras only, no subscription meal.
    assert.equal(lina.subscription.count, 0)
    assert.equal(lina.subscription.amountCents, 0)
    assert.equal(lina.totalCents, 1200)

    // Family total = sum of the children = SQL sum of the snapshots.
    assert.equal(statement.totals.totalCents, 14900)
    assert.equal(statement.totals.subscriptionCents, 10500)
    assert.equal(statement.totals.supplementCents, 4400)
    assert.equal(
      statement.totals.totalCents,
      await sqlTotal([ctx.adam.id, ctx.lina.id], statement.from, statement.to)
    )
    // The current catalog price never changes past statements.
    ctx.main.priceCents = 9900
    await ctx.main.save()
    assert.equal((await familyStatement(ctx)).totals.totalCents, 14900)
  })

  test('other months are empty; a past month is final', async ({ assert }) => {
    const ctx = await november()
    const october = await familyStatement(ctx, '2026-10', '2026-12-05')
    assert.equal(october.totals.totalCents, 0)
    assert.isFalse(october.provisional)
    // Active children are listed with zero; nothing billed.
    assert.deepEqual(
      october.children.map((c) => c.totalCents),
      [0, 0]
    )
    const past = await familyStatement(ctx, MONTH, '2026-12-05')
    assert.isFalse(past.provisional)
    assert.equal(past.totals.totalCents, 14900)
  })

  test('an inactive child with nothing billed is left out', async ({ assert }) => {
    const ctx = await november()
    ctx.lina.isActive = false
    await ctx.lina.save()
    const statement = await familyStatement(ctx, '2026-10', '2026-11-20')
    assert.deepEqual(
      statement.children.map((c) => c.firstName),
      ['Adam']
    )
  })

  test('monthly fee: the fee replaces subscription meals of subscribed children (no proration)', async ({
    assert,
  }) => {
    const ctx = await november()
    ctx.school.settings = { billing_mode: 'monthly_fee', monthly_fee_cents: 80000 }
    await ctx.school.save()
    const statement = await familyStatement(ctx)
    const [adam, lina] = statement.children
    assert.equal(statement.billingMode, 'monthly_fee')
    assert.equal(adam.subscription.billedAs, 'monthly_fee')
    assert.equal(adam.subscription.count, 2)
    assert.equal(adam.subscription.mealsCents, 10500)
    assert.equal(adam.subscription.amountCents, 80000)
    assert.equal(adam.totalCents, 83200) // fee + extras per item
    // Lina has no subscription: no fee, extras only.
    assert.equal(lina.subscription.billedAs, 'per_meal')
    assert.equal(lina.totalCents, 1200)
    assert.equal(statement.totals.totalCents, 84400)
    assert.isFalse(statement.feeMissing)

    // A subscribed child without any meal that month still pays the fee.
    const october = await familyStatement(ctx, '2026-10', '2026-11-20')
    assert.equal(october.children[0].subscription.amountCents, 80000)
    // School overview agrees.
    const school = await (await service()).school(ctx.school, '2026-10', '2026-11-20')
    assert.equal(school.totals.subscriptionCents, 160000) // Adam + Omar
    // Unset fee → 0 and flagged.
    ctx.school.settings = { billing_mode: 'monthly_fee' }
    await ctx.school.save()
    const unset = await familyStatement(ctx)
    assert.isTrue(unset.feeMissing)
    assert.equal(unset.children[0].subscription.amountCents, 0)
  })

  test('school overview: every family with totals that match the family statements', async ({
    assert,
  }) => {
    const ctx = await november()
    const school = await (await service()).school(ctx.school, MONTH, '2026-11-20')
    assert.equal(school.totals.families, 2)
    assert.equal(school.totals.children, 3)
    const mine = school.families.find((f) => f.parentId === ctx.parent.id)!
    assert.equal(mine.totals.totalCents, 14900)
    assert.equal(mine.totals.subscriptionCount, 2)
    assert.equal(mine.totals.supplementCount, 4)
    const other = school.families.find((f) => f.parentId === ctx.other.parent.id)!
    assert.equal(other.totals.totalCents, 5000)
    assert.equal(school.totals.totalCents, 19900)
    // Another school sees nothing.
    const elsewhere = await SchoolFactory.create()
    const empty = await (await service()).school(elsewhere, MONTH, '2026-11-20')
    assert.lengthOf(empty.families, 0)
    assert.equal(empty.totals.totalCents, 0)
  })

  test('month helpers: window, range, provisional; money export without floats', ({ assert }) => {
    assert.isTrue(isStatementMonth('2026-12', '2026-11-20'))
    assert.isFalse(isStatementMonth('2027-01', '2026-11-20'))
    assert.isFalse(isStatementMonth('1999-12', '2026-11-20'))
    assert.isFalse(isStatementMonth('2026-13', '2026-11-20'))
    assert.isFalse(isStatementMonth('2026-1', '2026-11-20'))
    assert.equal(maxStatementMonth('2026-12-31'), '2027-01')
    assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' })
    assert.isTrue(isProvisional('2026-11', '2026-11-01'))
    assert.isFalse(isProvisional('2026-10', '2026-11-01'))
    assert.equal(centsToNumber(14900), 149)
    assert.equal(centsToNumber(1005), 10.05)
    assert.equal(centsToNumber(-250), -2.5)
  })
})

test.group('Statements | PDF', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('renders a non-empty A4 PDF (Arabic name, monthly fee, provisional)', async ({ assert }) => {
    const ctx = await november()
    ctx.adam.firstName = 'محمد'
    await ctx.adam.save()
    const pdf = await app.container.make(StatementPdfService)
    for (const settings of [
      {},
      { billing_mode: 'monthly_fee' as const, monthly_fee_cents: 50000 },
    ]) {
      ctx.school.settings = settings
      await ctx.school.save()
      const statement = await familyStatement(ctx)
      const bytes = await pdf.render(statement, {
        locale: 'fr',
        generatedAt: DateTime.fromISO('2026-11-20T12:00'),
      })
      assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-')
      assert.isAbove(bytes.length, 2000)
      assert.match(bytes.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/)
    }
    // An empty statement still renders.
    const empty = await familyStatement(ctx, '2026-09', '2026-11-20')
    const bytes = await pdf.render(empty, { locale: 'en', generatedAt: DateTime.now() })
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-')
  })

  test('parent download and back-office download', async ({ client, assert }) => {
    const ctx = await november()
    const response = await client.get(`/statements/pdf?month=${MONTH}`).loginAs(ctx.parent)
    response.assertStatus(200)
    assert.equal(response.header('content-type'), 'application/pdf')
    assert.equal(
      response.header('content-disposition'),
      `attachment; filename="bfk-statement-${MONTH}.pdf"`
    )
    assert.equal((response.body() as Buffer).subarray(0, 5).toString('latin1'), '%PDF-')

    const one = await client
      .get(`/statements/pdf?month=${MONTH}&child=${ctx.lina.id}`)
      .loginAs(ctx.parent)
    one.assertStatus(200)
    assert.equal(
      one.header('content-disposition'),
      `attachment; filename="bfk-statement-${MONTH}-child-${ctx.lina.id}.pdf"`
    )

    const staff = await client
      .get(`/admin/statements/parents/${ctx.parent.id}/pdf?month=${MONTH}`)
      .loginAs(ctx.manager)
    staff.assertStatus(200)
    assert.equal(staff.header('content-type'), 'application/pdf')
  })
})

test.group('Statements | pages and access', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('parent page: own family, child filter, month picker', async ({ client, assert }) => {
    const ctx = await november()
    const response = await client
      .get(`/statements?month=${MONTH}`)
      .loginAs(ctx.parent)
      .withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('parent/statements/index')
    const props = response.inertiaProps as Props
    assert.equal(props.statement.totals.totalCents, 14900)
    assert.equal(props.statement.totals.total, '149,00 MAD')
    assert.isTrue(props.statement.provisional)
    assert.equal(props.nav.value, MONTH)
    assert.equal(props.nav.next, '2026-12')
    assert.isNull(
      (await client.get('/statements?month=2026-12').loginAs(ctx.parent).withInertia()).inertiaProps
        .nav.next
    )
    assert.deepEqual(
      props.children.map((c: Props) => c.firstName),
      ['Adam', 'Lina']
    )
    assert.equal(props.pdfUrl, `/statements/pdf?month=${MONTH}`)

    const filtered = await client
      .get(`/statements?month=${MONTH}&child=${ctx.adam.id}`)
      .loginAs(ctx.parent)
      .withInertia()
    assert.equal((filtered.inertiaProps as Props).statement.totals.totalCents, 13700)
    assert.lengthOf((filtered.inertiaProps as Props).statement.children, 1)

    // A bad month falls back to the current one on the page.
    const bad = await client.get('/statements?month=2026-13').loginAs(ctx.parent).withInertia()
    bad.assertStatus(200)
    assert.equal((bad.inertiaProps as Props).nav.value, MONTH)
  })

  test('a parent sees only their own statements (foreign ids are 404)', async ({
    client,
    assert,
  }) => {
    const ctx = await november()
    for (const url of [
      `/statements?child=${ctx.other.child.id}`,
      `/statements/pdf?month=${MONTH}&child=${ctx.other.child.id}`,
      '/statements?child=abc',
      '/statements?child=99999999999',
      `/statements/pdf?month=${MONTH}&child=0`,
      '/statements/pdf?month=1999-12',
      '/statements/pdf?month=2027-06',
      '/statements/pdf?month=nope',
    ]) {
      const response = await client.get(url).loginAs(ctx.parent)
      response.assertStatus(404)
    }
    // The other parent's statement never includes this family.
    const response = await client
      .get(`/statements?month=${MONTH}`)
      .loginAs(ctx.other.parent)
      .withInertia()
    const props = response.inertiaProps as Props
    response.assertStatus(200)
    assert.deepEqual(
      props.statement.children.map((c: Props) => c.childId),
      [ctx.other.child.id]
    )
    assert.equal(props.statement.totals.totalCents, 5000)
  })

  test('back-office list, family page, export; other schools are 404; kitchen and parents refused', async ({
    client,
    assert,
  }) => {
    const ctx = await november()
    const list = await client
      .get(`/admin/statements?month=${MONTH}`)
      .loginAs(ctx.manager)
      .withInertia()
    list.assertStatus(200)
    list.assertInertiaComponent('admin/statements/index')
    const props = list.inertiaProps as Props
    assert.equal(props.totals.totalCents, 19900)
    assert.equal(props.totals.families, 2)
    assert.lengthOf(props.families, 2)

    const search = await client
      .get(`/admin/statements?month=${MONTH}&q=lina`)
      .loginAs(ctx.admin)
      .withInertia()
    assert.deepEqual(
      (search.inertiaProps as Props).families.map((f: Props) => f.parentId),
      [ctx.parent.id]
    )

    const page = await client
      .get(`/admin/statements/parents/${ctx.parent.id}?month=${MONTH}`)
      .loginAs(ctx.manager)
      .withInertia()
    page.assertStatus(200)
    assert.equal((page.inertiaProps as Props).statement.totals.totalCents, 14900)

    const xlsx = await asBinary(
      client.get(`/admin/statements/export?month=${MONTH}`).loginAs(ctx.manager)
    )
    xlsx.assertStatus(200)
    assert.equal(
      xlsx.header('content-disposition'),
      `attachment; filename="bfk-statements-${MONTH}.xlsx"`
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(xlsx.body() as any)
    const families = workbook.worksheets[0]
    const totalRow = families.getRow(families.rowCount).values as unknown[]
    // D28: no email column — parent, children, counts and amounts only.
    assert.equal(totalRow[7], 199)
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => {
        assert.notInclude(JSON.stringify(row.values), '@', `no email in ${sheet.name}`)
      })
    }
    const children = workbook.worksheets[1]
    assert.equal(children.rowCount, 1 + 3 + 1)

    // Another school's staff: 404 on the family, nothing in their list.
    const elsewhere = await SchoolFactory.create()
    const stranger = await UserFactory.apply('manager').merge({ schoolId: elsewhere.id }).create()
    ;(
      await client.get(`/admin/statements/parents/${ctx.parent.id}`).loginAs(stranger)
    ).assertStatus(404)
    ;(
      await client.get(`/admin/statements/parents/${ctx.parent.id}/pdf`).loginAs(stranger)
    ).assertStatus(404)
    const theirs = await client
      .get(`/admin/statements?month=${MONTH}`)
      .loginAs(stranger)
      .withInertia()
    assert.lengthOf((theirs.inertiaProps as Props).families, 0)
    // A staff id that is not a parent is a 404 too.
    ;(
      await client.get(`/admin/statements/parents/${ctx.manager.id}`).loginAs(ctx.manager)
    ).assertStatus(404)
    ;(await client.get('/admin/statements/export?month=2030-01').loginAs(ctx.manager)).assertStatus(
      404
    )

    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: ctx.school.id }).create()
    for (const url of [
      '/admin/statements',
      `/admin/statements/parents/${ctx.parent.id}`,
      '/admin/statements/export',
      '/statements',
    ]) {
      ;(await client.get(url).loginAs(kitchen)).assertStatus(403)
    }
    ;(await client.get('/admin/statements').loginAs(ctx.parent)).assertStatus(403)
    ;(await client.get('/statements').loginAs(ctx.manager)).assertStatus(403)
  })
})
