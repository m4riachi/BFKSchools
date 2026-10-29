/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import ace from '@adonisjs/core/services/ace'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import limiter from '@adonisjs/limiter/services/main'
import UsersCreateStaff from '#commands/users_create_staff'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'
import { pdfUserRenderGate } from '#support/render_gate'
import { assertDemoSeeding } from '#database/demo/support'
import { orderSchool, family } from '#tests/helpers/orders'
import { order } from '#tests/helpers/reports'
import { TUE } from '#tests/helpers/menus'

async function createStaff(args: string[], password?: string) {
  const previous = process.env.BFK_NEW_PASSWORD
  if (password === undefined) delete process.env.BFK_NEW_PASSWORD
  else process.env.BFK_NEW_PASSWORD = password
  try {
    ace.ui.switchMode('raw')
    const command = await ace.create(UsersCreateStaff, args)
    await command.exec()
    const logs = ace.ui.logger.getLogs().map((entry) => entry.message)
    ace.ui.logger.getLogs().length = 0
    return { command, logs }
  } finally {
    if (previous === undefined) delete process.env.BFK_NEW_PASSWORD
    else process.env.BFK_NEW_PASSWORD = previous
    ace.ui.switchMode('normal')
  }
}

test.group('Phase 9 QA | users:create-staff', (group) => {
  group.each.setup(() => testUtils.db().truncate())

  test('creates an admin with a hashed password; the password never appears in the output', async ({
    assert,
  }) => {
    await SchoolFactory.merge({ slug: 'britech-school' }).create()
    const secret = 'Secret-Pass-2026x'
    const { command, logs } = await createStaff(
      ['--email=First.Admin@Example.test', '--name=  Nadia   Lahlou ', '--role=admin'],
      secret
    )
    assert.equal(command.exitCode ?? 0, 0)
    const row = await db.from('users').where('email', 'first.admin@example.test').firstOrFail()
    assert.equal(row.role, 'admin')
    assert.equal(row.full_name, 'Nadia Lahlou')
    assert.isTrue(row.is_active)
    assert.notEqual(row.password, secret)
    assert.isTrue(await hash.verify(row.password, secret))
    assert.notInclude(logs.join('\n'), secret)
    assert.isNotNull(row.school_id)
  })

  test('weak passwords, bad roles/emails and unknown schools create nothing', async ({
    assert,
  }) => {
    await SchoolFactory.merge({ slug: 'britech-school' }).create()
    const base = ['--email=a@example.test', '--name=A B']
    for (const weak of ['short1', 'onlyletterspasswordx', '1234567890123', 'a1'.repeat(70)]) {
      const { command } = await createStaff([...base, '--role=admin'], weak)
      assert.equal(command.exitCode, 1, `weak: ${weak.slice(0, 12)}`)
    }
    assert.equal(
      (await createStaff([...base, '--role=parent'], 'Good-Pass-2026x')).command.exitCode,
      1
    )
    assert.equal(
      (await createStaff(['--email=not-an-email', '--name=A B', '--role=admin'], 'Good-Pass-2026x'))
        .command.exitCode,
      1
    )
    assert.equal(
      (await createStaff([...base, '--role=admin', '--school=nope'], 'Good-Pass-2026x')).command
        .exitCode,
      1
    )
    assert.equal(
      (await createStaff([...base, '--role=admin', '--locale=de'], 'Good-Pass-2026x')).command
        .exitCode,
      1
    )
    assert.lengthOf(await db.from('users'), 0)
  })

  test('an existing email (any case) is refused and the old password is untouched', async ({
    assert,
  }) => {
    const school = await SchoolFactory.merge({ slug: 'britech-school' }).create()
    const existing = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
    const before = await db.from('users').where('id', existing.id).firstOrFail()
    const { command } = await createStaff(
      [`--email=${existing.email.toUpperCase()}`, '--name=Eve', '--role=admin'],
      'Good-Pass-2026x'
    )
    assert.equal(command.exitCode, 1)
    const after = await db.from('users').where('id', existing.id).firstOrFail()
    assert.equal(after.password, before.password)
    assert.equal(after.role, 'manager')
    assert.lengthOf(await db.from('users'), 1)
  })
})

test.group('Phase 9 QA | demo seeders are refused in production', () => {
  test('assertDemoSeeding throws when NODE_ENV=production', ({ assert }) => {
    const previous = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = 'production'
      assert.throws(() => assertDemoSeeding(), /never run in production/)
    } finally {
      process.env.NODE_ENV = previous
    }
    assert.doesNotThrow(() => assertDemoSeeding())
  })
})

test.group('Phase 9 QA | D27 per-user PDF cap over HTTP', (group) => {
  group.each.setup(async () => {
    await limiter.clear(['memory'])
    return testUtils.db().truncate()
  })

  /** Occupies the user's gate: one running + one waiting (what two slow PDFs would do). */
  function occupy(userId: number) {
    let release!: () => void
    const hold = new Promise<void>((resolve) => (release = resolve))
    const first = pdfUserRenderGate.run(userId, async () => hold)
    const second = pdfUserRenderGate.run(userId, async () => hold)
    return async () => {
      release()
      await Promise.all([first, second])
    }
  }

  test('a third concurrent PDF of the same user is a 429 with Retry-After; others are fine', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    const other = await family(ctx.school)
    await order(other.parent, other.child, TUE, ctx.main.id)
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: ctx.school.id }).create()

    const free = occupy(ctx.manager.id)
    try {
      assert.equal(pdfUserRenderGate.inFlight(ctx.manager.id), 2)
      const labels = await client.get(`/kitchen/labels/pdf?date=${TUE}`).loginAs(ctx.manager)
      labels.assertStatus(429)
      assert.equal(labels.header('retry-after'), '5')
      assert.notInclude(String(labels.text()), '%PDF')

      // Same user, other PDF route (parent side is the same gate key = user id).
      const statement = await client.get('/statements/pdf?month=2026-11').loginAs(ctx.manager)
      assert.notEqual(statement.status(), 200) // staff are refused (403) before any render

      // Other users are unaffected.
      const fine = await client.get(`/kitchen/labels/pdf?date=${TUE}`).loginAs(kitchen)
      fine.assertStatus(200)
      assert.equal(fine.header('content-type'), 'application/pdf')
      const own = await client.get('/statements/pdf?month=2026-11').loginAs(other.parent)
      own.assertStatus(200)
    } finally {
      await free()
    }
    assert.equal(pdfUserRenderGate.inFlight(ctx.manager.id), 0)

    // Once the user's renders finish the cap is gone.
    const again = await client.get(`/kitchen/labels/pdf?date=${TUE}`).loginAs(ctx.manager)
    again.assertStatus(200)
  })

  test('a parent holding two renders gets 429 on the statement PDF', async ({ client, assert }) => {
    const ctx = await orderSchool()
    const mine = await family(ctx.school)
    const free = occupy(mine.parent.id)
    try {
      const res = await client.get('/statements/pdf?month=2026-11').loginAs(mine.parent)
      res.assertStatus(429)
      assert.equal(res.header('retry-after'), '5')
    } finally {
      await free()
    }
  })
})
