import { test } from '@japa/runner'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import Holiday from '#models/holiday'
import IcsParser from '#services/ics_parser'
import HolidayService from '#services/holiday_service'
import HolidayImportService from '#services/holiday_import_service'
import SafeHttpFetcher, { type Transport } from '#services/safe_http_fetcher'
import { ICS_IMPORT } from '#config/holidays'
import { setupHolidaySchool } from '#tests/helpers/holidays'

const fixture = () =>
  readFile(new URL('../../fixtures/holidays/school_calendar.ics', import.meta.url))

function inputErrors(response: { flashMessage: (key: string) => unknown }) {
  return (response.flashMessage('inputErrorsBag') ?? {}) as Record<string, string[] | string>
}

/** Counts parser calls; can be told to fail. */
function spyParser() {
  const spy = { calls: 0, fail: false }
  class SpyParser extends IcsParser {
    parse(...args: Parameters<IcsParser['parse']>) {
      spy.calls += 1
      if (spy.fail) throw new Error('the raw calendar must not be parsed again')
      return super.parse(...args)
    }
  }
  app.container.swap(IcsParser, () => new SpyParser())
  return spy
}

test.group('Holidays | ICS import hardening', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    return async () => {
      app.container.restore(IcsParser)
      app.container.restore(SafeHttpFetcher)
      await truncate()
    }
  })

  test('the calendar is parsed once, at upload; preview and confirm never re-parse', async ({
    client,
    assert,
  }) => {
    const { manager } = await setupHolidaySchool({ start: '2026-08-24', end: '2027-06-11' })
    const spy = spyParser()
    const upload = await client
      .post('/admin/holidays/import')
      .loginAs(manager)
      .withCsrfToken()
      .file('calendar', await fixture(), { filename: 'school.ics' })
      .redirects(0)
    const importId = String(upload.header('location')).split('/').pop()!
    assert.equal(spy.calls, 1)

    spy.fail = true
    const preview = await client
      .get(`/admin/holidays/import/${importId}`)
      .loginAs(manager)
      .withInertia()
    preview.assertStatus(200)
    const ranges = (preview.inertiaProps as any).preview.ranges as any[]
    assert.lengthOf(ranges, 5)
    const again = await client
      .get(`/admin/holidays/import/${importId}`)
      .loginAs(manager)
      .withInertia()
    again.assertStatus(200)

    const confirm = await client
      .post(`/admin/holidays/import/${importId}/confirm`)
      .loginAs(manager)
      .json({ ranges: [ranges.find((r) => r.name === 'Spring Break').key] })
      .withCsrfToken()
      .redirects(0)
    confirm.assertStatus(302)
    assert.equal(spy.calls, 1)
    assert.lengthOf(await Holiday.query().where('source', 'import'), 5)
  })

  test('a tampered or out-of-date stored preview is treated as expired', async ({ assert }) => {
    const { school } = await setupHolidaySchool({ start: '2026-08-24', end: '2027-06-11' })
    const imports = await app.container.make(HolidayImportService)
    const content = await fixture()
    const parsed = await imports.parse(school, content.toString('utf8'))
    const stored = imports.serialize(school, parsed)
    assert.deepEqual(imports.deserialize(school, stored), parsed)

    const tampered = JSON.parse(stored)
    tampered.result.ranges[0].startDate = "2026-10-02'; DROP TABLE holidays; --"
    assert.isNull(imports.deserialize(school, JSON.stringify(tampered)))
    assert.isNull(imports.deserialize(school, '{not json'))
    school.schoolYearEnd = '2027-06-30'
    assert.isNull(imports.deserialize(school, stored), 'school year changed since the upload')
  })

  test('an import writing too many days is refused with a field error', async ({ assert }) => {
    const { school } = await setupHolidaySchool()
    const imports = await app.container.make(HolidayImportService)
    // 60 overlapping ranges of ~85 school days each (> maxImportDays rows).
    const ranges = Array.from({ length: 60 }, (_, i) => {
      const uidHash = i.toString(16).padStart(24, '0')
      return {
        key: `${uidHash}:2026-09-01`,
        uidHash,
        summary: `Range ${i}`,
        startDate: '2026-09-01',
        endDate: '2026-12-28',
        recurring: false,
      }
    })
    const error = await imports
      .apply(
        school,
        { ranges, ignored: [], truncated: false },
        ranges.map((r) => r.key),
        'Break'
      )
      .catch((e) => e)
    assert.equal(error.messageKey, 'holidays.import.too_many_days')
    assert.equal(error.options.field, 'ranges')
    assert.equal(error.options.values.max, ICS_IMPORT.maxImportDays)
    assert.lengthOf(await Holiday.query().where('school_id', school.id), 0)
  })

  test('large inserts are chunked below the bind-parameter limit', async ({ assert }) => {
    const { school } = await setupHolidaySchool()
    const service = await app.container.make(HolidayService)
    const days = service.schoolDaysBetween(school, '2026-09-01', '2027-06-30')
    // > 65,535 / 8 rows in one call.
    const rows = Array.from({ length: Math.ceil(9000 / days.length) }, (_, n) =>
      days.map((date) => ({
        date,
        name: `Day ${n}`,
        source: 'manual' as const,
        ruleKey: null,
        groupId: null,
      }))
    ).flat()
    assert.isAbove(rows.length, 8192)
    const result = await service.insertRows(school, rows, { confirmImpact: true })
    assert.equal(result.created, rows.length)
  }).timeout(30_000)

  test('URL errors do not reveal DNS or internal-network details', async ({ client, assert }) => {
    const { manager } = await setupHolidaySchool()
    const transport: Transport = async () => {
      throw new Error('ECONNREFUSED')
    }
    app.container.swap(
      SafeHttpFetcher,
      () =>
        new SafeHttpFetcher(async (host) => {
          if (host === 'down.example.org') return [{ address: '93.184.215.14', family: 4 }]
          if (host === 'intranet.example.org') return [{ address: '10.0.0.8', family: 4 }]
          throw new Error('ENOTFOUND')
        }, transport)
    )
    const messages = new Set<string>()
    for (const url of [
      'https://127.0.0.1/a.ics', // blocked literal
      'https://intranet.example.org/a.ics', // resolves to a private address
      'https://nowhere.example.org/a.ics', // DNS failure
      'https://down.example.org/a.ics', // network error
    ]) {
      const response = await client
        .post('/admin/holidays/import/url')
        .loginAs(manager)
        .json({ url })
        .withCsrfToken()
        .redirects(0)
      messages.add(String(inputErrors(response).url))
    }
    assert.equal(messages.size, 1)
    assert.match([...messages][0], /non autorisée ou injoignable|not allowed or unreachable/)
  })

  test('the URL fetch result is parsed once too', async ({ client, assert }) => {
    const { manager } = await setupHolidaySchool({ start: '2026-08-24', end: '2027-06-11' })
    const spy = spyParser()
    const body = await fixture()
    app.container.swap(
      SafeHttpFetcher,
      () =>
        new SafeHttpFetcher(
          async () => [{ address: '93.184.215.14', family: 4 }],
          async () => ({ status: 200, headers: {}, body: Readable.from([body]) })
        )
    )
    const response = await client
      .post('/admin/holidays/import/url')
      .loginAs(manager)
      .json({ url: 'https://calendar.example.org/school.ics' })
      .withCsrfToken()
      .redirects(0)
    const importId = String(response.header('location')).split('/').pop()!
    spy.fail = true
    const preview = await client
      .get(`/admin/holidays/import/${importId}`)
      .loginAs(manager)
      .withInertia()
    preview.assertStatus(200)
    assert.equal(spy.calls, 1)
  })
})
