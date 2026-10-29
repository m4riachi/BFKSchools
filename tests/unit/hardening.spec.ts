import { test } from '@japa/runner'
import { S3Driver } from 'flydrive/drivers/s3'
import { isLocalPath } from '#support/safe_redirect'
import {
  ClientGoneError,
  PerUserRenderGate,
  RenderBusyError,
  RenderGate,
  UserRenderLimitError,
} from '#support/render_gate'
import DeferredTasks, { DEFERRED_TASKS_MAX_PENDING, safeErrorCode } from '#services/deferred_tasks'
import { s3DriverSettings, signedUrlOriginMismatch, type StorageEnv } from '#support/storage_origin'
import { sanitizeParseResult } from '#services/ics_parser'
import { cleanText } from '#support/pdf_text'
import { ICS_IMPORT } from '#config/holidays'
import { stripDatabaseDetails } from '#exceptions/handler'

const tick = () => new Promise((resolve) => setImmediate(resolve))

test.group('Hardening | open-redirect guard', () => {
  test('only same-origin paths are local', ({ assert }) => {
    for (const ok of ['/', '/orders/history?week=2026-11-23', '/statements#x']) {
      assert.isTrue(isLocalPath(ok), ok)
    }
    for (const bad of [
      '//evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      '/\t/evil.example',
      '/a\\b',
      'https://evil.example',
      'javascript:alert(1)',
      '',
      `/x${String.fromCodePoint(0x7f)}`,
    ]) {
      assert.isFalse(isLocalPath(bad), JSON.stringify(bad))
    }
  })
})

test.group('Hardening | per-user PDF gate (D27)', () => {
  test('1 running + 1 waiting per user; other users are not blocked', async ({ assert }) => {
    const gate = new PerUserRenderGate(new RenderGate(2, 20), 1, 1)
    const releases: Array<() => void> = []
    let running = 0
    let peakForUser = 0
    const work = () =>
      new Promise<string>((resolve) => {
        running += 1
        peakForUser = Math.max(peakForUser, running)
        releases.push(() => {
          running -= 1
          resolve('done')
        })
      })

    const first = gate.run(7, work)
    const second = gate.run(7, work) // waits behind the first
    await assert.rejects(() => gate.run(7, work), UserRenderLimitError as any)
    assert.instanceOf(new UserRenderLimitError(), RenderBusyError)
    assert.equal(gate.inFlight(7), 2)

    // Another user renders meanwhile.
    const other = gate.run(8, async () => 'other')
    assert.equal(await other, 'other')

    await tick()
    assert.equal(peakForUser, 1)
    releases.shift()!()
    assert.equal(await first, 'done')
    await tick()
    await tick()
    releases.shift()!()
    assert.equal(await second, 'done')
    assert.equal(peakForUser, 1)
    assert.equal(gate.inFlight(7), 0)
  })

  test('a render whose client left while waiting is skipped', async ({ assert }) => {
    const gate = new PerUserRenderGate(new RenderGate(1, 5), 1, 1)
    let release!: () => void
    const first = gate.run(
      1,
      () => new Promise<string>((resolve) => (release = () => resolve('a')))
    )
    let gone = false
    let rendered = false
    const second = gate.run(
      1,
      async () => {
        rendered = true
        return 'b'
      },
      () => gone
    )
    gone = true
    await tick()
    release()
    assert.equal(await first, 'a')
    await assert.rejects(() => second, ClientGoneError as any)
    assert.isFalse(rendered)
    assert.equal(gate.inFlight(1), 0)
  })

  test('the server-wide gate still applies (503 when its queue is full)', async ({ assert }) => {
    const shared = new RenderGate(1, 0)
    const gate = new PerUserRenderGate(shared, 1, 1)
    let release!: () => void
    const first = gate.run(1, () => new Promise<void>((resolve) => (release = resolve)))
    await tick()
    await assert.rejects(() => gate.run(2, async () => 'x'), RenderBusyError as any)
    release()
    await first
  })
})

test.group('Hardening | deferred tasks', () => {
  test('queue cap, address-free error logs, bounded drain', async ({ assert }) => {
    const tasks = new DeferredTasks()
    const releases: Array<() => void> = []
    for (let i = 0; i < DEFERRED_TASKS_MAX_PENDING; i++) {
      assert.isTrue(tasks.run(`t${i}`, () => new Promise<void>((r) => releases.push(r))))
    }
    assert.isFalse(tasks.run('one too many', async () => {}))
    assert.equal(tasks.size, DEFERRED_TASKS_MAX_PENDING)

    assert.isFalse(await tasks.drain(20))
    await tick()
    for (const release of releases) release()
    assert.isTrue(await tasks.drain(1000))
    assert.equal(tasks.size, 0)

    const smtp = Object.assign(new Error('550 <salma@example.test> mailbox unavailable'), {
      code: 'EENVELOPE',
      responseCode: 550,
    })
    assert.equal(safeErrorCode(smtp), 'Error EENVELOPE 550')
    assert.notInclude(safeErrorCode(smtp), 'salma')
  })
})

test.group('Hardening | S3 boot self-check', () => {
  const aws: StorageEnv = { DRIVE_DISK: 's3', S3_REGION: 'eu-west-3', S3_BUCKET: 'bfk-photos' }

  async function sign(values: StorageEnv) {
    const driver = new S3Driver({
      credentials: { accessKeyId: 'a', secretAccessKey: 's' },
      visibility: 'private',
      ...s3DriverSettings(values),
    } as any)
    return driver.getSignedUrl('_boot-check/presign-probe.webp', { expiresIn: '1 min' })
  }

  test('a URL signed by the real client matches the CSP origin', async ({ assert }) => {
    assert.isNull(signedUrlOriginMismatch(await sign(aws), aws))
    const r2: StorageEnv = {
      DRIVE_DISK: 's3',
      S3_REGION: 'auto',
      S3_BUCKET: 'bfk-photos',
      S3_ENDPOINT: 'https://acc123.r2.cloudflarestorage.com',
    }
    assert.isNull(signedUrlOriginMismatch(await sign(r2), r2))
  })

  test('a different signing host is reported (fail closed at boot)', ({ assert }) => {
    const message = signedUrlOriginMismatch(
      'https://bfk-photos.s3.dualstack.eu-west-3.amazonaws.com/x?X-Amz-Signature=1',
      aws
    )
    assert.match(String(message), /dualstack/)
    assert.match(String(message), /S3_PUBLIC_ORIGIN/)
    assert.isNull(
      signedUrlOriginMismatch('https://cdn.example.com/x', {
        ...aws,
        S3_PUBLIC_ORIGIN: 'https://cdn.example.com',
      })
    )
    assert.isNull(signedUrlOriginMismatch('https://whatever', { DRIVE_DISK: 'fs' }))
  })
})

test.group('Hardening | small fixes', () => {
  test('an ICS result with many ignored entries is kept (sliced), not rejected', ({ assert }) => {
    const ignored = Array.from({ length: ICS_IMPORT.maxEvents + 500 }, (_, i) => ({
      summary: `Meeting ${i}`,
      reason: 'timed',
    }))
    const result = sanitizeParseResult({ ranges: [], ignored, truncated: false })
    assert.isNotNull(result)
    assert.lengthOf(result!.ignored, ICS_IMPORT.maxEvents)
  })

  test('PDF text drops zero-width and bidi characters', ({ assert }) => {
    const zw = String.fromCodePoint(0x200b)
    const bom = String.fromCodePoint(0xfeff)
    const alm = String.fromCodePoint(0x061c)
    assert.equal(cleanText(`Sa${zw}lma${bom} ${alm}Idrissi`), 'Salma Idrissi')
  })
})

test.group('Hardening | error logs (L2)', () => {
  test('database error details (values, bindings) are stripped before reporting', ({ assert }) => {
    const cause = Object.assign(new Error('inner'), { detail: 'Key (x)=(secret)' })
    const error = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      constraint: 'users_email_unique',
      detail: 'Key (lower(email))=(salma@example.test) already exists.',
      where: 'SQL statement',
      bindings: ['salma@example.test'],
      cause,
    })
    stripDatabaseDetails(error)
    assert.notInclude(JSON.stringify({ ...error, cause: { ...cause } }), 'salma')
    assert.notInclude(JSON.stringify({ ...cause }), 'secret')
    assert.equal(error.code, '23505')
    assert.equal(error.constraint, 'users_email_unique')
  })
})
