/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import { readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import { uploadTmpDir } from '#support/uploads'
import { setupSchool } from '#tests/helpers/families'

const BLOB = Buffer.alloc(1.5 * 1024 * 1024, 7)

async function uploadFiles() {
  return (await readdir(uploadTmpDir())).sort()
}
async function osTmpFiles() {
  return new Set(await readdir(tmpdir()))
}

/**
 * Security review H1: the bodyparser runs before auth/CSRF, so multipart
 * bodies must never leave files behind — on any route, for anyone.
 */
test.group('Hardening | multipart temp files', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return testUtils.db().truncate()
  })

  test('an anonymous multipart POST to /login or /locale writes nothing', async ({
    client,
    assert,
  }) => {
    const before = await uploadFiles()
    const osBefore = await osTmpFiles()
    for (const url of ['/login', '/locale']) {
      const res = await client
        .post(url)
        .file('f', BLOB, { filename: 'big.bin' })
        .field('email', 'x@y.z')
        .withCsrfToken()
        .redirects(0)
      assert.isBelow(res.status(), 500, url)
    }
    assert.deepEqual(await uploadFiles(), before)
    const osAfter = await osTmpFiles()
    assert.deepEqual(
      [...osAfter].filter((name) => !osBefore.has(name) && /^[0-9a-f-]{36}$/.test(name)),
      []
    )
  })

  test('an authenticated multipart POST to a non-upload route writes nothing', async ({
    client,
    assert,
  }) => {
    const { manager } = await setupSchool()
    const before = await uploadFiles()
    await client
      .post('/admin/parents')
      .loginAs(manager)
      .file('file', BLOB, { filename: 'big.bin' })
      .withCsrfToken()
      .redirects(0)
    assert.deepEqual(await uploadFiles(), before)
  })

  test('import routes delete their temp file on every path', async ({ client, assert }) => {
    const { manager } = await setupSchool()
    const before = await uploadFiles()
    // Anonymous (auth middleware refuses after the bodyparser ran)
    const anonymous = await client
      .post('/admin/imports/families')
      .file('file', Buffer.from('a,b\n1,2\n'), { filename: 'f.csv' })
      .withCsrfToken()
      .redirects(0)
    assert.equal(anonymous.status(), 302)
    // Validation failure (not a CSV)
    await client
      .post('/admin/imports/families')
      .loginAs(manager)
      .file('file', BLOB, { filename: 'f.png' })
      .withCsrfToken()
      .redirects(0)
    // Missing CSRF token
    await client
      .post('/admin/holidays/import')
      .loginAs(manager)
      .file('calendar', Buffer.from('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'), {
        filename: 'c.ics',
      })
      .redirects(0)
    // Above the 2 MB multipart limit
    const huge = await client
      .post('/admin/imports/families')
      .loginAs(manager)
      .file('file', Buffer.alloc(3 * 1024 * 1024, 65), { filename: 'f.csv' })
      .withCsrfToken()
      .redirects(0)
    assert.include([302, 413], huge.status())
    assert.deepEqual(await uploadFiles(), before)
  })
})

test.group('Hardening | headers on every response (L1)', () => {
  test('unmatched routes and CSRF failures carry the static security headers', async ({
    client,
  }) => {
    const missing = await client.get('/no-such-page').redirects(0)
    missing.assertStatus(404)
    const csrf = await client.post('/login').form({ email: 'a@b.c', password: 'x' }).redirects(0)
    for (const res of [missing, csrf]) {
      res.assertHeader('x-frame-options', 'DENY')
      res.assertHeader('x-content-type-options', 'nosniff')
      res.assertHeader('referrer-policy', 'strict-origin-when-cross-origin')
    }
  })
})
