/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import mail from '@adonisjs/mail/services/main'
import { DateTime } from 'luxon'
import type { BaseMail } from '@adonisjs/mail'
import OutboundEmail from '#models/outbound_email'
import Notification from '#models/notification'
import MealOrder from '#models/meal_order'
import AccountLinkService from '#services/account_link_service'
import HolidayImpactService from '#services/holiday_impact_service'
import AccountLinkMail from '#mails/account_link_mail'
import MenuPublishedMail from '#mails/menu_published_mail'
import { buildOutboxMail } from '#mails/outbox_registry'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { addHoliday, outbox } from '#tests/helpers/menus'
import { MON, TUE, THU, family, orderSchool, orders } from '#tests/helpers/orders'
import { order } from '#tests/helpers/reports'
import env from '#start/env'

const OPEN = '2026-11-20T12:00'
const APP = env.get('APP_URL').replace(/\/$/, '')

type Rendered = { subject: string; html: string; text: string }

async function render(message: BaseMail): Promise<Rendered> {
  await message.buildWithContents()
  const json = message.message.toJSON().message
  return { subject: String(json.subject), html: String(json.html), text: String(json.text) }
}

/** HTML-escaped form of a string (as Edge writes it with {{ }}). */
function escaped(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Builds an outbox row's mail in FR then EN. */
async function bothLocales(row: OutboundEmail): Promise<Record<'fr' | 'en', Rendered>> {
  const result = {} as Record<'fr' | 'en', Rendered>
  for (const locale of ['fr', 'en'] as const) {
    row.locale = locale
    const built = await buildOutboxMail(row)
    if (!('mail' in built)) throw new Error(`skipped: ${built.skip}`)
    result[locale] = await render(built.mail)
  }
  return result
}

function assertLayout(
  assert: any,
  rendered: Rendered,
  options: { link: string; locale: 'fr' | 'en'; preferences?: boolean }
) {
  const url = `${APP}${options.link}`
  // Shared branded layout, both parts, the right link in both.
  assert.include(rendered.html, '<html lang="' + options.locale + '">')
  assert.include(rendered.html, 'BFK Resto × British Academy School Marrakech')
  assert.include(rendered.text, 'BFK Resto × British Academy School Marrakech')
  assert.include(rendered.html, `href="${escaped(url)}"`)
  assert.include(rendered.text, url)
  // The text part carries no markup of the layout.
  assert.notMatch(rendered.text, /<(p|a|table|td|div|h1)[\s>]/)
  const prefs = `${APP}/notifications#preferences`
  if (options.preferences) {
    assert.include(rendered.text, prefs)
  } else {
    assert.notInclude(rendered.text, prefs)
  }
}

test.group('Emails | every template in FR and EN', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('invitation and password reset', async ({ assert }) => {
    const { school } = await orderSchool()
    const { parent } = await family(school, { parent: { fullName: 'Salma <b>Idrissi</b>' } })
    const expiresAt = DateTime.fromISO('2026-11-03T10:00', { zone: 'Africa/Casablanca' })
    const expected = {
      invitation: {
        fr: 'Votre accès British Academy × Beldi Fusion',
        en: 'Your British Academy × Beldi Fusion access',
      },
      password_reset: {
        fr: 'Réinitialisation de votre mot de passe',
        en: 'Reset your password',
      },
    } as const
    for (const kind of ['invitation', 'password_reset'] as const) {
      for (const locale of ['fr', 'en'] as const) {
        parent.locale = locale
        const link = `/${kind === 'invitation' ? 'invitation' : 'password/reset'}/TOKEN123`
        const rendered = await render(new AccountLinkMail(kind, parent, `${APP}${link}`, expiresAt))
        assert.equal(rendered.subject, expected[kind][locale])
        assertLayout(assert, rendered, { link, locale })
        // Names are escaped in the HTML part.
        assert.include(rendered.html, 'Salma &lt;b&gt;Idrissi&lt;/b&gt;')
        assert.notInclude(rendered.html, '<b>Idrissi')
        assert.include(rendered.text, locale === 'fr' ? 'novembre' : 'November')
      }
    }
  })

  test('menu published and deadline reminder (opt-outable: preferences link)', async ({
    assert,
  }) => {
    const { school, menu } = await orderSchool()
    const { parent } = await family(school)
    freezeClock(OPEN)
    for (const locale of ['fr', 'en'] as const) {
      const rendered = await render(new MenuPublishedMail(parent, locale, menu, school))
      assert.equal(
        rendered.subject,
        locale === 'fr'
          ? 'Le menu de la semaine du 23 au 27 novembre 2026 est en ligne'
          : 'The menu for November 23 – 27, 2026 is online'
      )
      assertLayout(assert, rendered, { link: '/?week=2026-11-23', locale, preferences: true })
    }

    const row = await OutboundEmail.create({
      userId: parent.id,
      toEmail: parent.email,
      locale: 'fr',
      mailKey: 'deadline_reminder',
      payload: { weeklyMenuId: menu.id },
      status: 'pending',
      attempts: 0,
      sendAfter: DateTime.now(),
      dedupeKey: null,
    })
    const reminder = await bothLocales(row)
    assert.equal(
      reminder.fr.subject,
      'Rappel : choisissez les repas de la semaine du 23 au 27 novembre 2026'
    )
    assert.equal(reminder.en.subject, 'Reminder: choose the meals for November 23 – 27, 2026')
    for (const locale of ['fr', 'en'] as const) {
      assertLayout(assert, reminder[locale], {
        link: '/?week=2026-11-23',
        locale,
        preferences: true,
      })
    }
  })

  test('holiday cancellation, order changed by staff (single and bulk), menu change', async ({
    assert,
  }) => {
    const { school, manager, main, alt, juice } = await orderSchool()
    const { parent, child } = await family(school, { child: { firstName: 'Adam' } })
    freezeClock(OPEN)
    await order(parent, child, MON, main.id, [{ mealId: juice.id, qty: 2 }])
    await order(parent, child, TUE, main.id)
    await order(parent, child, THU, main.id)

    // Holiday on Thursday → holiday_cancellation
    await addHoliday(school, THU, 'Storm')
    await (await app.container.make(HolidayImpactService)).cancelAffectedOrders(school.id, [THU])
    const holiday = await OutboundEmail.query()
      .where('mail_key', 'holiday_cancellation')
      .firstOrFail()
    const holidayMails = await bothLocales(holiday)
    assert.equal(holidayMails.fr.subject, 'Repas annulés (jour férié)')
    assert.equal(holidayMails.en.subject, 'Meals cancelled (holiday)')
    assert.include(holidayMails.fr.text, '- Adam — jeudi 26 novembre')
    assert.include(holidayMails.en.text, '- Adam — Thursday, November 26')
    for (const locale of ['fr', 'en'] as const) {
      assertLayout(assert, holidayMails[locale], { link: '/orders/history', locale })
    }

    // Staff cancel Tuesday (audited) → order_changed_by_staff (single)
    await (await orders()).cancelDay(child.id, TUE, { user: manager }, { reason: 'Sick' })
    const staff = await OutboundEmail.query()
      .where('mail_key', 'order_changed_by_staff')
      .firstOrFail()
    const staffMails = await bothLocales(staff)
    assert.equal(staffMails.fr.subject, 'Commande de Adam modifiée par BFK')
    assert.equal(staffMails.en.subject, "Adam's order changed by BFK")
    for (const locale of ['fr', 'en'] as const) {
      assertLayout(assert, staffMails[locale], {
        link: `/?child=${child.id}&week=2026-11-23`,
        locale,
      })
    }

    // Bulk variant (child deactivated) — rendered from a payload of the parent's orders.
    const mondayRow = await MealOrder.query()
      .where('child_id', child.id)
      .where('date', MON)
      .firstOrFail()
    const monday = await OutboundEmail.create({
      userId: parent.id,
      toEmail: parent.email,
      locale: 'fr',
      mailKey: 'order_changed_by_staff',
      payload: { kind: 'child_inactive', orderIds: [mondayRow.id] },
      status: 'pending',
      attempts: 0,
      sendAfter: DateTime.now(),
      dedupeKey: null,
    })
    const bulk = await bothLocales(monday)
    assert.equal(bulk.fr.subject, '1 repas annulé : inscription désactivée')
    assert.equal(bulk.en.subject, '1 meal cancelled: registration deactivated')
    assertLayout(assert, bulk.fr, { link: '/orders/history', locale: 'fr' })

    // Menu change: default changed and item removed (switched, price lowered).
    const changes = [
      { kind: 'default_changed', date: TUE, mealId: alt.id },
      {
        kind: 'item_removed',
        date: MON,
        mealId: main.id,
        targetMealId: alt.id,
        orderIds: [mondayRow.id],
        priceLowered: true,
      },
    ]
    for (const payload of changes) {
      const row = await OutboundEmail.create({
        userId: parent.id,
        toEmail: parent.email,
        locale: 'fr',
        mailKey: 'menu_change',
        payload,
        status: 'pending',
        attempts: 0,
        sendAfter: DateTime.now(),
        dedupeKey: null,
      })
      const rendered = await bothLocales(row)
      const date = payload.date === TUE ? 'mardi 24 novembre' : 'lundi 23 novembre'
      assert.equal(rendered.fr.subject, `Changement de menu le ${date}`)
      assert.match(
        rendered.en.subject,
        /^Menu change on (Tuesday, November 24|Monday, November 23)$/
      )
      for (const locale of ['fr', 'en'] as const) {
        assertLayout(assert, rendered[locale], { link: '/?week=2026-11-23', locale })
      }
      if (payload.kind === 'item_removed') {
        assert.include(rendered.fr.text, alt.nameFr)
        assert.include(rendered.en.text, alt.nameEn)
      }
    }
  })
})

test.group('Emails | preferences and failures', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => {
    restoreClock()
    mail.restore()
  })

  test('a parent who turned everything off still gets cancellations, never reminders', async ({
    assert,
  }) => {
    const { school, main } = await orderSchool()
    const { parent, child } = await family(school, {
      parent: {
        notificationPrefs: {
          menu_published: false,
          deadline_reminder: false,
          holiday_cancellation: false,
          menu_change: false,
          order_changed_by_staff: false,
        },
      },
    })
    freezeClock(OPEN)
    await order(parent, child, THU, main.id)
    await addHoliday(school, THU, 'Storm')
    await (await app.container.make(HolidayImpactService)).cancelAffectedOrders(school.id, [THU])
    // The cancellation email is queued despite the stored opt-out.
    const queued = await OutboundEmail.query().where('user_id', parent.id)
    assert.deepEqual(
      queued.map((row) => row.mailKey),
      ['holiday_cancellation']
    )

    // A reminder queued before the parent turned it off is skipped when sending.
    const reminder = await OutboundEmail.create({
      userId: parent.id,
      toEmail: parent.email,
      locale: 'fr',
      mailKey: 'deadline_reminder',
      payload: { weeklyMenuId: 1 },
      status: 'pending',
      attempts: 0,
      sendAfter: DateTime.now(),
      dedupeKey: null,
    })
    assert.deepEqual(await buildOutboxMail(reminder), { skip: 'opted_out' })

    const { mails } = mail.fake()
    await (await outbox()).dispatch()
    const sent = mails.sent()
    assert.lengthOf(sent, 1)
    await reminder.refresh()
    assert.equal(reminder.status, 'failed')
    assert.equal(reminder.lastError, 'skipped: opted_out')
    // In-app notices are always created.
    assert.lengthOf(await Notification.query().where('user_id', parent.id), 1)
  })

  test('a failing direct send (password reset) is logged, never thrown', async ({ assert }) => {
    const { school } = await orderSchool()
    const { parent } = await family(school, { parent: { email: 'salma@example.test' } })
    parent.password = 'Secret12345'
    await parent.save()
    const service = await app.container.make(AccountLinkService)
    const original = mail.send
    let attempts = 0
    mail.send = (async () => {
      attempts += 1
      throw new Error('SMTP down')
    }) as typeof mail.send
    try {
      await service.requestPasswordReset('salma@example.test', '127.0.0.1')
    } finally {
      mail.send = original
    }
    assert.equal(attempts, 1)
  })
})
