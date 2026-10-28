/**
 * Startup checks and parsers for environment values that matter for
 * security. Kept free of framework imports so they can be unit-tested and
 * called from `start/env.ts`.
 */

import proxyaddr from 'proxy-addr'

/**
 * Refuses settings that are only acceptable in development.
 *
 * - `MAIL_MAILER=log` writes mails to the application log instead of sending
 *   them; in production that silently drops every email and would put
 *   invitation / password-reset links in the logs.
 */
export function assertSafeProductionEnv(values: { NODE_ENV: string; MAIL_MAILER: string }) {
  if (values.NODE_ENV === 'production' && values.MAIL_MAILER === 'log') {
    throw new Error(
      'MAIL_MAILER=log is not allowed in production: configure MAIL_MAILER=smtp with SMTP_HOST/SMTP_PORT.'
    )
  }
}

/**
 * DRIVE_DISK=s3 needs the bucket, region and credentials (the S3 variables
 * are optional otherwise, so dev and test run without them).
 */
export function assertDriveEnv(values: {
  DRIVE_DISK: string
  S3_ACCESS_KEY_ID?: string
  S3_SECRET_ACCESS_KEY?: string
  S3_REGION?: string
  S3_BUCKET?: string
}) {
  if (values.DRIVE_DISK !== 's3') return
  const missing = (
    ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION', 'S3_BUCKET'] as const
  ).filter((name) => !values[name])
  if (missing.length) {
    throw new Error(`DRIVE_DISK=s3 requires ${missing.join(', ')}.`)
  }
}

/**
 * Public addresses that no trusted proxy list may contain. If one of them is
 * trusted, (almost) any client can set X-Forwarded-For and choose the IP used
 * by the login rate limiters (e.g. `0.0.0.0/1, 128.0.0.0/1`).
 */
const PUBLIC_SAMPLES = ['1.1.1.1', '8.8.8.8', '203.0.113.1', '2606:4700::1', '2001:4860:4860::8888']

export type TrustProxyFn = (address: string, distance: number) => boolean

/**
 * Parses TRUST_PROXY into the `trustProxy` option of the HTTP server.
 * Returns `false` or a compiled proxy-addr function (the server passes
 * functions through as is; a plain string would NOT be split on commas).
 *
 * - empty / unset → `loopback`: trust X-Forwarded-For only when the TCP peer
 *   is 127.0.0.1/::1, i.e. a reverse proxy on the same host (nginx,
 *   Apache/Passenger on cPanel). A remote client can never spoof its IP.
 * - `false` → never trust X-Forwarded-For (app exposed directly).
 * - otherwise a comma-separated list of IPs, CIDRs or the proxy-addr names
 *   `loopback`, `linklocal`, `uniquelocal` (e.g. `loopback, 10.0.0.0/8`).
 *
 * `true` / `*` (trust any hop), and any list that trusts a public address,
 * are refused: they would let clients choose the IP used for rate limiting.
 */
export function parseTrustProxy(raw: string | undefined): TrustProxyFn | false {
  const value = (raw ?? '').trim()
  if (value.toLowerCase() === 'false') return false
  if (['true', '*'].includes(value.toLowerCase())) {
    throw new Error(
      'TRUST_PROXY=true is not allowed: list the proxy addresses instead (e.g. "loopback" or "10.0.0.0/8").'
    )
  }

  const list = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  let trust: TrustProxyFn
  try {
    trust = proxyaddr.compile(list.length > 0 ? list : ['loopback'])
  } catch (error) {
    throw new Error(`TRUST_PROXY is invalid: ${(error as Error).message}`)
  }

  const publicHit = PUBLIC_SAMPLES.find((address) => trust(address, 0))
  if (publicHit) {
    throw new Error(
      `TRUST_PROXY must only list your own proxies: it trusts the public address ${publicHit}.`
    )
  }
  return trust
}
