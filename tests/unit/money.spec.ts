import { test } from '@japa/runner'
import { formatMad, parseMadToCents } from '#support/money'

test.group('Money helpers', () => {
  test('formats centimes as MAD in French and English', ({ assert }) => {
    assert.equal(formatMad(1250, 'fr'), '12,50 MAD')
    assert.equal(formatMad(5763000, 'fr'), '57\u202F630,00 MAD')
    assert.equal(formatMad(5763000, 'en'), '57,630.00 MAD')
    assert.equal(formatMad(5, 'en'), '0.05 MAD')
    assert.equal(formatMad(0, 'fr'), '0,00 MAD')
    assert.equal(formatMad(-1250, 'en'), '-12.50 MAD')
  })

  test('refuses non-integer centimes', ({ assert }) => {
    assert.throws(() => formatMad(12.5, 'fr'))
  })

  test('parses staff input into centimes without floats', ({ assert }) => {
    assert.equal(parseMadToCents('12,50'), 1250)
    assert.equal(parseMadToCents('12.5'), 1250)
    assert.equal(parseMadToCents('12'), 1200)
    assert.equal(parseMadToCents('0.1'), 10)
    assert.equal(parseMadToCents('1 234,56'), 123456)
    assert.equal(parseMadToCents('19.99'), 1999)
    assert.isNull(parseMadToCents('12,505'))
    assert.isNull(parseMadToCents('-3'))
    assert.isNull(parseMadToCents('abc'))
    assert.isNull(parseMadToCents(''))
  })
})
