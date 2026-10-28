import { test } from '@japa/runner'
import { DateTime } from 'luxon'
import { isSafeEmail, passwordStrengthIssues } from '#validators/rules'
import { ALLERGENS, ALLERGENS_SQL_ARRAY } from '#enums/allergens'
import UserTokenService from '#services/user_token_service'
import AccountLinkMail from '#mails/account_link_mail'
import User from '#models/user'

test.group('Families | rules', () => {
  test('password strength', ({ assert }) => {
    assert.deepEqual(passwordStrengthIssues('Couscous2026'), [])
    assert.deepEqual(passwordStrengthIssues('Ab1'), ['length'])
    assert.deepEqual(passwordStrengthIssues('abcdefghijk'), ['digit'])
    assert.deepEqual(passwordStrengthIssues('12345678901'), ['letter'])
    assert.deepEqual(passwordStrengthIssues('élève123456'), [])
  })

  test('only plain addresses are accepted as recipients', ({ assert }) => {
    for (const ok of ['salma@example.com', 'a.b+tag@sub.example.ma', "o'brien@example.com"]) {
      assert.isTrue(isSafeEmail(ok), ok)
    }
    for (const bad of [
      '"a@b.c x"@example.com',
      'Salma <salma@example.com>',
      'a@b.c, d@e.f',
      'a b@example.com',
      'a@localhost',
      'a@exa_mple.com',
      'A@Example.com',
    ]) {
      assert.isFalse(isSafeEmail(bad), bad)
    }
  })

  test('the allergen SQL literal matches the 14 codes', ({ assert }) => {
    assert.lengthOf(ALLERGENS, 14)
    assert.equal(
      ALLERGENS_SQL_ARRAY,
      "ARRAY['gluten','crustaceans','eggs','fish','peanuts','soybeans','milk','nuts','celery','mustard','sesame','sulphites','lupin','molluscs']::text[]"
    )
  })

  test('token hash is the SHA-256 hex of the raw token', ({ assert }) => {
    assert.equal(
      UserTokenService.hash('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  test('the account link mail refuses a non-plain recipient', async ({ assert }) => {
    const user = new User()
    user.fullName = 'X'
    user.locale = 'fr'
    user.email = '"evil@attacker.test x"@example.com'
    const mail = new AccountLinkMail(
      'invitation',
      user,
      'https://x.test/invitation/t',
      DateTime.now()
    )
    await assert.rejects(() => mail.build(), /plain validated email/)
  })
})
