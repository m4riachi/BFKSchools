import { test } from '@japa/runner'
import { FALLBACK_ERROR_KEY, safeTranslate } from '#support/safe_translate'

test.group('safeTranslate', () => {
  test('returns the message when it formats', ({ assert }) => {
    const i18n = { t: (key: string) => `ok:${key}` }
    assert.equal(
      safeTranslate(i18n, 'orders.errors.SOLD_OUT', { remaining: 1 }),
      'ok:orders.errors.SOLD_OUT'
    )
  })

  test('falls back to the generic message when formatting throws (no 500)', ({ assert }) => {
    const i18n = {
      t: (key: string) => {
        if (key === FALLBACK_ERROR_KEY) return 'generic'
        throw new SyntaxError('EXPECT_ARGUMENT_CLOSING_BRACE')
      },
    }
    assert.equal(safeTranslate(i18n, 'orders.errors.SOLD_OUT', { remaining: 1 }), 'generic')
  })

  test('never throws, even if the fallback breaks', ({ assert }) => {
    const i18n = {
      t: () => {
        throw new Error('broken')
      },
    }
    assert.equal(safeTranslate(i18n, 'x'), 'Error')
  })
})
