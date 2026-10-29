/**
 * Startup checks and parsers for environment values that matter for
 * security. Kept free of framework imports so they can be unit-tested and
 * called from `start/env.ts`.
 */

import proxyaddr from 'proxy-addr'
import { s3PublicOrigin } from '#support/storage_origin'

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
 * are optional otherwise, so dev and test run without them). In production
 * S3_ENDPOINT must be https, and the bucket origin used by the CSP must be
 * computable (s3PublicOrigin throws otherwise, e.g. a bad S3_PUBLIC_ORIGIN).
 */
export function assertDriveEnv(values: {
  NODE_ENV?: string
  DRIVE_DISK: string
  S3_ACCESS_KEY_ID?: string
  S3_SECRET_ACCESS_KEY?: string
  S3_REGION?: string
  S3_BUCKET?: string
  S3_ENDPOINT?: string
  S3_FORCE_PATH_STYLE?: boolean
  S3_PUBLIC_ORIGIN?: string
}) {
  if (values.DRIVE_DISK !== 's3') return
  const missing = (
    ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION', 'S3_BUCKET'] as const
  ).filter((name) => !values[name])
  if (missing.length) {
    throw new Error(`DRIVE_DISK=s3 requires ${missing.join(', ')}.`)
  }
  if (
    values.NODE_ENV === 'production' &&
    values.S3_ENDPOINT &&
    !values.S3_ENDPOINT.toLowerCase().startsWith('https://')
  ) {
    throw new Error('S3_ENDPOINT must use https in production.')
  }
  s3PublicOrigin(values)
}

/**
 * Address blocks a trusted-proxy entry may cover at any size: loopback,
 * private, CGNAT, link-local and IPv6 unique-local / link-local ranges.
 */
const PRIVATE_BLOCKS: { family: 4 | 6; cidr: string }[] = [
  { family: 4, cidr: '127.0.0.0/8' },
  { family: 4, cidr: '10.0.0.0/8' },
  { family: 4, cidr: '172.16.0.0/12' },
  { family: 4, cidr: '192.168.0.0/16' },
  { family: 4, cidr: '100.64.0.0/10' },
  { family: 4, cidr: '169.254.0.0/16' },
  { family: 6, cidr: '::1/128' },
  { family: 6, cidr: 'fc00::/7' },
  { family: 6, cidr: 'fe80::/10' },
]

/**
 * Smallest prefix length accepted for a public range: wide enough for the
 * published ranges of CDNs/load balancers (Cloudflare uses IPv4 /13 and
 * IPv6 /29), narrow enough that "trust the Internet" lists such as
 * `0.0.0.0/1, 128.0.0.0/1` or `2000::/3` are refused.
 */
export const MIN_PUBLIC_PREFIX = { 4: 12, 6: 28 } as const

type ParsedRange = { family: 4 | 6; network: bigint; prefix: number }

function parseIpv4(value: string): bigint | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  let out = 0n
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null
    out = (out << 8n) | BigInt(Number(part))
  }
  return out
}

function parseIpv6(value: string): bigint | null {
  let host: string
  try {
    // WHATWG URL canonicalizes the address (IPv4-mapped tails become hex).
    host = new URL(`http://[${value}]/`).hostname.slice(1, -1)
  } catch {
    return null
  }
  const [head, tail] = host.includes('::') ? host.split('::') : [host, null]
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (tail === null && missing !== 0)) return null
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  let out = 0n
  for (const group of groups) out = (out << 16n) | BigInt(Number.parseInt(group || '0', 16))
  return out
}

function maskToPrefix(mask: string): number | null {
  const bits = parseIpv4(mask)
  if (bits === null) return null
  const binary = bits.toString(2).padStart(32, '0')
  if (!/^1*0*$/.test(binary)) return null
  const firstZero = binary.indexOf('0')
  return firstZero === -1 ? 32 : firstZero
}

/** Parses `addr`, `addr/len` or `addr/netmask` (the forms proxy-addr accepts). */
export function parseRange(entry: string): ParsedRange | null {
  const [address, suffix] = entry.split('/')
  const v4 = parseIpv4(address)
  const family: 4 | 6 = v4 !== null ? 4 : 6
  const bits = v4 ?? parseIpv6(address)
  if (bits === null) return null
  const width = family === 4 ? 32 : 128
  let prefix = width
  if (suffix !== undefined) {
    prefix = /^\d{1,3}$/.test(suffix)
      ? Number(suffix)
      : family === 4
        ? (maskToPrefix(suffix) ?? -1)
        : -1
    if (prefix < 0 || prefix > width) return null
  }
  // An IPv4-mapped IPv6 range (::ffff:a.b.c.d/96+) is an IPv4 range.
  if (family === 6 && prefix >= 96 && bits >> 32n === 0xffffn) {
    return toNetwork({ family: 4, network: bits & 0xffffffffn, prefix: prefix - 96 })
  }
  return toNetwork({ family, network: bits, prefix })
}

function toNetwork(range: ParsedRange): ParsedRange {
  const width = range.family === 4 ? 32n : 128n
  const host = width - BigInt(range.prefix)
  return { ...range, network: (range.network >> host) << host }
}

function isInside(inner: ParsedRange, outer: ParsedRange) {
  if (inner.family !== outer.family || inner.prefix < outer.prefix) return false
  const width = inner.family === 4 ? 32n : 128n
  const host = width - BigInt(outer.prefix)
  return inner.network >> host === outer.network >> host
}

const PRIVATE_RANGES = PRIVATE_BLOCKS.map((block) => parseRange(block.cidr)!)

/**
 * Why a TRUST_PROXY entry is refused, or null when it is acceptable: a
 * keyword (`loopback`, `linklocal`, `uniquelocal`), a range inside a
 * private block, or a public range no wider than MIN_PUBLIC_PREFIX.
 */
export function trustProxyEntryIssue(entry: string): string | null {
  if (['loopback', 'linklocal', 'uniquelocal'].includes(entry.toLowerCase())) return null
  const range = parseRange(entry)
  if (!range) return `"${entry}" is not an IP address or CIDR range`
  if (PRIVATE_RANGES.some((block) => isInside(range, block))) return null
  if (range.prefix < MIN_PUBLIC_PREFIX[range.family]) {
    return `"${entry}" covers too many public addresses (at most /${MIN_PUBLIC_PREFIX[range.family]} for IPv${range.family})`
  }
  return null
}

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
 * `true` / `*` (trust any hop), and any entry covering a wide public range
 * (shorter prefix than MIN_PUBLIC_PREFIX), are refused: they would let
 * clients choose the IP used for rate limiting. A single public proxy
 * address or a CDN's published ranges are accepted.
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

  for (const entry of list) {
    const issue = trustProxyEntryIssue(entry)
    if (issue) throw new Error(`TRUST_PROXY must only list your own proxies: ${issue}.`)
  }
  return trust
}

/** localhost, 127.0.0.0/8 or ::1 (an SMTP relay on the same host). */
export function isLoopbackHost(host: string | undefined): boolean {
  const value = (host ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  return value === 'localhost' || value === '::1' || /^127(\.\d{1,3}){3}$/.test(value)
}

/**
 * TLS options of the SMTP transport (security review M2):
 * - `SMTP_SECURE=true` → implicit TLS from the first byte (port 465);
 * - otherwise, in production, STARTTLS is **required** (`requireTLS`): a
 *   server or a man-in-the-middle that strips STARTTLS makes the send fail
 *   instead of sending the login and the invitation/reset links in clear —
 *   except for a relay on the same host (loopback), where there is no wire.
 * In development (Mailpit on 127.0.0.1:1025) nothing is required.
 */
export function smtpTlsOptions(values: {
  NODE_ENV?: string
  SMTP_HOST?: string
  SMTP_SECURE?: boolean
}): { secure: boolean; requireTLS: boolean } {
  const secure = values.SMTP_SECURE === true
  const requireTLS =
    !secure && values.NODE_ENV === 'production' && !isLoopbackHost(values.SMTP_HOST ?? '127.0.0.1')
  return { secure, requireTLS }
}
