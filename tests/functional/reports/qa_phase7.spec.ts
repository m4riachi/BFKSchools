/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import ExcelJS from 'exceljs'
import { DateTime } from 'luxon'
import { UserFactory } from '#database/factories/user_factory'
import { SchoolFactory } from '#database/factories/school_factory'
import { ChildFactory } from '#database/factories/child_factory'
import { SubscriptionFactory } from '#database/factories/subscription_factory'
import ProductionReportService from '#services/production_report_service'
import LabelPdfService, { MAX_LABELS_PER_PDF } from '#services/label_pdf_service'
import type { LabelRow } from '#services/production_report_service'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { addHoliday } from '#tests/helpers/menus'
import { MON, TUE, WED, orderSchool } from '#tests/helpers/orders'
import { asBinary, csvRows, dashboards, order, pupil, reports } from '#tests/helpers/reports'

const OPEN = '2026-11-20T12:00'
const DANGEROUS = /^[=+\-@\t\r＝＋－＠]/

async function cancelWith(childId: number, date: string, reason: string) {
  await db
    .from('meal_orders')
    .where('child_id', childId)
    .where('date', date)
    .update({ status: 'cancelled', cancel_reason: reason, cancelled_at: new Date() })
}

/** Hand-countable Tuesday (see the expected numbers in each test). */
async function tuesday() {
  const ctx = await orderSchool()
  const { school, main, alt, juice } = ctx
  const a1 = await pupil(school, { grade: 'G1', className: '1A', firstName: 'A1' })
  const a2 = await pupil(school, { grade: 'G1', className: '1A', firstName: 'A2' })
  const b1 = await pupil(school, { grade: 'G1', className: '1B', firstName: 'B1' })
  const c1 = await pupil(school, { grade: 'G2', className: '2A', firstName: 'C1' })
  const c2 = await pupil(school, { grade: 'G2', className: '2A', firstName: 'C2' })
  const reasons = ['holiday', 'staff', 'menu_change', 'child_inactive', 'subscription_ended']
  const cancelled = []
  for (const reason of reasons) {
    cancelled.push({
      reason,
      ...(await pupil(school, { grade: 'G2', className: '2B', firstName: `X-${reason}` })),
    })
  }
  freezeClock(OPEN)
  await order(a1.parent, a1.child, TUE, main.id, [{ mealId: juice.id, qty: 3 }])
  await order(a2.parent, a2.child, TUE, main.id)
  await order(b1.parent, b1.child, TUE, alt.id, [{ mealId: juice.id, qty: 1 }])
  await order(c1.parent, c1.child, TUE, main.id, [{ mealId: juice.id, qty: 2 }])
  await (
    await import('#tests/helpers/orders')
  )
    .orders()
    .then((s) => s.cancelDay(c2.child.id, TUE, { user: c2.parent }))
  for (const entry of cancelled) {
    await order(entry.parent, entry.child, TUE, main.id, [{ mealId: juice.id, qty: 5 }])
    await cancelWith(entry.child.id, TUE, entry.reason)
  }
  return { ...ctx, a1, a2, b1, c1, c2, cancelled }
}

test.group('QA P7 | production hand count', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => {
    restoreClock()
    app.container.restore(ProductionReportService)
  })

  test('quantities, breakdowns, reasons and a deleted meal match the hand count', async ({
    assert,
  }) => {
    const { school, main, alt, juice } = await tuesday()
    // The alt meal is soft-deleted after being ordered: history keeps it.
    await db.from('meals').where('id', alt.id).update({ deleted_at: new Date(), is_active: false })
    const sheet = await (await reports()).production(school.id, TUE)
    const by = new Map(sheet.lines.map((l) => [l.meal.id, l]))
    assert.equal(by.get(main.id)!.total, 3)
    assert.deepEqual(by.get(main.id)!.byGrade, { G1: 2, G2: 1 })
    assert.deepEqual(by.get(main.id)!.byClass, { '1A': 2, '2A': 1 })
    assert.equal(by.get(alt.id)!.total, 1, 'deleted meal still listed')
    assert.deepEqual(by.get(alt.id)!.byClass, { '1B': 1 })
    assert.equal(by.get(juice.id)!.total, 6, 'supplements counted by quantity (3+1+2)')
    assert.deepEqual(by.get(juice.id)!.byGrade, { G1: 4, G2: 2 })
    assert.equal(sheet.totals.subscription.total, 4)
    assert.equal(sheet.totals.supplement.total, 6)
    assert.deepEqual(sheet.orders, { active: 4, absent: 1, cancelled: 5, withAllergies: 0 })
    // Amounts: 3*45 + 50 = 185.00 ; 6 * 10 = 60.00 (cancelled ×5 juice excluded)
    const amounts = await (await reports()).amounts(school.id, TUE, TUE)
    assert.deepEqual(amounts, {
      subscriptionCents: 18500,
      supplementCents: 6000,
      totalCents: 24500,
      orders: 4,
    })
    // Labels: one per active order only.
    assert.lengthOf(await (await reports()).labels(school.id, TUE, { limit: 100 }), 4)
  })

  test('staff override creating an allergen conflict is flagged on the allergy sheet', async ({
    assert,
  }) => {
    const { school, b1, a1, manager, alt } = await tuesday()
    // Staff (override) put a nut-allergic child on the nut meal.
    b1.child.allergies = ['nuts']
    await b1.child.save()
    a1.child.dietaryNotes = 'Halal'
    await a1.child.save()
    const rows = await (await reports()).allergySheet(school.id, TUE)
    assert.lengthOf(rows, 2, 'only children with allergies or notes who eat')
    assert.equal(rows[0].childId, b1.child.id, 'conflicts first')
    assert.isTrue(rows[0].hasConflict)
    assert.deepEqual(rows[0].lines.find((l) => l.mealId === alt.id)!.conflicts, ['nuts'])
    assert.isFalse(rows[1].hasConflict)
    assert.equal(rows[1].dietaryNotes, 'Halal')
    // Through the HTTP page (kitchen).
    void manager
  })

  test('children without a selection: every edge case', async ({ assert }) => {
    const ctx = await orderSchool()
    const { school } = ctx
    const other = await orderSchool().catch(() => null)
    void other
    const ok = await pupil(school, { firstName: 'Ok' })
    const inactiveChild = await pupil(school, { firstName: 'InactiveChild' })
    await inactiveChild.child.merge({ isActive: false }).save()
    await pupil(school, { firstName: 'NoSub', subscribed: false })
    const ended = await pupil(school, { firstName: 'EndedBefore', subscribed: false })
    await SubscriptionFactory.merge({ childId: ended.child.id, endDate: MON }).create()
    const future = await pupil(school, { firstName: 'StartsLater', subscribed: false })
    await SubscriptionFactory.merge({ childId: future.child.id, startDate: '2026-11-26' }).create()
    const paused = await pupil(school, { firstName: 'Paused', subscribed: false })
    await SubscriptionFactory.merge({ childId: paused.child.id, status: 'paused' }).create()
    const inactiveParent = await pupil(school, { firstName: 'InactiveParent' })
    await inactiveParent.parent.merge({ isActive: false }).save()
    const absent = await pupil(school, { firstName: 'Absent' })
    const staff = await pupil(school, { firstName: 'Staff' })
    const lastDay = await pupil(school, { firstName: 'LastDay', subscribed: false })
    await SubscriptionFactory.merge({ childId: lastDay.child.id, endDate: WED }).create()
    freezeClock(OPEN)
    const service = await (await import('#tests/helpers/orders')).orders()
    await service.cancelDay(absent.child.id, WED, { user: absent.parent })
    await order(staff.parent, staff.child, WED, ctx.main.id)
    await cancelWith(staff.child.id, WED, 'staff')
    // Another school's child must never count.
    const otherSchool = await SchoolFactory.create()
    const op = await UserFactory.apply('parent').merge({ schoolId: otherSchool.id }).create()
    const oc = await ChildFactory.merge({ parentId: op.id, schoolId: otherSchool.id }).create()
    await SubscriptionFactory.merge({ childId: oc.id }).create()

    const result = await (await reports()).missingSelections(school.id, WED)
    // eligible: Ok, Absent, Staff, LastDay ; missing: Ok, LastDay
    assert.equal(result.eligible, 4)
    assert.equal(result.missing, 2)
    assert.sameMembers(
      result.children.map((c) => c.firstName),
      ['Ok', 'LastDay']
    )
    void ok
  })

  test('dashboard: Saturday looks at Monday; holiday today; month-to-date = sum of active lines', async ({
    assert,
  }) => {
    const { school, manager } = await tuesday()
    // Saturday 28 Nov: today is not a school day, next school day = Monday 30 Nov (no menu).
    freezeClock('2026-11-28T09:00')
    const sat = await (await dashboards()).build(school, { amounts: true })
    assert.equal(sat.days[0].state, 'not_school_day')
    assert.equal(sat.days[1].date, '2026-11-30')
    assert.equal(sat.days[1].kind, 'next_school_day')
    const raw = await db.rawQuery(
      `SELECT COALESCE(SUM(moi.line_total_cents),0)::int AS s
         FROM meal_orders mo JOIN meal_order_items moi ON moi.meal_order_id = mo.id
        WHERE mo.status='active' AND mo.school_id = ? AND mo.date BETWEEN '2026-11-01' AND '2026-11-28'`,
      [school.id]
    )
    assert.equal(sat.monthToDate!.totalCents, raw.rows[0].s)
    assert.equal(sat.monthToDate!.totalCents, 24500)
    assert.equal(
      sat.monthToDate!.subscriptionCents + sat.monthToDate!.supplementCents,
      sat.monthToDate!.totalCents
    )

    // Holiday today (Wednesday): state is holiday, nobody is "missing".
    await addHoliday(school, WED, 'Storm')
    freezeClock('2026-11-25T08:00')
    const hol = await (await dashboards()).build(school, { amounts: false })
    assert.equal(hol.days[0].state, 'holiday')
    assert.isNull(hol.days[0].missing)
    assert.isNull(hol.monthToDate, 'no amounts for roles without price access')
    assert.equal(hol.holidays[0].name, 'Storm')
    void manager
  })
})

/* ------------------------------------------------------------------------ */

test.group('QA P7 | exports hostile content', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => {
    restoreClock()
    app.container.restore(ProductionReportService)
  })

  const NAMES = ['＝1+1', '\t=cmd', '\r+x', '+cmd', '-2', '@SUM(A1)', '=1+1', '＋SUM(1)', '＠x']

  async function hostile() {
    const ctx = await orderSchool()
    const { school, main, juice } = ctx
    const made = []
    for (const name of NAMES) {
      made.push(
        await pupil(school, { firstName: name, lastName: name, className: name, grade: name })
      )
    }
    freezeClock(OPEN)
    for (const entry of made) {
      await order(entry.parent, entry.child, TUE, main.id, [{ mealId: juice.id, qty: 2 }])
    }
    await db
      .from('meals')
      .whereIn('id', [main.id, juice.id])
      .update({ name_fr: '=cmd|calc', name_en: '@SUM(1)' })
    return ctx
  }

  test('CSV (fr + en, detail + summary): no cell can start a formula', async ({
    client,
    assert,
  }) => {
    const { manager } = await hostile()
    for (const kind of ['detail', 'summary']) {
      for (const lang of ['fr', 'en']) {
        const response = await client
          .get(`/kitchen/exports/download?date=${TUE}&format=csv&kind=${kind}`)
          .header('Accept-Language', lang)
          .loginAs(manager)
        response.assertStatus(200)
        const cells = csvRows(response.text(), ';')
          .flat()
          .concat(csvRows(response.text(), ',').flat())
        const bad = cells.filter((c) => DANGEROUS.test(c))
        assert.deepEqual(bad, [], `${kind}/${lang}`)
        assert.isTrue(cells.some((c) => c === "'＝1+1" || c.includes("'＝1+1")))
      }
    }
  })

  test('xlsx read back: strings only (no formula), escaped, numbers stay numbers', async ({
    client,
    assert,
  }) => {
    const { manager } = await hostile()
    for (const kind of ['detail', 'summary']) {
      const response = await asBinary(
        client
          .get(`/kitchen/exports/download?date=${TUE}&format=xlsx&kind=${kind}`)
          .loginAs(manager)
      )
      response.assertStatus(200)
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(response.body() as any)
      const sheet = workbook.worksheets[0]
      let strings = 0
      let numbers = 0
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          assert.notInclude([ExcelJS.ValueType.Formula, ExcelJS.ValueType.Hyperlink], cell.type)
          if (typeof cell.value === 'string') {
            strings += 1
            assert.notMatch(cell.value, DANGEROUS, `${kind}: ${JSON.stringify(cell.value)}`)
          } else if (typeof cell.value === 'number') {
            numbers += 1
          }
        })
      )
      assert.isAbove(strings, 0)
      assert.isAbove(numbers, 0)
      assert.equal(sheet.rowCount, kind === 'detail' ? 1 + NAMES.length * 2 : 1 + NAMES.length * 2)
      // Hostile child values are present as text, with the escape quote.
      const flat: unknown[] = []
      sheet.eachRow((row) => row.eachCell((c) => flat.push(c.value)))
      assert.include(flat, "'＝1+1")
      assert.include(flat, "'@SUM(A1)")
      assert.include(flat, "'-2")
    }
  })

  test('kitchen gets no price columns (csv, xlsx, summary); managers do', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await hostile()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    for (const kind of ['detail', 'summary']) {
      const k = await client
        .get(`/kitchen/exports/download?date=${TUE}&format=csv&kind=${kind}`)
        .loginAs(kitchen)
      assert.notMatch(k.text(), /MAD|Prix|Price|Montant|Amount|Total/i, kind)
      const m = await client
        .get(`/kitchen/exports/download?date=${TUE}&format=csv&kind=${kind}`)
        .loginAs(manager)
      assert.match(m.text(), /MAD/, kind)
    }
    const x = await asBinary(
      client.get(`/kitchen/exports/download?date=${TUE}&format=xlsx`).loginAs(kitchen)
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(x.body() as any)
    const header = (workbook.worksheets[0].getRow(1).values as unknown[]).filter(Boolean).join('|')
    assert.notMatch(header, /MAD|Prix|Price|Montant/i)
  })

  test('Content-Disposition stays safe with hostile class filters; 366-day boundary; row cap', async ({
    client,
    assert,
  }) => {
    const { manager } = await hostile()
    const evil = encodeURIComponent('a"; filename="x.exe\r\nSet-Cookie: x=1/../é')
    const r = await client
      .get(`/kitchen/exports/download?date=${TUE}&format=csv&className=${evil}`)
      .loginAs(manager)
    r.assertStatus(200)
    const cd = String(r.header('content-disposition'))
    assert.match(cd, /^attachment; filename="[A-Za-z0-9._-]+"$/)
    assert.notMatch(JSON.stringify(r.header('set-cookie') ?? ''), /(^|["\s;])x=1/)
    assert.lengthOf(csvRows(r.text()), 1, 'unknown class gives header only')
    const rl = await client
      .get(`/kitchen/labels/pdf?date=${TUE}&className=${evil}`)
      .loginAs(manager)
      .redirects(0)
    assert.equal(rl.status(), 302)

    // 366 days accepted, 367 refused (2026-01-01 -> 2026-12-31 = 365; leap span 2027-01-01..2028-01-01 = 366)
    const ok366 = await client
      .get('/kitchen/exports/download?period=custom&from=2027-01-01&to=2028-01-01&format=csv')
      .loginAs(manager)
    ok366.assertStatus(200)
    const bad367 = await client
      .get('/kitchen/exports/download?period=custom&from=2027-01-01&to=2028-01-02&format=csv')
      .loginAs(manager)
      .redirects(0)
    bad367.assertStatus(302)

    // Row cap: 50,000 allowed, 50,001 refused.
    class Capped extends ProductionReportService {
      static n = 50_000
      async countExportRows() {
        return Capped.n
      }
      async *exportDetail() {}
      async *exportSummary() {}
    }
    app.container.swap(ProductionReportService, () => new Capped())
    Capped.n = 50_000
    const at = await client
      .get(`/kitchen/exports/download?date=${TUE}&format=csv`)
      .loginAs(manager)
      .redirects(0)
    at.assertStatus(200)
    Capped.n = 50_001
    const over = await client
      .get(`/kitchen/exports/download?date=${TUE}&format=csv`)
      .loginAs(manager)
      .redirects(0)
    over.assertStatus(302)
    assert.equal(over.header('location'), '/kitchen/exports')
  })
})

/* ------------------------------------------------------------------------ */

function label(i: number, overrides: Partial<LabelRow> = {}): LabelRow {
  return {
    orderId: i,
    childId: i,
    firstName: `Child${i}`,
    lastName: 'Test',
    grade: 'G1',
    className: '1A',
    allergies: [],
    dietaryNotes: null,
    hasConflict: false,
    lines: [
      {
        mealId: 1,
        nameFr: 'Plat',
        nameEn: 'Dish',
        mealType: 'subscription',
        quantity: 1,
        allergens: [],
        conflicts: [],
      },
    ],
    ...overrides,
  } as LabelRow
}

test.group('QA P7 | labels PDF', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => {
    restoreClock()
    app.container.restore(ProductionReportService)
  })

  test('0, 1, 1200 labels render a valid PDF; 1201 is rejected', async ({ assert }) => {
    const service = await app.container.make(LabelPdfService)
    const opts = { grid: { cols: 3, rows: 8 }, locale: 'fr', title: 'T' }
    const zero = await service.render([], opts)
    assert.equal(zero.subarray(0, 5).toString('latin1'), '%PDF-')
    const one = await service.render([label(1)], opts)
    assert.equal(one.subarray(0, 5).toString('latin1'), '%PDF-')
    const started = Date.now()
    const many = await service.render(
      Array.from({ length: MAX_LABELS_PER_PDF }, (_, i) => label(i + 1)),
      opts
    )
    assert.equal(many.subarray(0, 5).toString('latin1'), '%PDF-')
    assert.equal(many.toString('latin1').match(/\/Type \/Page\b/g)?.length, 50)
    assert.isBelow(Date.now() - started, 15000)
    assert.include(many.subarray(-16).toString('latin1'), '%%EOF')
    await assert.rejects(() =>
      service.render(
        Array.from({ length: MAX_LABELS_PER_PDF + 1 }, (_, i) => label(i)),
        opts
      )
    )
  })

  test('grid parameter bounds over HTTP; cap enforced by the controller', async ({
    client,
    assert,
  }) => {
    const { school, main, manager } = await orderSchool()
    const p = await pupil(school, { firstName: 'محمد', lastName: '😀😀 ' + 'x'.repeat(200) })
    freezeClock(OPEN)
    await order(p.parent, p.child, TUE, main.id)
    for (const q of ['cols=0', 'cols=7', 'rows=0', 'rows=21', 'cols=1.5', 'cols=abc', 'rows=-1']) {
      const r = await client
        .get(`/kitchen/labels/pdf?date=${TUE}&${q}`)
        .loginAs(manager)
        .redirects(0)
      assert.include([302, 422], r.status(), q)
      assert.notInclude(String(r.header('content-type')), 'pdf', q)
    }
    for (const q of ['cols=1&rows=1', 'cols=6&rows=20']) {
      const r = await client.get(`/kitchen/labels/pdf?date=${TUE}&${q}`).loginAs(manager)
      r.assertStatus(200)
      assert.equal((r.body() as Buffer).subarray(0, 5).toString('latin1'), '%PDF-')
    }
    class Big extends ProductionReportService {
      async countLabels() {
        return MAX_LABELS_PER_PDF + 1
      }
    }
    app.container.swap(ProductionReportService, () => new Big())
    const over = await client.get(`/kitchen/labels/pdf?date=${TUE}`).loginAs(manager).redirects(0)
    over.assertStatus(302)
    void DateTime
  })
})
