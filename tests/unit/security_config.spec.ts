import { test } from '@japa/runner'
import { rateLimitIpKey } from '#support/ip'
import proxyaddr from 'proxy-addr'
import { defineConfig } from '@adonisjs/core/http'
import { assertDriveEnv, assertSafeProductionEnv, parseTrustProxy } from '#support/env_guards'
import type { TrustProxyFn } from '#support/env_guards'
import { LogTransport, maskEmail } from '#app/mail/log_transport'
import type { NodeMailerMessage } from '@adonisjs/mail/types'

test.group('Rate-limit IP key', () => {
  test('IPv4 and IPv4-mapped addresses are used as is', ({ assert }) => {
    assert.equal(rateLimitIpKey('203.0.113.7'), '203.0.113.7')
    assert.equal(rateLimitIpKey('::ffff:203.0.113.7'), '203.0.113.7')
  })

  test('IPv6 addresses are reduced to their /64 prefix', ({ assert }) => {
    assert.equal(rateLimitIpKey('2001:db8:1:2::a'), '2001:db8:1:2::/64')
    assert.equal(rateLimitIpKey('2001:0DB8:0001:0002:ffff:1:2:3'), '2001:db8:1:2::/64')
    assert.equal(rateLimitIpKey('2001:db8::1'), '2001:db8:0:0::/64')
    assert.equal(rateLimitIpKey('::1'), '0:0:0:0::/64')
    assert.equal(rateLimitIpKey('fe80::1%eth0'), 'fe80:0:0:0::/64')
    assert.equal(rateLimitIpKey('64:ff9b:1:2::1.2.3.4'), '64:ff9b:1:2::/64')
    assert.notEqual(rateLimitIpKey('2001:db8:1:2::1'), rateLimitIpKey('2001:db8:1:3::1'))
  })
})

test.group('Environment guards', () => {
  test('DRIVE_DISK=s3 requires the bucket, region and credentials', ({ assert }) => {
    assert.doesNotThrow(() => assertDriveEnv({ DRIVE_DISK: 'fs' }))
    assert.throws(
      () => assertDriveEnv({ DRIVE_DISK: 's3', S3_BUCKET: 'b' }),
      /S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION/
    )
    assert.doesNotThrow(() =>
      assertDriveEnv({
        DRIVE_DISK: 's3',
        S3_ACCESS_KEY_ID: 'a',
        S3_SECRET_ACCESS_KEY: 's',
        S3_REGION: 'auto',
        S3_BUCKET: 'b',
      })
    )
  })

  test('MAIL_MAILER=log is refused in production only', ({ assert }) => {
    assert.throws(
      () => assertSafeProductionEnv({ NODE_ENV: 'production', MAIL_MAILER: 'log' }),
      /MAIL_MAILER=log is not allowed in production/
    )
    assert.doesNotThrow(() =>
      assertSafeProductionEnv({ NODE_ENV: 'production', MAIL_MAILER: 'smtp' })
    )
    assert.doesNotThrow(() =>
      assertSafeProductionEnv({ NODE_ENV: 'development', MAIL_MAILER: 'log' })
    )
    assert.doesNotThrow(() => assertSafeProductionEnv({ NODE_ENV: 'test', MAIL_MAILER: 'log' }))
  })

  test('TRUST_PROXY defaults to loopback and refuses "trust everyone"', ({ assert }) => {
    for (const raw of [undefined, '  ']) {
      const trust = parseTrustProxy(raw) as TrustProxyFn
      assert.isTrue(trust('127.0.0.1', 0))
      assert.isTrue(trust('::1', 0))
      assert.isFalse(trust('10.1.2.3', 0))
    }
    assert.isFalse(parseTrustProxy('false'))
    assert.throws(() => parseTrustProxy('true'), /TRUST_PROXY=true is not allowed/)
    assert.throws(() => parseTrustProxy('*'), /TRUST_PROXY=true is not allowed/)
    assert.throws(() => parseTrustProxy('loopback, not-an-ip'), /TRUST_PROXY is invalid/)
  })

  test('a TRUST_PROXY list works through the HTTP server config', ({ assert }) => {
    const { trustProxy } = defineConfig({ trustProxy: parseTrustProxy('loopback, 10.0.0.0/8 ') })
    const clientIp = (peer: string, forwardedFor: string) =>
      proxyaddr(
        {
          headers: { 'x-forwarded-for': forwardedFor },
          connection: { remoteAddress: peer },
          socket: { remoteAddress: peer },
        } as never,
        trustProxy
      )

    assert.equal(clientIp('127.0.0.1', '198.51.100.9'), '198.51.100.9')
    assert.equal(clientIp('10.20.30.40', '198.51.100.9'), '198.51.100.9')
    // Chain: client → 10.x proxy → loopback proxy → app.
    assert.equal(clientIp('127.0.0.1', '198.51.100.9, 10.0.0.5'), '198.51.100.9')
    // An untrusted peer cannot choose its IP.
    assert.equal(clientIp('198.51.100.50', '1.2.3.4'), '198.51.100.50')
  })

  test('TRUST_PROXY refuses lists that trust public addresses', ({ assert }) => {
    assert.throws(() => parseTrustProxy('0.0.0.0/1, 128.0.0.0/1'), /public address 1\.1\.1\.1/)
    assert.throws(() => parseTrustProxy('loopback, 1.0.0.0/8'), /public address 1\.1\.1\.1/)
    assert.throws(() => parseTrustProxy('2000::/3'), /public address 2606:4700::1/)
    assert.throws(() => parseTrustProxy('1.1.1.1'), /public address 1\.1\.1\.1/)
    assert.doesNotThrow(() => parseTrustProxy('loopback, uniquelocal, linklocal'))
  })
})

test.group('Log mail transport', () => {
  const message = {
    to: [{ address: 'salma.idrissi@example.test', name: 'Salma' }, 'karim@example.test'],
    from: 'no-reply@bfk.local',
    subject: 'Invitation',
    text: 'Accept: https://bfk.test/invitations/SECRET-TOKEN',
  } as unknown as NodeMailerMessage

  function capture() {
    const entries: Record<string, unknown>[] = []
    const logger = { info: (data: Record<string, unknown>) => void entries.push(data) }
    return { entries, logger: logger as never }
  }

  test('masks emails', ({ assert }) => {
    assert.equal(maskEmail('salma.idrissi@example.test'), 's***@example.test')
    assert.equal(maskEmail('not-an-email'), '***')
  })

  test('logs subject and masked recipients but not the body by default', async ({ assert }) => {
    const { entries, logger } = capture()
    await new LogTransport({ logger }).send(message)

    assert.lengthOf(entries, 1)
    assert.deepEqual(entries[0].to, ['s***@example.test', 'k***@example.test'])
    assert.equal(entries[0].subject, 'Invitation')
    assert.notProperty(entries[0], 'text')
    assert.notInclude(JSON.stringify(entries[0]), 'SECRET-TOKEN')
    assert.notInclude(JSON.stringify(entries[0]), 'salma.idrissi')
  })

  test('logs the body only when explicitly enabled', async ({ assert }) => {
    const { entries, logger } = capture()
    await new LogTransport({ logger, logBody: true }).send(message)
    assert.include(String(entries[0].text), 'SECRET-TOKEN')
  })
})
