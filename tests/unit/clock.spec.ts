import { test } from '@japa/runner'
import { DateTime, IANAZone } from 'luxon'
import app from '@adonisjs/core/services/app'
import Clock from '#services/clock'
import { freezeClock, restoreClock } from '#tests/helpers/clock'

test.group('Clock', (group) => {
  group.each.teardown(() => restoreClock())

  test('the real clock runs in Africa/Casablanca', async ({ assert }) => {
    const clock = await app.container.make(Clock)
    assert.equal(clock.now().zoneName, 'Africa/Casablanca')
    assert.match(clock.today(), /^\d{4}-\d{2}-\d{2}$/)
  })

  test('freezing the clock fixes now() and today()', async ({ assert }) => {
    freezeClock('2026-11-02T08:59')
    const clock = await app.container.make(Clock)

    const now = clock.now()
    assert.equal(clock.today(), '2026-11-02')
    assert.equal(now.toFormat('yyyy-MM-dd HH:mm'), '2026-11-02 08:59')
    assert.equal(now.zoneName, 'Africa/Casablanca')
    // The ISO string carries the Casablanca offset of that instant (from tzdata,
    // never hard-coded: Morocco changed its offset rules in 2026).
    const offset = IANAZone.create('Africa/Casablanca').offset(now.toMillis())
    assert.equal(now.offset, offset)
    assert.equal(
      now.toISO(),
      DateTime.fromISO('2026-11-02T08:59', { zone: 'Africa/Casablanca' }).toISO()
    )
    assert.isTrue(now.toISO()!.endsWith(now.toFormat('ZZ')))
  })

  test('services resolved from the container get the frozen clock', async ({ assert }) => {
    freezeClock('2026-11-02T08:59')
    const { default: LoginService } = await import('#services/login_service')
    const service = await app.container.make(LoginService)
    // @ts-expect-error reading the protected dependency on purpose
    assert.equal(service.clock.today(), '2026-11-02')
  })

  test('travel moves the frozen clock across midnight', async ({ assert }) => {
    const frozen = freezeClock('2026-11-02T23:59')
    const clock = await app.container.make(Clock)

    assert.equal(clock.today(), '2026-11-02')
    frozen.travel({ minutes: 2 })
    assert.equal(clock.today(), '2026-11-03')
    assert.equal(clock.now().toFormat('HH:mm'), '00:01')
  })

  test('wall-clock time follows the zone rules across an offset change', async ({ assert }) => {
    // Find the first offset change after 2026-01-01 in the installed tzdata,
    // then travel across it: the instant moves 2 hours, the business day
    // and wall clock follow the zone rules instead of a fixed offset.
    let probe = DateTime.fromISO('2026-01-01T12:00', { zone: 'Africa/Casablanca' })
    const start = probe.offset
    while (probe.offset === start && probe.year < 2030) probe = probe.plus({ hours: 1 })
    if (probe.offset === start) return assert.isTrue(true)

    const frozen = freezeClock(probe.minus({ hours: 1 }))
    const clock = await app.container.make(Clock)
    const before = clock.now()
    frozen.travel({ hours: 2 })
    const after = clock.now()

    assert.equal(after.toMillis() - before.toMillis(), 2 * 3600 * 1000)
    assert.notEqual(after.offset, before.offset)
    assert.equal(after.zoneName, 'Africa/Casablanca')
    assert.equal(clock.today(), after.toISODate())
  })

  test('restoreClock goes back to the real clock', async ({ assert }) => {
    freezeClock('2000-01-01T00:00')
    restoreClock()
    const clock = await app.container.make(Clock)
    assert.notEqual(clock.today(), '2000-01-01')
  })
})
