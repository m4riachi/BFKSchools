import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import type { IncomingHttpHeaders } from 'node:http'
import type { Readable } from 'node:stream'

/**
 * Downloads a small text resource from a URL typed by a staff member, with an
 * SSRF guard (docs/STACK_NOTES.md §10: never use node-ical's `fromURL`):
 * - `https:` only, default port 443 only, no credentials in the URL;
 * - every address the host name resolves to must be public: loopback,
 *   private, link-local (cloud metadata 169.254.169.254), CGNAT, multicast,
 *   reserved, IPv4-mapped/NAT64/6to4 forms of those… are refused;
 * - the connection goes to the **vetted** address (pinned through the
 *   `lookup` option), so a DNS answer cannot change between check and connect;
 * - redirects are followed by hand (at most `maxRedirects`), each target
 *   re-checked with the same rules;
 * - one overall timeout (connect + redirects + body) and a body size cap.
 */

export type FetchErrorReason =
  | 'invalid_url'
  | 'not_https'
  | 'forbidden_port'
  | 'credentials'
  | 'blocked_address'
  | 'dns_failed'
  | 'too_many_redirects'
  | 'bad_status'
  | 'too_large'
  | 'timeout'
  | 'network'

export class SafeFetchError extends Error {
  constructor(readonly reason: FetchErrorReason) {
    super(`URL fetch refused: ${reason}`)
  }
}

export type ResolvedAddress = { address: string; family: 4 | 6 }

/** One HTTP exchange against an already vetted address. Replaceable in tests. */
export type Transport = (
  url: URL,
  address: ResolvedAddress,
  signal: AbortSignal
) => Promise<{ status: number; headers: IncomingHttpHeaders; body: Readable }>

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>

export type SafeFetchOptions = { maxBytes: number; timeoutMs: number; maxRedirects: number }

const blocked = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 96], // unspecified + deprecated IPv4-compatible (::a.b.c.d)
  ['::1', 128], // loopback
  ['::ffff:0:0:0', 96], // IPv4-translated (SIIT)
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo, ORCHID…)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local (deprecated)
  ['ff00::', 8], // multicast
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6')
}

/**
 * The IPv4 address embedded in an IPv4-mapped IPv6 address
 * (`::ffff:127.0.0.1`, or the normalized hex form `::ffff:7f00:1`).
 * Not done with BlockList: Node's BlockList matches every IPv4 address
 * against a `::ffff:0:0/96` rule, which would block all of IPv4.
 */
function mappedIpv4(address: string): string | null {
  let canonical: string
  try {
    // WHATWG URL serializes IPv6 in canonical compressed form: ::ffff:7f00:1
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1).toLowerCase()
  } catch {
    return null
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(canonical)
  if (!hex) return null
  const high = Number.parseInt(hex[1], 16)
  const low = Number.parseInt(hex[2], 16)
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
}

/** Whether an IP literal may be contacted (public unicast only). */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  if (family === 6) {
    const mapped = mappedIpv4(address)
    if (mapped) return isPublicAddress(mapped)
    return !blocked.check(address, 'ipv6')
  }
  return false
}

const defaultResolver: Resolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true })
  return results.map((entry) => ({ address: entry.address, family: entry.family === 6 ? 6 : 4 }))
}

const defaultTransport: Transport = (url, address, signal) =>
  new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        signal,
        // A fresh socket per request (no pooled connection to another host)
        // and a bounded header block.
        agent: false,
        maxHeaderSize: 16 * 1024,
        headers: {
          'accept': 'text/calendar, text/plain;q=0.8',
          'user-agent': 'BFK-School-Meals/1.0',
        },
        // Connect to the vetted address only; TLS still checks the certificate
        // against the URL's host name.
        lookup: (_hostname, options, callback) => {
          if ((options as { all?: boolean }).all) {
            ;(callback as (e: null, a: { address: string; family: number }[]) => void)(null, [
              { address: address.address, family: address.family },
            ])
          } else {
            ;(callback as (e: null, a: string, f: number) => void)(
              null,
              address.address,
              address.family
            )
          }
        },
      },
      (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res })
    )
    req.on('error', reject)
    req.end()
  })

export default class SafeHttpFetcher {
  constructor(
    protected resolver: Resolver = defaultResolver,
    protected transport: Transport = defaultTransport
  ) {}

  /** Checks a URL without connecting (scheme, port, credentials, IP literal). */
  static parse(raw: string): URL {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      throw new SafeFetchError('invalid_url')
    }
    if (url.protocol !== 'https:') throw new SafeFetchError('not_https')
    if (url.username || url.password) throw new SafeFetchError('credentials')
    if (url.port && url.port !== '443') throw new SafeFetchError('forbidden_port')
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) && !isPublicAddress(host)) throw new SafeFetchError('blocked_address')
    if (!host || host === 'localhost' || host.endsWith('.localhost')) {
      throw new SafeFetchError('blocked_address')
    }
    return url
  }

  protected async vet(url: URL): Promise<ResolvedAddress> {
    const host = url.hostname.replace(/^\[|\]$/g, '')
    const literal = isIP(host)
    let addresses: ResolvedAddress[]
    if (literal) {
      addresses = [{ address: host, family: literal === 6 ? 6 : 4 }]
    } else {
      try {
        addresses = await this.resolver(host)
      } catch {
        throw new SafeFetchError('dns_failed')
      }
    }
    if (addresses.length === 0) throw new SafeFetchError('dns_failed')
    // Every answer must be public: otherwise the OS could pick a private one.
    if (!addresses.every((entry) => isPublicAddress(entry.address))) {
      throw new SafeFetchError('blocked_address')
    }
    return addresses[0]
  }

  async fetchText(raw: string, options: SafeFetchOptions): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs)
    const timeout = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new SafeFetchError('timeout')), {
        once: true,
      })
    })
    try {
      return await Promise.race([this.run(raw, options, controller.signal), timeout])
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }

  protected async run(
    raw: string,
    options: SafeFetchOptions,
    signal: AbortSignal
  ): Promise<string> {
    let url = SafeHttpFetcher.parse(raw)
    for (let hop = 0; ; hop++) {
      const address = await this.vet(url)
      let response: Awaited<ReturnType<Transport>>
      try {
        response = await this.transport(url, address, signal)
      } catch (error) {
        if (signal.aborted) throw new SafeFetchError('timeout')
        if (error instanceof SafeFetchError) throw error
        throw new SafeFetchError('network')
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        response.body.destroy()
        if (hop >= options.maxRedirects) throw new SafeFetchError('too_many_redirects')
        const location = response.headers.location
        if (!location) throw new SafeFetchError('bad_status')
        try {
          url = SafeHttpFetcher.parse(new URL(location, url).toString())
        } catch (error) {
          throw error instanceof SafeFetchError ? error : new SafeFetchError('invalid_url')
        }
        continue
      }
      if (response.status < 200 || response.status >= 300) {
        response.body.destroy()
        throw new SafeFetchError('bad_status')
      }
      const declared = Number(response.headers['content-length'])
      if (Number.isFinite(declared) && declared > options.maxBytes) {
        response.body.destroy()
        throw new SafeFetchError('too_large')
      }
      return this.readBody(response.body, options.maxBytes)
    }
  }

  protected async readBody(body: Readable, maxBytes: number): Promise<string> {
    const chunks: Buffer[] = []
    let size = 0
    try {
      for await (const chunk of body) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
        size += buffer.length
        if (size > maxBytes) {
          body.destroy()
          throw new SafeFetchError('too_large')
        }
        chunks.push(buffer)
      }
    } catch (error) {
      if (error instanceof SafeFetchError) throw error
      throw new SafeFetchError('network')
    }
    return Buffer.concat(chunks).toString('utf8')
  }
}
