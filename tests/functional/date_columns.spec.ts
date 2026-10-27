import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import School from '#models/school'
import { SchoolFactory } from '#database/factories/school_factory'

/**
 * `date` columns must come back exactly as written ('YYYY-MM-DD' strings),
 * including around Morocco's offset changes (tzdata 2026c: 2026-02-15,
 * 2026-03-22, and 2026-09-20 when Morocco moved to UTC+0) and year ends.
 */
const DATES = [
  '2027-03-28',
  '2026-02-15',
  '2026-03-22',
  '2026-09-19',
  '2026-09-20',
  '2026-09-21',
  '2026-12-31',
  '2027-01-01',
]

test.group('date columns', (group) => {
  group.each.setup(() => testUtils.db().wrapInGlobalTransaction())

  for (const date of DATES) {
    test('a date column written as {date} reads back as the same string')
      .with([date])
      .run(async ({ assert }, value) => {
        const created = await SchoolFactory.merge({
          schoolYearStart: value,
          schoolYearEnd: '2030-01-01',
        }).create()

        const fresh = await School.findOrFail(created.id)
        assert.strictEqual(fresh.schoolYearStart, value)

        const raw = await db.from('schools').where('id', created.id).select('school_year_start')
        assert.strictEqual(raw[0].school_year_start, value)

        const filtered = await School.query()
          .where('school_year_start', value)
          .where('id', created.id)
          .first()
        assert.isNotNull(filtered)
      })
  }

  test('date comparisons in SQL use the plain date', async ({ assert }) => {
    const created = await SchoolFactory.merge({
      schoolYearStart: '2027-03-28',
      schoolYearEnd: '2027-06-11',
    }).create()

    const result = await db.rawQuery(
      `SELECT school_year_start = '2027-03-28'::date AS same, school_year_start::text AS text FROM schools WHERE id = ?`,
      [created.id]
    )
    assert.isTrue(result.rows[0].same)
    assert.equal(result.rows[0].text, '2027-03-28')
  })
})
