import { test } from '@japa/runner'
import { Readable } from 'node:stream'
import SafeHttpFetcher, {
  SafeFetchError,
  isPublicAddress,
  type ResolvedAddress,
  type Transport,
} from '#services/safe_http_fetcher'

const OPTIONS = { maxBytes: 1024, timeoutMs: 200, maxRedirects: 3 }

/** Fake DNS: host name → addresses. */
function resolver(map: Record<string, string[]>) {
  return async (hostname: string): Promise<ResolvedAddress[]> => {
    const list = map[hostname]
    if (!list) throw new Error('ENOTFOUND')
    return list.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))
  }
}

type FakeResponse = { status: number; headers?: Record<string, string>; body?: string | Readable }

/** Fake HTTP: records every contacted (url, address) and answers from a table. */
function transport(routes: Record<string, FakeResponse | 'hang'>) {
  const calls: { url: string; address: string }[] = []
  const fn: Transport = async (url, address, signal) => {
    calls.push({ url: url.toString(), address: address.address })
    const route = routes[url.toString()]
    if (!route) throw new Error('unexpected request')
    if (route === 'hang') {
      return new Promise((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted')))
      )
    }
    const body =
      route.body instanceof Readable ? route.body : Readable.from([Buffer.from(route.body ?? '')])
    return { status: route.status, headers: route.headers ?? {}, body }
  }
  return { fn, calls }
}

async function reason(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    if (error instanceof SafeFetchError) return error.reason
    throw error
  }
  return 'ok'
}

const PUBLIC = { 'calendar.example.org': ['93.184.215.14'] }

test.group('SafeHttpFetcher | SSRF guard', () => {
  test('refuses {$self}')
    .with([
      'http://calendar.example.org/school.ics',
      'ftp://calendar.example.org/school.ics',
      'https://127.0.0.1/school.ics',
      'https://10.1.2.3/school.ics',
      'https://169.254.169.254/latest/meta-data/',
      'https://192.168.1.10/a.ics',
      'https://[::1]/a.ics',
      'https://[::ffff:127.0.0.1]/a.ics',
      'https://0x7f.1/a.ics',
      'https://localhost/a.ics',
      'https://calendar.example.org:8443/a.ics',
      'https://user:secret@calendar.example.org/a.ics',
    ])
    .run(async ({ assert }, url) => {
      const fake = transport({})
      const fetcher = new SafeHttpFetcher(resolver(PUBLIC), fake.fn)
      assert.notEqual(await reason(fetcher.fetchText(url, OPTIONS)), 'ok')
      assert.lengthOf(fake.calls, 0, 'no connection attempted')
    })

  test('refuses a host name that resolves to a private address (any answer)', async ({
    assert,
  }) => {
    const fake = transport({})
    const fetcher = new SafeHttpFetcher(
      resolver({
        'internal.example.org': ['10.0.0.5'],
        'mixed.example.org': ['93.184.215.14', '127.0.0.1'],
        'metadata.example.org': ['fd00::1'],
      }),
      fake.fn
    )
    for (const host of ['internal.example.org', 'mixed.example.org', 'metadata.example.org']) {
      assert.equal(
        await reason(fetcher.fetchText(`https://${host}/a.ics`, OPTIONS)),
        'blocked_address'
      )
    }
    assert.lengthOf(fake.calls, 0)
  })

  test('downloads from a public host, connecting to the vetted address', async ({ assert }) => {
    const fake = transport({
      'https://calendar.example.org/school.ics': { status: 200, body: 'BEGIN:VCALENDAR' },
    })
    const fetcher = new SafeHttpFetcher(resolver(PUBLIC), fake.fn)
    assert.equal(
      await fetcher.fetchText('https://calendar.example.org/school.ics', OPTIONS),
      'BEGIN:VCALENDAR'
    )
    assert.deepEqual(fake.calls, [
      { url: 'https://calendar.example.org/school.ics', address: '93.184.215.14' },
    ])
  })

  test('re-checks every redirect target', async ({ assert }) => {
    const fake = transport({
      'https://calendar.example.org/a.ics': {
        status: 302,
        headers: { location: 'https://internal.example.org/a.ics' },
      },
      'https://calendar.example.org/b.ics': {
        status: 301,
        headers: { location: 'https://169.254.169.254/latest/meta-data/' },
      },
      'https://calendar.example.org/c.ics': {
        status: 307,
        headers: { location: 'http://calendar.example.org/c.ics' },
      },
    })
    const fetcher = new SafeHttpFetcher(
      resolver({ ...PUBLIC, 'internal.example.org': ['10.0.0.5'] }),
      fake.fn
    )
    assert.equal(
      await reason(fetcher.fetchText('https://calendar.example.org/a.ics', OPTIONS)),
      'blocked_address'
    )
    assert.equal(
      await reason(fetcher.fetchText('https://calendar.example.org/b.ics', OPTIONS)),
      'blocked_address'
    )
    assert.equal(
      await reason(fetcher.fetchText('https://calendar.example.org/c.ics', OPTIONS)),
      'not_https'
    )
    assert.isTrue(fake.calls.every((call) => call.address === '93.184.215.14'))
  })

  test('stops after too many redirects', async ({ assert }) => {
    const fake = transport({
      'https://calendar.example.org/loop.ics': {
        status: 302,
        headers: { location: '/loop.ics' },
      },
    })
    const fetcher = new SafeHttpFetcher(resolver(PUBLIC), fake.fn)
    assert.equal(
      await reason(fetcher.fetchText('https://calendar.example.org/loop.ics', OPTIONS)),
      'too_many_redirects'
    )
    assert.lengthOf(fake.calls, OPTIONS.maxRedirects + 1)
  })

  test('refuses bodies above the size limit (declared or streamed)', async ({ assert }) => {
    const fake = transport({
      'https://calendar.example.org/declared.ics': {
        status: 200,
        headers: { 'content-length': '999999' },
        body: '',
      },
      'https://calendar.example.org/streamed.ics': {
        status: 200,
        body: Readable.from([Buffer.alloc(600), Buffer.alloc(600)]),
      },
    })
    const fetcher = new SafeHttpFetcher(resolver(PUBLIC), fake.fn)
    for (const path of ['declared', 'streamed']) {
      assert.equal(
        await reason(fetcher.fetchText(`https://calendar.example.org/${path}.ics`, OPTIONS)),
        'too_large'
      )
    }
  })

  test('times out on a slow server', async ({ assert }) => {
    const fake = transport({ 'https://calendar.example.org/slow.ics': 'hang' })
    const fetcher = new SafeHttpFetcher(resolver(PUBLIC), fake.fn)
    const started = Date.now()
    assert.equal(
      await reason(fetcher.fetchText('https://calendar.example.org/slow.ics', OPTIONS)),
      'timeout'
    )
    assert.isBelow(Date.now() - started, 2000)
  })

  test('non-2xx answers and unknown hosts are refused', async ({ assert }) => {
    const fake = transport({ 'https://calendar.example.org/missing.ics': { status: 404 } })
    const fetcher = new SafeHttpFetcher(resolver(PUBLIC), fake.fn)
    assert.equal(
      await reason(fetcher.fetchText('https://calendar.example.org/missing.ics', OPTIONS)),
      'bad_status'
    )
    assert.equal(
      await reason(fetcher.fetchText('https://nowhere.example.org/a.ics', OPTIONS)),
      'dns_failed'
    )
  })

  test('isPublicAddress', ({ assert }) => {
    for (const ip of ['93.184.215.14', '8.8.8.8', '2606:4700::1111'])
      assert.isTrue(isPublicAddress(ip))
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '172.16.5.4',
      '192.168.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
      '::7f00:1', // IPv4-compatible ::127.0.0.1
      '::a00:1',
      '::ffff:0:7f00:1', // IPv4-translated (SIIT)
      'not-an-ip',
    ]) {
      assert.isFalse(isPublicAddress(ip), ip)
    }
  })
})
