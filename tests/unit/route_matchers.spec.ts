import { test } from '@japa/runner'
import { DB_ID_MAX, isDbId } from '#support/route_matchers'
import { parseMadToCents } from '#support/money'

test.group('Route matchers | database ids', () => {
  test('accepts 1..2147483647 only', ({ assert }) => {
    for (const value of [
      '1',
      '9',
      '42',
      '999999999',
      '1000000000',
      '2147483647',
      String(DB_ID_MAX),
    ]) {
      assert.isTrue(isDbId(value), value)
    }
    for (const value of [
      '0',
      '-1',
      '01',
      '1.5',
      '1e3',
      'abc',
      '',
      ' 1',
      '2147483648',
      '2147483650',
      '2200000000',
      '9999999999',
      '10000000000',
      '99999999999999999999',
    ]) {
      assert.isFalse(isDbId(value), value)
    }
  })

  test('every boundary just above the maximum is refused', ({ assert }) => {
    // Bump each digit of 2147483647 and check the result is refused.
    const max = String(DB_ID_MAX)
    for (let i = 0; i < max.length; i++) {
      const digit = Number(max[i])
      if (digit === 9) continue
      const bigger = `${max.slice(0, i)}${digit + 1}${max.slice(i + 1)}`
      assert.isFalse(isDbId(bigger), bigger)
      const smaller = `${max.slice(0, i)}${digit === 0 ? 0 : digit - 1}${max.slice(i + 1)}`
      assert.equal(
        isDbId(smaller),
        Number(smaller) <= DB_ID_MAX && !smaller.startsWith('0'),
        smaller
      )
    }
  })
})

test.group('Money | whitespace in amounts', () => {
  test('spaces are thousands separators of exactly 3 digits', ({ assert }) => {
    assert.equal(parseMadToCents('1 234,50'), 123450)
    assert.equal(parseMadToCents('1 234,50'), 123450)
    assert.equal(parseMadToCents('1 234,50'), 123450)
    assert.equal(parseMadToCents('12 345 678'), 1234567800)
    assert.equal(parseMadToCents(' 12,50 '), 1250)
    for (const input of [
      '12 50',
      '12\n50',
      '12\t50',
      '1 23',
      '1 2345',
      '1234 567',
      '1  234',
      '12 ,50',
      '12, 50',
      '\n12',
    ]) {
      assert.isNull(parseMadToCents(input), JSON.stringify(input))
    }
  })
})
