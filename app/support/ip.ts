import { isIPv4, isIPv6 } from 'node:net'

/**
 * Key used to rate-limit a client address.
 *
 * - IPv4 (and IPv4-mapped IPv6 such as `::ffff:1.2.3.4`) → the address itself.
 * - IPv6 → its /64 prefix, e.g. `2001:db8:1:2::/64`. One subscriber usually
 *   gets a whole /64, so keying on the full address would let a client rotate
 *   through billions of addresses to dodge the limit.
 */
export function rateLimitIpKey(ip: string): string {
  const address = ip.split('%')[0].trim().toLowerCase()

  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (mapped && isIPv4(mapped[1])) return mapped[1]
  if (!isIPv6(address)) return address

  return `${expandIPv6(address).slice(0, 4).join(':')}::/64`
}

/** Returns the 8 hextets of a valid IPv6 address, without leading zeros. */
function expandIPv6(address: string): string[] {
  let text = address

  // Trailing embedded IPv4 (e.g. 64:ff9b::1.2.3.4) → two hextets.
  const v4 = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/)
  if (v4) {
    const [a, b, c, d] = v4[1].split('.').map(Number)
    text =
      text.slice(0, -v4[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const [head, tail] = text.split('::')
  const left = head ? head.split(':') : []
  const right = tail !== undefined && tail !== '' ? tail.split(':') : []
  const zeros = tail === undefined ? [] : Array(8 - left.length - right.length).fill('0')

  return [...left, ...zeros, ...right].map((part) => Number.parseInt(part, 16).toString(16))
}
