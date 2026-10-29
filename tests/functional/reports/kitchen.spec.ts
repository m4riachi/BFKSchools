import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import ExcelJS from 'exceljs'
import MealOrder from '#models/meal_order'
import { UserFactory } from '#database/factories/user_factory'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { MON, TUE, WED, orderSchool } from '#tests/helpers/orders'
import { asBinary, csvRows, order, pupil } from '#tests/helpers/reports'

const OPEN = '2026-11-20T12:00'

type Props = Record<string, any>

/** Every route of the router whose pattern matches, params filled with `1`. */
function routes(filter: (pattern: string, method: string) => boolean) {
  const list: { method: string; url: string; pattern: string }[] = []
  for (const group of Object.values(router.toJSON())) {
    for (const route of group) {
      for (const method of route.methods) {
        if (method === 'HEAD' || !filter(route.pattern, method)) continue
        const uuid = '00000000-0000-4000-8000-000000000000'
        const url = route.pattern
          .replace(/(imports\/families|holidays\/import)\/:id/, `$1/${uuid}`)
          .replace(/:week/g, '2026-11-23')
          .replace(/:date/g, '2026-11-24')
          .replace(/:groupId/g, uuid)
          .replace(/:\w+/g, '1')
        list.push({ method, url, pattern: route.pattern })
      }
    }
  }
  return list
}

/**
 * Tuesday 24 Nov: three pupils in two classes, with hostile names (formula
 * injection), an Arabic name and an emoji; Monday: one more order.
 */
async function seed() {
  const ctx = await orderSchool()
  const { school, main, alt, juice } = ctx
  const evil = await pupil(school, {
    firstName: '=1+1',
    lastName: '@SUM(A1:A2)',
    className: '=HYPERLINK("http://x")',
    grade: '-2+3',
  })
  const arabic = await pupil(school, {
    firstName: 'محمد',
    lastName: 'العلوي 🍕',
    className: '3B',
    allergies: ['milk'],
  })
  const plain = await pupil(school, { firstName: 'Lina', lastName: 'Haddad', className: '3B' })
  freezeClock(OPEN)
  await order(evil.parent, evil.child, TUE, main.id, [{ mealId: juice.id, qty: 2 }])
  await order(arabic.parent, arabic.child, TUE, alt.id)
  await order(plain.parent, plain.child, TUE, main.id)
  await order(plain.parent, plain.child, MON, main.id)
  // Meal names are typed by staff too.
  juice.nameFr = '+Jus "maison", frais'
  await juice.save()
  return { ...ctx, evil, arabic, plain }
}

test.group('Reports | kitchen area', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => limiter.clear())
  group.each.teardown(() => restoreClock())

  test('the kitchen area has GET routes only; kitchen reads every page', async ({
    client,
    assert,
  }) => {
    const { school } = await seed()
    const kitchenRoutes = routes((pattern) => pattern.startsWith('/kitchen'))
    assert.isAbove(kitchenRoutes.length, 5)
    assert.isTrue(
      kitchenRoutes.every((route) => route.method === 'GET'),
      'no write route in the kitchen area'
    )
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    for (const path of ['/kitchen', '/kitchen/allergies', '/kitchen/labels', '/kitchen/exports']) {
      const response = await client.get(`${path}?date=${TUE}`).loginAs(kitchen).withInertia()
      response.assertStatus(200)
    }
    const production = await client.get(`/kitchen?date=${TUE}`).loginAs(kitchen).withInertia()
    const sheet = (production.inertiaProps as Props).sheet
    assert.equal(sheet.totals.subscription.total, 3)
    assert.equal(sheet.totals.supplement.total, 2)
    assert.isFalse((production.inertiaProps as Props).day.final) // before the deadline
  })

  test('kitchen cannot change anything: every write route of the app answers 403', async ({
    client,
    assert,
  }) => {
    const { school } = await seed()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const writes = routes(
      (pattern, method) =>
        method !== 'GET' && (pattern.startsWith('/admin') || pattern.startsWith('/orders'))
    )
    assert.isAbove(writes.length, 30)
    const before = await MealOrder.query().orderBy('id')
    for (const route of writes) {
      const response = await client[route.method.toLowerCase() as 'post']?.(route.url)
        .loginAs(kitchen)
        .withCsrfToken()
        .header('Accept', 'application/json')
        .json({ reason: 'x', subscriptionMealId: 1, name: 'x' })
        .redirects(0)
      assert.equal(response.status(), 403, `${route.method} ${route.url}`)
    }
    const after = await MealOrder.query().orderBy('id')
    assert.deepEqual(
      after.map((o) => [o.id, o.status, o.updatedAt.toMillis()]),
      before.map((o) => [o.id, o.status, o.updatedAt.toMillis()])
    )
  })

  test('parents and guests get nothing from the kitchen area', async ({ client, assert }) => {
    const { evil } = await seed()
    const pages = routes((pattern) => pattern.startsWith('/kitchen'))
    for (const route of pages) {
      const url = route.url.replace('/meals/1', '/meals/1')
      const asParent = await client.get(`${url}?date=${TUE}`).loginAs(evil.parent).redirects(0)
      assert.equal(asParent.status(), 403, url)
      assert.notInclude(asParent.text(), '%PDF')
      const asGuest = await client.get(`${url}?date=${TUE}`).redirects(0)
      assert.match(String(asGuest.header('location')), /^\/login\b/, url)
    }
  })

  test('labels PDF: A4, one label per active order, grid from settings or query', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await seed()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const response = await client.get(`/kitchen/labels/pdf?date=${TUE}`).loginAs(kitchen)
    response.assertStatus(200)
    assert.equal(response.header('content-type'), 'application/pdf')
    assert.equal(
      response.header('content-disposition'),
      `attachment; filename="bfk-labels-${TUE}.pdf"`
    )
    const pdf = response.body() as Buffer
    assert.isTrue(Buffer.isBuffer(pdf))
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
    const text = pdf.toString('latin1')
    assert.match(text, /\/MediaBox \[0 0 595\.28 841\.89\]/)
    assert.equal(text.match(/\/Type \/Page\b/g)?.length, 1) // 3 labels, 24 per page

    // A 1 × 2 grid → 2 pages for 3 labels; a class filter → 2 labels.
    const small = await client.get(`/kitchen/labels/pdf?date=${TUE}&cols=1&rows=2`).loginAs(manager)
    assert.equal((small.body() as Buffer).toString('latin1').match(/\/Type \/Page\b/g)?.length, 2)
    const oneClass = await client
      .get(`/kitchen/labels/pdf?date=${TUE}&cols=1&rows=1&className=3B`)
      .loginAs(manager)
    assert.equal(
      (oneClass.body() as Buffer).toString('latin1').match(/\/Type \/Page\b/g)?.length,
      2
    )
    assert.equal(
      oneClass.header('content-disposition'),
      `attachment; filename="bfk-labels-${TUE}-3B.pdf"`
    )

    // Out-of-range grids are refused; a day without orders redirects with a message.
    const bad = await client
      .get(`/kitchen/labels/pdf?date=${TUE}&cols=40`)
      .loginAs(kitchen)
      .redirects(0)
    assert.notEqual(bad.status(), 200)
    const empty = await client.get(`/kitchen/labels/pdf?date=${WED}`).loginAs(kitchen).redirects(0)
    empty.assertStatus(302)
    assert.match(String(empty.header('location')), /^\/kitchen\/labels\?date=2026-11-25/)
  })

  test('labels page: count, preview sorted by class then name', async ({ client, assert }) => {
    const { school, arabic, plain, evil } = await seed()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const response = await client.get(`/kitchen/labels?date=${TUE}`).loginAs(kitchen).withInertia()
    const props = response.inertiaProps as Props
    assert.equal(props.count, 3)
    assert.deepEqual(props.grid, { cols: 3, rows: 8 })
    // '3B' < '=HYPERLINK…' in the database collation? Sorted by class then last name.
    const names = (props.preview as Props[]).map((label) => label.name)
    assert.sameMembers(names, [
      `${arabic.child.firstName} ${arabic.child.lastName}`,
      `${plain.child.firstName} ${plain.child.lastName}`,
      `${evil.child.firstName} ${evil.child.lastName}`,
    ])
    const threeB = names.filter((name) => name !== `${evil.child.firstName} ${evil.child.lastName}`)
    // Same class: "Haddad" before "العلوي…" (by last name).
    assert.deepEqual(threeB, [
      `${plain.child.firstName} ${plain.child.lastName}`,
      `${arabic.child.firstName} ${arabic.child.lastName}`,
    ])
  })

  test('CSV export: one row per order line, filters, formula injection escaped', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await seed()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const response = await client
      .get(`/kitchen/exports/download?period=day&date=${TUE}&format=csv&kind=detail`)
      .loginAs(kitchen)
    response.assertStatus(200)
    assert.match(String(response.header('content-type')), /^text\/csv/)
    assert.equal(
      response.header('content-disposition'),
      `attachment; filename="bfk-orders-${TUE}.csv"`
    )
    const rows = csvRows(response.text())
    const [header, ...lines] = rows
    assert.lengthOf(lines, 4) // evil: main + juice, arabic: alt, plain: main
    assert.equal(response.header('x-export-rows'), '4')
    assert.notInclude(header, 'Prix unitaire (MAD)', 'no prices for the kitchen')
    assert.include(header, 'Allergies')

    // Every hostile value is neutralized with a leading quote.
    const cells = lines.flat()
    for (const value of [
      '=1+1',
      '@SUM(A1:A2)',
      '=HYPERLINK("http://x")',
      '-2+3',
      '+Jus "maison", frais',
    ]) {
      assert.include(cells, `'${value}`, value)
      assert.notInclude(cells, value, value)
    }
    assert.isTrue(
      cells.every((cell) => !/^[=+\-@\t\r]/.test(cell)),
      'no cell starts with = + - @'
    )
    assert.include(cells, 'محمد')

    // Staff get the price columns; filters narrow the rows.
    const staff = await client
      .get(`/kitchen/exports/download?period=week&date=${TUE}&format=csv&kind=detail`)
      .loginAs(manager)
    const staffRows = csvRows(staff.text())
    assert.include(staffRows[0], 'Prix unitaire (MAD)')
    assert.lengthOf(staffRows, 1 + 5) // + Monday's order
    // D31: subscription rows have no amount; extras carry their snapshot price.
    const priceColumn = staffRows[0].indexOf('Prix unitaire (MAD)')
    assert.equal(staffRows[1][priceColumn], '') // Monday main: included
    assert.isTrue(staffRows.some((row) => row[priceColumn] === '10,00'))

    const supplements = await client
      .get(
        `/kitchen/exports/download?period=day&date=${TUE}&format=csv&kind=detail&mealType=supplement`
      )
      .loginAs(kitchen)
    assert.lengthOf(csvRows(supplements.text()), 1 + 1)
    const threeB = await client
      .get(`/kitchen/exports/download?period=day&date=${TUE}&format=csv&className=3B`)
      .loginAs(kitchen)
    assert.lengthOf(csvRows(threeB.text()), 1 + 2)

    const summary = await client
      .get(`/kitchen/exports/download?period=month&date=${TUE}&format=csv&kind=summary`)
      .loginAs(kitchen)
    // (date, meal, grade, class): Mon main/3B, Tue main/3B, Tue main/evil, Tue alt/3B, Tue juice/evil
    assert.lengthOf(csvRows(summary.text()), 1 + 5)
  })

  test('Excel export: valid workbook, row counts, text cells, no formulas', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await seed()
    const response = await asBinary(
      client
        .get(`/kitchen/exports/download?period=week&date=${TUE}&format=xlsx&kind=detail`)
        .loginAs(manager)
    )
    response.assertStatus(200)
    assert.equal(
      response.header('content-type'),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
    assert.equal(
      response.header('content-disposition'),
      `attachment; filename="bfk-orders-2026-11-23_2026-11-29.xlsx"`
    )
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(response.body() as unknown as Parameters<typeof workbook.xlsx.load>[0])
    const sheet = workbook.worksheets[0]
    assert.equal(sheet.rowCount, 1 + 5)
    const values: unknown[] = []
    sheet.eachRow((row) =>
      row.eachCell((cell) => {
        assert.notEqual(cell.type, ExcelJS.ValueType.Formula)
        values.push(cell.value)
      })
    )
    assert.include(values, "'=1+1")
    assert.include(values, "'@SUM(A1:A2)")
    assert.include(values, 10) // the extra's unit price as a number (MAD)
    assert.notInclude(values, 45)
    assert.include(values, 'Prix unitaire (MAD)')
    assert.equal(school.id > 0, true)
  })

  test('export limits: range too long, bad dates and invalid filters are refused', async ({
    client,
    assert,
  }) => {
    const { school } = await seed()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    for (const query of [
      'period=custom&from=2026-01-01&to=2027-06-30', // > 366 days
      'period=custom&from=2026-11-30&to=2026-11-01', // reversed
      'period=day&date=1900-01-01', // outside the supported window
      'period=day&date=2026-02-30',
      'period=day&mealType=dessert',
      'period=day&format=pdf',
    ]) {
      const response = await client
        .get(`/kitchen/exports/download?${query}`)
        .loginAs(kitchen)
        .redirects(0)
      response.assertStatus(302)
      assert.equal(response.header('location'), '/kitchen/exports', query)
    }
    const ok = await client
      .get('/kitchen/exports/download?period=custom&from=2026-01-01&to=2026-12-31&format=csv')
      .loginAs(kitchen)
    ok.assertStatus(200)
  })

  test('school isolation: another school’s kitchen sees none of these orders', async ({
    client,
    assert,
  }) => {
    const other = await orderSchool()
    await seed()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: other.school.id }).create()
    const production = await client.get(`/kitchen?date=${TUE}`).loginAs(kitchen).withInertia()
    assert.lengthOf((production.inertiaProps as Props).sheet.lines, 0)
    const allergies = await client
      .get(`/kitchen/allergies?date=${TUE}`)
      .loginAs(kitchen)
      .withInertia()
    assert.lengthOf((allergies.inertiaProps as Props).rows, 0)
    const csv = await client
      .get(`/kitchen/exports/download?period=month&date=${TUE}&format=csv`)
      .loginAs(kitchen)
    assert.lengthOf(csvRows(csv.text()), 1)
    const pdf = await client.get(`/kitchen/labels/pdf?date=${TUE}`).loginAs(kitchen).redirects(0)
    pdf.assertStatus(302) // nothing to print for this school

    // A kitchen user without a school: empty pages, downloads refused.
    const loner = await UserFactory.apply('kitchen').create()
    const page = await client.get('/kitchen').loginAs(loner).withInertia()
    page.assertStatus(200)
    assert.isNull((page.inertiaProps as Props).sheet)
    const download = await client
      .get(`/kitchen/exports/download?date=${TUE}&format=csv`)
      .loginAs(loner)
      .redirects(0)
    download.assertStatus(403)
  })

  test('downloads are rate-limited per user (30 / min), pages are not', async ({
    client,
    assert,
  }) => {
    const { school } = await orderSchool()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const url = `/kitchen/exports/download?date=${TUE}&format=csv`
    for (let index = 0; index < 30; index += 1) {
      const response = await client.get(url).loginAs(kitchen)
      assert.equal(response.status(), 200, `download ${index + 1}`)
    }
    const blocked = await client.get(url).loginAs(kitchen).redirects(0)
    blocked.assertStatus(429)
    const page = await client.get('/kitchen').loginAs(kitchen).withInertia()
    page.assertStatus(200)
    // Another user is not affected.
    const other = await UserFactory.apply('kitchen').merge({ schoolId: school.id }).create()
    const response = await client.get(url).loginAs(other)
    response.assertStatus(200)
  })
})
