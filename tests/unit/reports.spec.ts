import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import { fileNamePart, needsEscaping, safeCell } from '#support/spreadsheet_safety'
import { resolvePeriod } from '#support/report_period'
import { compareGrades, type LabelRow } from '#services/production_report_service'
import LabelPdfService, { MAX_LABELS_PER_PDF, cleanText } from '#services/label_pdf_service'

test.group('Reports | formula injection escaping', () => {
  test('cells starting with = + - @ tab CR (and fullwidth forms) get a leading quote', ({
    assert,
  }) => {
    const cases: [string, string][] = [
      ['=1+1', "'=1+1"],
      ['+33 6 12', "'+33 6 12"],
      ['-2+3', "'-2+3"],
      ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
      ['\t=cmd', "'\t=cmd"],
      ['\r=cmd', "'\r=cmd"],
      ['=HYPERLINK("http://evil","x")', `'=HYPERLINK("http://evil","x")`],
      [`${String.fromCodePoint(0xff1d)}1+1`, `'${String.fromCodePoint(0xff1d)}1+1`],
      [`${String.fromCodePoint(0)}=1+1`, "'=1+1"], // control char stripped first
      ['Lina', 'Lina'],
      ['3B', '3B'],
      ['Crème brûlée', 'Crème brûlée'],
      ['a=b', 'a=b'],
      ['', ''],
    ]
    for (const [input, expected] of cases) assert.equal(safeCell(input), expected, input)
    assert.equal(safeCell(null), '')
    assert.equal(safeCell(undefined), '')
    assert.isTrue(needsEscaping('=x'))
    assert.isFalse(needsEscaping('x='))
  })

  test('file name parts are ASCII only', ({ assert }) => {
    assert.equal(fileNamePart('3B'), '3B')
    assert.equal(fileNamePart('CE1 é/../"x"'), 'CE1-e-x')
    assert.equal(fileNamePart('=HYPERLINK("http://x")'), 'HYPERLINK-http-x')
    assert.equal(fileNamePart('محمد'), 'all')
  })
})

test.group('Reports | export period', () => {
  const today = '2026-11-25'

  test('day, week (Mon–Sun), month and custom ranges', ({ assert }) => {
    assert.deepEqual(resolvePeriod({}, today, 366), {
      period: 'day',
      date: today,
      from: today,
      to: today,
    })
    assert.deepEqual(resolvePeriod({ period: 'week', date: '2026-11-26' }, today, 366), {
      period: 'week',
      date: '2026-11-26',
      from: '2026-11-23',
      to: '2026-11-29',
    })
    assert.deepEqual(resolvePeriod({ period: 'month', date: '2027-02-10' }, today, 366), {
      period: 'month',
      date: '2027-02-10',
      from: '2027-02-01',
      to: '2027-02-28',
    })
    assert.deepEqual(
      resolvePeriod({ period: 'custom', from: '2026-01-01', to: '2027-01-01' }, today, 366),
      { period: 'custom', date: '2026-01-01', from: '2026-01-01', to: '2027-01-01' }
    )
  })

  test('invalid periods are refused', ({ assert }) => {
    assert.deepEqual(
      resolvePeriod({ period: 'custom', from: '2026-01-01', to: '2027-01-02' }, today, 366),
      { error: 'range_too_long' }
    )
    assert.deepEqual(
      resolvePeriod({ period: 'custom', from: '2026-02-01', to: '2026-01-31' }, today, 366),
      { error: 'range_order' }
    )
    assert.deepEqual(resolvePeriod({ period: 'custom', from: '2026-01-01' }, today, 366), {
      error: 'invalid_date',
    })
    assert.deepEqual(resolvePeriod({ date: '1999-12-31' }, today, 366), { error: 'invalid_date' })
    assert.deepEqual(resolvePeriod({ date: '2026-02-30' }, today, 366), { error: 'invalid_date' })
  })
})

test.group('Reports | grades', () => {
  test('pre-K and kindergarten first, then grades by number', ({ assert }) => {
    assert.deepEqual(['G10', 'G2', '', 'KG2', 'G1', 'PK', 'KG1'].sort(compareGrades), [
      'PK',
      'KG1',
      'KG2',
      'G1',
      'G2',
      'G10',
      '',
    ])
  })
})

/** Right-to-left override and NUL (kept out of the source as raw characters). */
const RLO = String.fromCodePoint(0x202e)
const NUL = String.fromCodePoint(0)

function label(overrides: Partial<LabelRow> = {}): LabelRow {
  return {
    orderId: 1,
    date: '2026-11-24',
    firstName: 'Lina',
    lastName: 'Haddad',
    grade: 'G3',
    className: '3B',
    allergies: [],
    hasConflict: false,
    lines: [
      {
        mealId: 1,
        nameFr: 'Poulet rôti, riz pilaf & légumes',
        nameEn: 'Roast chicken',
        mealType: 'subscription',
        quantity: 1,
        allergens: [],
        conflicts: [],
      },
    ],
    ...overrides,
  }
}

function pages(pdf: Buffer) {
  return pdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0
}

test.group('Reports | labels PDF', () => {
  test('hostile, long, Arabic and emoji names render without error', async ({ assert }) => {
    const service = await app.container.make(LabelPdfService)
    const rows: LabelRow[] = [
      label({ firstName: 'محمد', lastName: 'بن العلوي', allergies: ['milk', 'gluten'] }),
      label({ firstName: 'Zoë 🍕', lastName: 'O’Brien-Ünal' }),
      label({ firstName: 'A'.repeat(300), lastName: 'B'.repeat(300), className: 'C'.repeat(60) }),
      label({
        firstName: `${RLO}gnp.exe`,
        lastName: `${NUL}${String.fromCodePoint(7)}`,
        className: null,
        grade: null,
      }),
      label({
        allergies: ['nuts'],
        hasConflict: true,
        lines: [
          {
            mealId: 2,
            nameFr: 'Tarte aux noix',
            nameEn: 'Nut pie',
            mealType: 'subscription',
            quantity: 1,
            allergens: ['nuts'],
            conflicts: ['nuts'],
          },
          ...Array.from({ length: 12 }, (_, index) => ({
            mealId: 10 + index,
            nameFr: `Supplément ${index}`,
            nameEn: `Extra ${index}`,
            mealType: 'supplement' as const,
            quantity: 3,
            allergens: [],
            conflicts: [],
          })),
        ],
      }),
    ]
    const pdf = await service.render(rows, {
      grid: { cols: 3, rows: 8 },
      locale: 'fr',
      title: 'Étiquettes',
    })
    assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-')
    assert.equal(pages(pdf), 1)
    // Fonts are embedded (subsets), never the standard Helvetica.
    assert.match(pdf.toString('latin1'), /NotoSans/)
    assert.notMatch(pdf.toString('latin1'), /\/BaseFont \/Helvetica/)
  })

  test('pages follow the grid; the label count is capped', async ({ assert }) => {
    const service = await app.container.make(LabelPdfService)
    const many = Array.from({ length: 50 }, (_, index) => label({ orderId: index + 1 }))
    const options = { locale: 'en', title: 'Labels' }
    assert.equal(pages(await service.render(many, { ...options, grid: { cols: 3, rows: 8 } })), 3)
    assert.equal(pages(await service.render(many, { ...options, grid: { cols: 6, rows: 20 } })), 1)
    // Out-of-range grids are clamped (1 × 1 minimum).
    assert.equal(
      pages(await service.render(many.slice(0, 2), { ...options, grid: { cols: 0, rows: 0 } })),
      2
    )
    const tooMany = Array.from({ length: MAX_LABELS_PER_PDF + 1 }, () => label())
    await assert.rejects(() => service.render(tooMany, { ...options, grid: { cols: 3, rows: 8 } }))
  })

  test('cleanText removes controls and bidi overrides', ({ assert }) => {
    assert.equal(cleanText(`${RLO}abc${NUL} \n def`), 'abc def')
    assert.equal(cleanText(null), '')
  })
})
