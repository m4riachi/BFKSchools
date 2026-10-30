import { test } from '@japa/runner'
import { whatsappNumber } from '#support/whatsapp'

test.group('WhatsApp numbers', () => {
  test('{0} → {1}')
    .with([
      ['0612345678', '212612345678'],
      ['06 12 34 56 78', '212612345678'],
      ['+212612345678', '212612345678'],
      ['00212612345678', '212612345678'],
      ['212612345678', '212612345678'],
      ['+33612345678', '33612345678'],
    ] as const)
    .run(({ assert }, [phone, expected]) => {
      assert.equal(whatsappNumber(phone), expected)
    })

  test('no number, or not a number', ({ assert }) => {
    for (const phone of [null, undefined, '', '123', '00', 'abc', '+1234567890123456']) {
      assert.isNull(whatsappNumber(phone), String(phone))
    }
  })
})
