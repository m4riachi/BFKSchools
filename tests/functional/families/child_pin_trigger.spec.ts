import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { SchoolFactory } from '#database/factories/school_factory'
import { UserFactory } from '#database/factories/user_factory'

async function makeParent() {
  const school = await SchoolFactory.create()
  const parent = await UserFactory.apply('parent').merge({ schoolId: school.id }).create()
  return { school, parent }
}

function insertChild(schoolId: number, parentId: number, extra: Record<string, unknown> = {}) {
  return db
    .table('children')
    .insert({
      school_id: schoolId,
      parent_id: parentId,
      first_name: `Test${Math.random()}`,
      last_name: 'Child',
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
      ...extra,
    })
    .returning(['id', 'pin', 'is_active'])
}

test.group('Families | children.pin trigger (D59 hardening)', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    return truncate
  })

  test('a staff-created child gets a 4-digit code, unique in the school', async ({ assert }) => {
    const { school, parent } = await makeParent()
    const pins = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const [row] = await insertChild(school.id, parent.id)
      assert.match(row.pin, /^\d{4}$/)
      pins.add(row.pin)
    }
    assert.equal(pins.size, 20)
  })

  test('a pending sign-up child has no code; activation assigns one; reactivation too', async ({
    assert,
  }) => {
    const { school, parent } = await makeParent()
    const [pending] = await insertChild(school.id, parent.id, {
      is_active: false,
      registration_pending: true,
    })
    assert.isNull(pending.pin)

    const [activated] = await db
      .from('children')
      .where('id', pending.id)
      .update({ is_active: true })
      .returning(['pin'])
    assert.match(activated.pin, /^\d{4}$/)

    // An inactive child created by staff keeps its code while deactivated, and an
    // active child can never lose it.
    await db.from('children').where('id', pending.id).update({ is_active: false })
    const stored = await db.from('children').where('id', pending.id).firstOrFail()
    assert.equal(stored.pin, activated.pin)

    const [refused] = await insertChild(school.id, parent.id, {
      is_active: false,
      registration_pending: true,
    })
    const [reactivated] = await db
      .from('children')
      .where('id', refused.id)
      .update({ is_active: true, registration_pending: false })
      .returning(['pin'])
    assert.match(reactivated.pin, /^\d{4}$/)
  })

  test('the CHECK refuses an active child without a code', async ({ assert }) => {
    const { school, parent } = await makeParent()
    const [row] = await insertChild(school.id, parent.id)
    try {
      await db.rawQuery('UPDATE children SET pin = NULL WHERE id = ?', [row.id])
      // The trigger re-assigns a code: an active child never ends up without one.
      const after = await db.from('children').where('id', row.id).firstOrFail()
      assert.match(after.pin, /^\d{4}$/)
    } catch (error) {
      assert.match(String((error as Error).message), /children_active_has_pin_check/)
    }
  })

  test('a school with all 10,000 codes used raises children_no_free_pin instead of looping', async ({
    assert,
  }) => {
    const { school, parent } = await makeParent()
    await db.rawQuery(
      `INSERT INTO children (school_id, parent_id, first_name, last_name, is_active, pin, created_at, updated_at)
       SELECT ?, ?, 'F' || n, 'C', false, lpad(n::text, 4, '0'), now(), now() FROM generate_series(0, 9999) n`,
      [school.id, parent.id]
    )
    let message = ''
    try {
      await insertChild(school.id, parent.id)
    } catch (error) {
      message = String((error as Error).message)
    }
    assert.include(message, 'children_no_free_pin')

    // Another school is not affected.
    const other = await makeParent()
    const [row] = await insertChild(other.school.id, other.parent.id)
    assert.match(row.pin, /^\d{4}$/)
  }).timeout(60000)

  test('with 9,990 codes used the fallback scan still finds a free one', async ({ assert }) => {
    const { school, parent } = await makeParent()
    await db.rawQuery(
      `INSERT INTO children (school_id, parent_id, first_name, last_name, is_active, pin, created_at, updated_at)
       SELECT ?, ?, 'F' || n, 'C', false, lpad(n::text, 4, '0'), now(), now() FROM generate_series(0, 9989) n`,
      [school.id, parent.id]
    )
    const [row] = await insertChild(school.id, parent.id)
    assert.isAtLeast(Number(row.pin), 9990)
  }).timeout(60000)
})
