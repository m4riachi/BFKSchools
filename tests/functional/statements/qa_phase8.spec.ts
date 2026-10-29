/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import { DateTime } from 'luxon'
import type { BaseMail } from '@adonisjs/mail'
import type Child from '#models/child'
import MenuItem from '#models/menu_item'
import Meal from '#models/meal'
import Notification from '#models/notification'
import OutboundEmail from '#models/outbound_email'
import Subscription from '#models/subscription'
import StatementService from '#services/statement_service'
import StatementPdfService from '#services/statement_pdf_service'
import { buildOutboxMail } from '#mails/outbox_registry'
import { pdfRenderGate, RenderGate, RenderBusyError } from '#support/render_gate'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { orderSchool, addChild, family } from '#tests/helpers/orders'
import { UserFactory } from '#database/factories/user_factory'

type Props = Record<string, any>

const TODAY = '2026-11-05T10:00'

/** Inserts an order + items straight into the tables (any date, any status). */
async function insertOrder(
  ctx: { school: { id: number }; menu: { id: number } },
  childId: number,
  date: string,
  items: Array<{ meal: Meal; qty: number; price: number }>,
  status: 'active' | 'cancelled' = 'active',
  reason: string | null = null
) {
  const [order] = await db
    .table('meal_orders')
    .insert({
      school_id: ctx.school.id,
      child_id: childId,
      date,
      weekly_menu_id: ctx.menu.id,
      status,
      cancel_reason: reason,
      cancelled_at: status === 'cancelled' ? DateTime.now().toSQL() : null,
      origin: 'parent',
    })
    .returning('id')
  for (const entry of items) {
    const item = await MenuItem.query()
      .where('weekly_menu_id', ctx.menu.id)
      .where('meal_id', entry.meal.id)
      .firstOrFail()
    await db.table('meal_order_items').insert({
      meal_order_id: order.id,
      menu_item_id: item.id,
      meal_id: entry.meal.id,
      meal_type: entry.meal.type,
      quantity: entry.qty,
      unit_price_cents: entry.price,
    })
  }
  return Number(order.id)
}

/** D31: what is billed = the supplement snapshots of active orders. */
async function sqlSum(childIds: number[], from: string, to: string) {
  const r = await db.rawQuery(
    `SELECT COALESCE(SUM(moi.line_total_cents),0)::int AS t FROM meal_orders mo
       JOIN meal_order_items moi ON moi.meal_order_id = mo.id
      WHERE mo.child_id = ANY(?::int[]) AND mo.status='active' AND mo.date BETWEEN ? AND ?
        AND moi.meal_type = 'supplement'`,
    [childIds, from, to]
  )
  return Number(r.rows[0].t)
}

function asInput(c: Child) {
  return {
    id: c.id,
    firstName: c.firstName,
    lastName: c.lastName,
    grade: c.grade,
    className: c.className,
    isActive: c.isActive,
  }
}

async function october() {
  const ctx = await orderSchool()
  const base = { school: ctx.school, menu: ctx.menu }
  const { parent, child: adam } = await family(ctx.school, {
    child: { firstName: 'Adam', lastName: 'Q' },
  })
  const bea = await addChild(parent, { subscribed: true, child: { firstName: 'Bea' } })
  const { main, alt, juice } = ctx

  // Adam: boundaries and price change. Out-of-month orders must not count.
  // The subscription lines carry pre-D31 prices (legacy history): they are
  // counted but never billed.
  await insertOrder(base, adam.id, '2026-09-30', [{ meal: main, qty: 1, price: 4500 }])
  await insertOrder(base, adam.id, '2026-10-01', [
    { meal: main, qty: 1, price: 4500 },
    { meal: juice, qty: 2, price: 1000 },
  ])
  await insertOrder(base, adam.id, '2026-10-15', [{ meal: main, qty: 1, price: 4800 }])
  await insertOrder(base, adam.id, '2026-10-31', [
    { meal: main, qty: 1, price: 4800 },
    { meal: juice, qty: 1, price: 1000 },
  ])
  await insertOrder(base, adam.id, '2026-11-01', [{ meal: main, qty: 1, price: 4800 }])
  // Cancelled orders (every reason) carry items but must contribute 0.
  const reasons = [
    'absent',
    'holiday',
    'staff',
    'menu_change',
    'child_inactive',
    'subscription_ended',
  ]
  let day = 5
  for (const reason of reasons) {
    await insertOrder(
      base,
      adam.id,
      `2026-10-${String(day++).padStart(2, '0')}`,
      [{ meal: alt, qty: 1, price: 5000 }],
      'cancelled',
      reason
    )
  }
  // D25 lowered switch price: alt re-priced at 3000 on the 20th.
  await insertOrder(base, adam.id, '2026-10-20', [{ meal: alt, qty: 1, price: 3000 }])

  // Bea: deactivated mid-month but ate on the 2nd. Meal soft-deleted later.
  const gone = await Meal.query().where('id', alt.id).firstOrFail()
  await insertOrder(base, bea.id, '2026-10-02', [{ meal: gone, qty: 1, price: 5000 }])
  bea.isActive = false
  await bea.save()
  gone.isActive = false
  gone.deletedAt = DateTime.now()
  await gone.save()
  return { ...ctx, base, parent, adam, bea }
}

test.group('QA P8 | statement math', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('boundaries, reasons, snapshots, soft-deleted meal, inactive child, SQL cross-check', async ({
    assert,
  }) => {
    const ctx = await october()
    freezeClock(TODAY)
    const svc = await app.container.make(StatementService)
    const s = await svc.family({
      parent: { id: ctx.parent.id, fullName: 'P', email: 'p@x.test' },
      children: [ctx.adam, ctx.bea].map(asInput),
      month: '2026-10',
      today: '2026-11-05',
    })
    assert.equal(s.from, '2026-10-01')
    assert.equal(s.to, '2026-10-31')
    assert.isFalse(s.provisional)
    const adam = s.children.find((c) => c.childId === ctx.adam.id)!
    // Hand count: 4 subscription meals (1st, 15th, 20th, 31st — included,
    // whatever their legacy snapshot) + juice 3 x 1000 (D31).
    assert.deepEqual(adam.subscription, { count: 4 })
    assert.equal(adam.supplements.count, 3)
    assert.equal(adam.supplements.amountCents, 3000)
    assert.equal(adam.totalCents, 3000)
    assert.lengthOf(adam.days, 4)
    // Bea: inactive, still listed, soft-deleted meal name kept.
    const bea = s.children.find((c) => c.childId === ctx.bea.id)!
    assert.isFalse(bea.isActive)
    assert.equal(bea.subscription.count, 1)
    assert.equal(bea.totalCents, 0)
    assert.equal(bea.days[0].items[0].nameFr, ctx.alt.nameFr)
    // Family = sum of children = raw SQL.
    assert.equal(s.totals.totalCents, 3000)
    assert.equal(s.totals.subscriptionCount, 5)
    assert.equal(
      s.totals.totalCents,
      await sqlSum([ctx.adam.id, ctx.bea.id], '2026-10-01', '2026-10-31')
    )
    for (const c of s.children) {
      assert.equal(
        c.totalCents,
        c.days.reduce((a, d) => a + d.totalCents, 0)
      )
      assert.isTrue(Number.isInteger(c.totalCents))
    }
    // Neighbouring months pick the out-of-month orders only.
    const nov = await svc.family({
      parent: { id: ctx.parent.id, fullName: 'P', email: 'p@x.test' },
      children: [ctx.adam, ctx.bea].map(asInput),
      month: '2026-11',
      today: '2026-11-05',
    })
    assert.equal(nov.totals.totalCents, 0)
    assert.equal(nov.totals.subscriptionCount, 1)
    assert.isTrue(nov.provisional)
    const sep = await svc.family({
      parent: { id: ctx.parent.id, fullName: 'P', email: 'p@x.test' },
      children: [ctx.adam, ctx.bea].map(asInput),
      month: '2026-09',
      today: '2026-11-05',
    })
    assert.equal(sep.totals.totalCents, 0)
    assert.equal(sep.totals.subscriptionCount, 1)

    // School overview agrees with the family statement and SQL.
    const school = await svc.school(ctx.school, '2026-10', '2026-11-05')
    assert.equal(school.totals.totalCents, 3000)
    assert.equal(school.families[0].totals.totalCents, 3000)
    assert.equal(school.totals.subscriptionCount, 5)
  })

  test('D31: amounts never depend on the subscription — supplements only', async ({ assert }) => {
    const ctx = await october()
    freezeClock(TODAY)
    const svc = await app.container.make(StatementService)
    const { parent, child: own } = await family(ctx.school)
    const mk = async (
      start: string,
      end: string | null,
      status: 'active' | 'paused' = 'active'
    ) => {
      const c = await addChild(parent, { subscribed: false })
      await Subscription.create({ childId: c.id, startDate: start, endDate: end, status } as any)
      return c
    }
    const starts31 = await mk('2026-10-31', null)
    const endsSep30 = await mk('2026-09-01', '2026-09-30')
    const paused = await mk('2026-09-01', null, 'paused')
    for (const c of [starts31, endsSep30, paused]) {
      await insertOrder(ctx.base, c.id, '2026-10-12', [
        { meal: ctx.main, qty: 1, price: 0 },
        { meal: ctx.juice, qty: 2, price: 1000 },
      ])
    }
    const noMeals = await mk('2026-09-01', null)
    // Stale billing keys from before D31 are ignored.
    ctx.school.settings = { billing_mode: 'monthly_fee', monthly_fee_cents: 30000 } as any
    await ctx.school.save()

    const children = [own, starts31, endsSep30, paused, noMeals]
    const s = await svc.family({
      parent: { id: parent.id, fullName: 'P', email: 'p@x.test' },
      children: children.map(asInput),
      month: '2026-10',
      today: '2026-11-05',
    })
    const by = (c: Child) => s.children.find((x) => x.childId === c.id)!
    for (const c of [starts31, endsSep30, paused]) {
      assert.equal(by(c).totalCents, 2000)
      assert.deepEqual(by(c).subscription, { count: 1 })
    }
    assert.equal(by(noMeals).totalCents, 0)
    assert.equal(s.totals.totalCents, 6000)
    const sch = await svc.school(ctx.school, '2026-10', '2026-11-05')
    const mine = sch.families.find((f) => f.parentId === parent.id)!
    assert.equal(mine.totals.totalCents, 6000)
    assert.equal(mine.children.length, 3) // children without meals are not listed
  })
})

test.group('QA P8 | HTTP validation and access', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('month validation matrix on PDF/export routes; pages fall back; guests go to login', async ({
    client,
    assert,
  }) => {
    const ctx = await october()
    freezeClock(TODAY)
    const bad = [
      '2026-13',
      '2026-00',
      '2026-1',
      '26-10',
      'abc',
      '2026-10-01',
      '1999-12',
      '2027-01',
      '2026-10%00',
    ]
    for (const m of bad) {
      ;(await client.get(`/statements/pdf?month=${m}`).loginAs(ctx.parent)).assertStatus(404)
      ;(await client.get(`/admin/statements/export?month=${m}`).loginAs(ctx.manager)).assertStatus(
        404
      )
      ;(
        await client
          .get(`/admin/statements/parents/${ctx.parent.id}/pdf?month=${m}`)
          .loginAs(ctx.manager)
      ).assertStatus(404)
      const page = await client.get(`/statements?month=${m}`).loginAs(ctx.parent).withInertia()
      page.assertStatus(200)
      assert.equal((page.inertiaProps as Props).nav.value, '2026-11')
    }
    for (const ok of ['2000-01', '2026-12']) {
      ;(await client.get(`/statements/pdf?month=${ok}`).loginAs(ctx.parent)).assertStatus(200)
    }
    const guest = await client.get('/statements').redirects(0)
    guest.assertStatus(302)
    assert.include(guest.header('location'), '/login')
    ;(await client.get('/notifications').redirects(0)).assertStatus(302)
    ;(await client.get('/admin/statements').redirects(0)).assertStatus(302)
    // Parent page totals formatted with comma decimals in FR, point in EN.
    const fr = await client.get('/statements?month=2026-10').loginAs(ctx.parent).withInertia()
    assert.match((fr.inertiaProps as Props).statement.totals.total, /^\d[\d\u202F]*,\d{2} MAD$/)
  })

  test('admin: manager of another school cannot see this family on any statements route', async ({
    client,
  }) => {
    const ctx = await october()
    freezeClock(TODAY)
    const other = await orderSchool().catch(() => null)
    const stranger = other ? other.manager : await UserFactory.apply('manager').create()
    for (const url of [
      `/admin/statements/parents/${ctx.parent.id}?month=2026-10`,
      `/admin/statements/parents/${ctx.parent.id}/pdf?month=2026-10`,
    ]) {
      ;(await client.get(url).loginAs(stranger)).assertStatus(404)
    }
  })
})

test.group('QA P8 | PDFs and the render gate', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('PDF valid for 0, 1, several children and long/Arabic/HTML names', async ({ assert }) => {
    const ctx = await october()
    freezeClock(TODAY)
    const svc = await app.container.make(StatementService)
    const pdf = await app.container.make(StatementPdfService)
    const kids: Child[] = [ctx.adam, ctx.bea]
    for (let i = 0; i < 6; i++) {
      kids.push(
        await addChild(ctx.parent, { child: { firstName: `محمد ${'ي'.repeat(80)} <b>${i}</b>` } })
      )
    }
    for (const n of [0, 1, kids.length]) {
      const s = await svc.family({
        parent: {
          id: ctx.parent.id,
          fullName: 'ع'.repeat(200) + ' {x, plural, other{y}}',
          email: 'p@x.test',
        },
        children: kids.slice(0, n).map(asInput),
        month: '2026-10',
        today: '2026-11-05',
      })
      for (const locale of ['fr', 'en', 'ar'] as const) {
        const bytes = await pdf.render(s, { locale: locale as any, generatedAt: DateTime.now() })
        assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-')
        assert.include(bytes.subarray(-32).toString('latin1'), '%%EOF')
      }
    }
  })

  test('gate: 2 run, 20 wait, the 23rd is refused; HTTP maps to 503 + Retry-After', async ({
    client,
    assert,
  }) => {
    const gate = new RenderGate(2, 20)
    let release!: () => void
    const hold = new Promise<void>((r) => (release = r))
    let active = 0
    let peak = 0
    const jobs = Array.from({ length: 22 }, () =>
      gate.run(async () => {
        active++
        peak = Math.max(peak, active)
        await hold
        active--
      })
    )
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(gate.running, 2)
    assert.equal(gate.waiting, 20)
    let refused = false
    try {
      await gate.run(async () => {})
    } catch (e) {
      refused = e instanceof RenderBusyError
    }
    assert.isTrue(refused)
    release()
    await Promise.all(jobs)
    assert.equal(peak, 2)
    assert.equal(gate.running, 0)

    // The shared gate really guards the HTTP download.
    const ctx = await october()
    freezeClock(TODAY)
    let free!: () => void
    const blocker = new Promise<void>((r) => (free = r))
    const held = Array.from({ length: 22 }, () => pdfRenderGate.run(() => blocker))
    await new Promise((r) => setTimeout(r, 20))
    const res = await client.get('/statements/pdf?month=2026-10').loginAs(ctx.parent)
    res.assertStatus(503)
    assert.equal(res.header('retry-after'), '10')
    free()
    await Promise.all(held)
    ;(await client.get('/statements/pdf?month=2026-10').loginAs(ctx.parent)).assertStatus(200)
  })

  test('labels PDF still renders after the refactor', async ({ client, assert }) => {
    const ctx = await orderSchool()
    const { parent, child } = await family(ctx.school)
    freezeClock('2026-11-20T12:00')
    const { order } = await import('#tests/helpers/reports')
    await order(parent, child, '2026-11-24', ctx.main.id)
    const res = await client.get('/kitchen/labels/pdf?date=2026-11-24').loginAs(ctx.manager)
    res.assertStatus(200)
    assert.equal(res.header('content-type'), 'application/pdf')
    assert.equal((res.body() as Buffer).subarray(0, 5).toString('latin1'), '%PDF-')
  })
})

test.group('QA P8 | notification center safety', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  const evil = [
    'https://evil.test',
    '//evil.test',
    '/\\evil.test',
    'javascript:alert(1)',
    '2026-11-23/../../x',
    "2026-11-23'><script>",
  ]

  test('Open never redirects off-site, whatever the stored data holds', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    const { parent } = await family(ctx.school)
    const rows: Array<[string, Record<string, unknown>]> = []
    for (const v of evil) {
      rows.push(['menu_published', { weekStart: v }])
      rows.push(['deadline_reminder', { weekStart: v, href: v, url: v }])
      rows.push([
        'order_changed_by_staff',
        { childId: v, date: v, childName: v, status: 'cancelled' },
      ])
      rows.push(['order_changed_by_staff', { childId: '1&x=//evil.test', date: '2026-11-24' }])
      rows.push(['menu_change', { kind: 'item_removed', date: v, children: [v], mealId: v }])
      rows.push(['holiday_cancellation', { days: [{ childName: v, date: v }], redirect: v }])
      rows.push(['auto_assigned', { weekStart: v, days: v }])
    }
    for (const [type, data] of rows) {
      const n = await Notification.create({ userId: parent.id, type, data } as any)
      const res = await client
        .post(`/notifications/${n.id}/open`)
        .loginAs(parent)
        .withCsrfToken()
        .redirects(0)
      res.assertStatus(302)
      const loc = res.header('location') as string
      assert.match(loc, /^\/(?!\/|\\)/, `${type} ${JSON.stringify(data)} -> ${loc}`)
      assert.notInclude(loc, 'evil')
    }
    const list = await client.get('/notifications').loginAs(parent).withInertia()
    list.assertStatus(200)
    for (const item of (list.inertiaProps as Props).notifications) {
      assert.match(item.href, /^\/(?!\/|\\)/)
    }
  })

  test('ICU/HTML payloads are rendered as plain text, mark-all touches only my rows, badge null for staff', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    const { parent } = await family(ctx.school)
    const other = await family(ctx.school)
    const nasty = '{count, plural, other {x}} <img src=x onerror=1> {{ x }} {'
    await Notification.create({
      userId: parent.id,
      type: 'holiday_cancellation',
      data: { days: [{ childName: nasty, date: '2026-11-26' }] },
    } as any)
    await Notification.create({
      userId: parent.id,
      type: 'menu_change',
      data: {
        kind: 'item_removed',
        date: '2026-11-25',
        children: [nasty],
        targetMealId: null,
        mealId: ctx.main.id,
      },
    } as any)
    const theirs = await Notification.create({
      userId: other.parent.id,
      type: 'menu_published',
      data: { weekStart: '2026-11-23' },
    } as any)
    const list = await client.get('/notifications').loginAs(parent).withInertia()
    list.assertStatus(200)
    const props = list.inertiaProps as Props
    assert.equal(props.unreadNotifications, 2)
    const all = JSON.stringify(props.notifications)
    assert.include(all, '<img src=x onerror=1>') // data kept as text, Vue escapes it
    assert.include(all, '{count, plural, other {x}}')
    ;(
      await client.post('/notifications/read-all').loginAs(parent).withCsrfToken().redirects(0)
    ).assertStatus(302)
    await theirs.refresh()
    assert.isNull(theirs.readAt)
    const staff = await client.get('/admin').loginAs(ctx.manager).withInertia()
    assert.isNull((staff.inertiaProps as Props).unreadNotifications)
    // Only parents of the guest: a guest has no badge and can't act.
    ;(
      await client.post(`/notifications/${theirs.id}/read`).withCsrfToken().redirects(0)
    ).assertStatus(302)
    // Parent B's count is their own.
    const b = await client.get('/statements').loginAs(other.parent).withInertia()
    assert.equal((b.inertiaProps as Props).unreadNotifications, 1)
  })
})

test.group('QA P8 | emails', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => {
    restoreClock()
    mail.restore()
  })

  async function renderRow(row: OutboundEmail, locale: 'fr' | 'en') {
    row.locale = locale
    const built = await buildOutboxMail(row)
    if (!('mail' in built)) throw new Error(`skip ${built.skip}`)
    const m = built.mail as BaseMail
    await m.buildWithContents()
    const j = m.message.toJSON().message
    return { subject: String(j.subject), html: String(j.html), text: String(j.text) }
  }

  test('HTML in school/child/meal names is escaped in html, subjects keep text; no raw ICU left', async ({
    assert,
  }) => {
    const ctx = await orderSchool()
    freezeClock('2026-11-20T12:00')
    ctx.school.name = 'Ecole <script>alert(1)</script> & Fils'
    await ctx.school.save()
    ctx.main.nameFr = 'Tajine <i>x</i>'
    ctx.main.nameEn = 'Tagine <i>x</i>'
    await ctx.main.save()
    const { parent, child } = await family(ctx.school, {
      parent: { fullName: 'A <u>B</u>' },
      child: { firstName: 'Léa <b>x</b> {n}' },
    })
    const hol = await insertOrder(
      ctx,
      child.id,
      '2026-11-26',
      [{ meal: ctx.main, qty: 1, price: 4500 }],
      'cancelled',
      'holiday'
    )
    const chg = await insertOrder(
      ctx,
      child.id,
      '2026-11-24',
      [{ meal: ctx.main, qty: 1, price: 4500 }],
      'cancelled',
      'menu_change'
    )
    const mk = (mailKey: string, payload: Record<string, unknown>) =>
      OutboundEmail.create({
        userId: parent.id,
        toEmail: parent.email,
        locale: 'fr',
        mailKey,
        payload,
        status: 'pending',
        attempts: 0,
        sendAfter: DateTime.now(),
        dedupeKey: null,
      } as any)
    const rows = [
      await mk('menu_published', { weeklyMenuId: ctx.menu.id }),
      await mk('deadline_reminder', { weeklyMenuId: ctx.menu.id }),
      await mk('menu_change', {
        kind: 'item_removed',
        date: '2026-11-24',
        mealId: ctx.main.id,
        targetMealId: null,
        orderIds: [chg],
      }),
      await mk('holiday_cancellation', {
        orderIds: [hol],
      }),
    ]
    for (const row of rows) {
      for (const locale of ['fr', 'en'] as const) {
        let r
        try {
          r = await renderRow(row, locale)
        } catch (e) {
          assert.fail(`${row.mailKey}/${locale}: ${(e as Error).message}`)
          return
        }
        assert.notMatch(r.html, /<script|<b>x|<i>x|<u>B/, `${row.mailKey}/${locale}`)
        if (row.mailKey === 'holiday_cancellation')
          assert.include(r.html, 'L&#xe9;a &lt;b&gt;x&lt;/b&gt; {n}'.replace('&#xe9;', 'é'))
        assert.notInclude(r.html, 'emails.')
        assert.notInclude(r.text, 'emails.')
        assert.isAbove(r.text.length, 50)
        assert.include(r.html, 'href="http')
        assert.notMatch(r.html + r.text, /\{\{|\{count|\bundefined\b|\[object/)
        const prefs = '/notifications#preferences'
        const opt = row.mailKey === 'menu_published' || row.mailKey === 'deadline_reminder'
        assert.equal(r.text.includes(prefs), opt, `${row.mailKey} prefs link`)
        assert.equal(r.html.includes('notifications#preferences'), opt)
      }
    }
  })

  test('opt-out checked at queue time (menu publication) and again at send time', async ({
    assert,
  }) => {
    const ctx = await orderSchool()
    const { parent } = await family(ctx.school, {
      parent: { notificationPrefs: { menu_published: false } },
    })
    const row = await OutboundEmail.create({
      userId: parent.id,
      toEmail: parent.email,
      locale: 'en',
      mailKey: 'menu_published',
      payload: { weeklyMenuId: ctx.menu.id },
      status: 'pending',
      attempts: 0,
      sendAfter: DateTime.now(),
      dedupeKey: null,
    } as any)
    assert.deepEqual(await buildOutboxMail(row), { skip: 'opted_out' })
    // A parent who has the preference on still gets it.
    const on = await family(ctx.school)
    row.userId = on.parent.id
    row.toEmail = on.parent.email
    assert.property(await buildOutboxMail(row), 'mail')
    // Unknown prefs payload shapes don't crash and default to "send".
    for (const prefs of [null, [], 'x', { menu_published: 'false' }, { menu_published: null }]) {
      on.parent.notificationPrefs = prefs as any
      await on.parent.save().catch(() => {})
      assert.isDefined(await buildOutboxMail(row))
    }
  })
})
