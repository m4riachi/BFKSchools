import { test } from '@japa/runner'
import mail from '@adonisjs/mail/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import User from '#models/user'
import Child from '#models/child'
import Subscription from '#models/subscription'
import { UserFactory } from '#database/factories/user_factory'
import { CSV_COLUMNS } from '#services/family_import_service'
import { createChild, createParent, setupSchool } from '#tests/helpers/families'

const HEADER = CSV_COLUMNS.join(',')

function csv(...rows: string[]) {
  return Buffer.from(`${String.fromCodePoint(0xfeff)}${[HEADER, ...rows].join('\r\n')}\r\n`, 'utf8')
}

const VALID = csv(
  'Salma Idrissi,Salma@Example.com,+212 612 345 678,fr,Adam,Idrissi,G3,3B,gluten;MILK,2026-09-01,2027-06-11',
  'Salma Idrissi,salma@example.com,,,Lina,Idrissi,KG2,KG2-A,,2026-09-01,',
  'John Smith,john@example.com,,en,Emma,Smith,G5,5A,peanuts; nuts,,'
)

async function upload(client: any, manager: User, content: Buffer) {
  const response = await client
    .post('/admin/imports/families')
    .loginAs(manager)
    .file('file', content, { filename: 'families.csv', contentType: 'text/csv' })
    .withCsrfToken()
    .redirects(0)
  const location = response.header('location') as string
  const match = /^\/admin\/imports\/families\/([0-9a-f-]{36})$/.exec(location ?? '')
  if (!match) throw new Error(`Unexpected upload response: ${response.status()} ${location}`)
  return match[1]
}

async function preview(client: any, manager: User, id: string) {
  const response = await client.get(`/admin/imports/families/${id}`).loginAs(manager).withInertia()
  response.assertStatus(200)
  response.assertInertiaComponent('admin/imports/families')
  return (response.inertiaProps as any).plan
}

function confirm(client: any, manager: User, id: string, sendInvitations = false) {
  return client
    .post(`/admin/imports/families/${id}/confirm`)
    .loginAs(manager)
    .form({ sendInvitations })
    .withCsrfToken()
    .redirects(0)
}

test.group('Families | CSV import', (group) => {
  let mails: ReturnType<typeof mail.fake>['mails']
  group.each.setup(() => testUtils.db().truncate())
  group.each.setup(() => {
    mails = mail.fake().mails
    return () => mail.restore()
  })

  test('the template is downloadable and lists every column', async ({ client, assert }) => {
    const { manager } = await setupSchool()
    const response = await client.get('/admin/imports/families/template').loginAs(manager)
    response.assertStatus(200)
    assert.match(String(response.header('content-type')), /^text\/csv/)
    assert.match(
      String(response.header('content-disposition')),
      /attachment; filename="bfk-families-template.csv"/
    )
    assert.include(response.text(), HEADER)
  })

  test('valid rows: preview saves nothing, confirm saves everything grouped by email', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const id = await upload(client, manager, VALID)

    const plan = await preview(client, manager, id)
    assert.isTrue(plan.valid)
    assert.deepEqual(plan.fileErrors, [])
    assert.deepInclude(plan.summary, {
      rows: 3,
      invalidRows: 0,
      newParents: 2,
      newChildren: 3,
      newSubscriptions: 2,
    })
    assert.deepEqual(
      plan.rows.map((row: any) => [
        row.line,
        row.parentAction,
        row.childAction,
        row.subscriptionAction,
      ]),
      [
        [2, 'create', 'create', 'create'],
        [3, 'none', 'create', 'create'],
        [4, 'create', 'create', 'none'],
      ]
    )
    assert.lengthOf(await User.query().where('role', 'parent'), 0)
    assert.lengthOf(await Child.all(), 0)

    const response = await confirm(client, manager, id)
    assert.equal(response.header('location'), '/admin/parents')
    assert.match(String(response.flashMessage('success')), /^Import terminé : 2 parent/)

    const salma = await User.findByOrFail('email', 'salma@example.com')
    assert.equal(salma.schoolId, school.id)
    assert.equal(salma.phone, '+212612345678')
    assert.equal(salma.locale, 'fr')
    assert.isNull(salma.password)
    const john = await User.findByOrFail('email', 'john@example.com')
    assert.equal(john.locale, 'en')

    const salmaChildren = await Child.query().where('parent_id', salma.id).orderBy('first_name')
    assert.deepEqual(
      salmaChildren.map((c) => c.firstName),
      ['Adam', 'Lina']
    )
    assert.deepEqual(salmaChildren[0].allergies, ['gluten', 'milk'])
    const emma = await Child.findByOrFail('first_name', 'Emma')
    assert.deepEqual(emma.allergies, ['peanuts', 'nuts'])

    const lina = salmaChildren[1]
    const period = await Subscription.findByOrFail('child_id', lina.id)
    assert.equal(period.startDate, '2026-09-01')
    assert.isNull(period.endDate)
    mails.assertNoneSent()

    // The stored upload is gone after confirmation
    const again = await client.get(`/admin/imports/families/${id}`).loginAs(manager).redirects(0)
    assert.equal(again.header('location'), '/admin/imports/families')
  })

  test('re-importing the same file is idempotent', async ({ client, assert }) => {
    const { manager } = await setupSchool()
    await confirm(client, manager, await upload(client, manager, VALID))

    const id = await upload(client, manager, VALID)
    const plan = await preview(client, manager, id)
    assert.isTrue(plan.valid)
    assert.deepInclude(plan.summary, {
      newParents: 0,
      updatedParents: 0,
      newChildren: 0,
      updatedChildren: 0,
      newSubscriptions: 0,
    })
    await confirm(client, manager, id)

    assert.lengthOf(await User.query().where('role', 'parent'), 2)
    assert.lengthOf(await Child.all(), 3)
    assert.lengthOf(await Subscription.all(), 2)
  })

  test('re-import matches children case-insensitively and only adds allergies', async ({
    client,
    assert,
  }) => {
    const { school, manager } = await setupSchool()
    const parent = await createParent(school.id, {
      email: 'salma@example.com',
      fullName: 'Salma Idrissi',
    })
    const adam = await createChild(parent, {
      firstName: 'Adam',
      lastName: 'Idrissi',
      allergies: ['eggs'],
    })

    const id = await upload(
      client,
      manager,
      csv('Salma Idrissi,salma@example.com,,,ADAM,idrissi,G4,4A,milk,,')
    )
    const plan = await preview(client, manager, id)
    assert.deepEqual([plan.rows[0].parentAction, plan.rows[0].childAction], ['unchanged', 'update'])
    await confirm(client, manager, id)

    await adam.refresh()
    assert.lengthOf(await Child.query().where('parent_id', parent.id), 1)
    assert.deepEqual(adam.allergies, ['eggs', 'milk'])
    assert.equal(adam.grade, 'G4')
    assert.equal(adam.firstName, 'ADAM')
  })

  test('invalid rows are reported per row and nothing can be saved', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    await UserFactory.apply('kitchen').merge({ email: 'cook@example.com' }).create()
    const existing = await createParent(school.id, {
      email: 'busy@example.com',
      fullName: 'Busy Parent',
    })
    const child = await createChild(existing, { firstName: 'Sami', lastName: 'Busy' })
    await Subscription.create({
      childId: child.id,
      startDate: '2026-09-01',
      endDate: null,
      status: 'active',
    })

    const id = await upload(
      client,
      manager,
      csv(
        'Good Parent,good@example.com,,,Ok,Child,,,,,', // 2 ok
        ',missing-name@example.com,,,A,B,,,,,', // 3 name missing
        'Bad Email,not-an-email,,,A,B,,,,,', // 4
        'Bad Allergy,allergy@example.com,,,A,B,,,gluten;kiwi,,', // 5
        'Bad Dates,dates@example.com,,,A,B,,,,2026-13-01,', // 6
        'Reversed,rev@example.com,,,A,B,,,,2026-09-10,2026-09-01', // 7
        'Cook,cook@example.com,,,A,B,,,,,', // 8 staff email
        'Busy Parent,busy@example.com,,,Sami,Busy,,,,2027-01-01,2027-02-01', // 9 overlap
        'Good Parent,good@example.com,,,Ok,Child,,,,,', // 10 duplicate child
        'Other Name,good@example.com,,,Second,Child,,,,,', // 11 parent mismatch
        'Locale,locale@example.com,,de,A,B,,,,,' // 12 bad locale
      )
    )
    const plan = await preview(client, manager, id)
    assert.isFalse(plan.valid)
    const errorsByLine = Object.fromEntries(plan.rows.map((row: any) => [row.line, row.errors]))
    assert.deepEqual(errorsByLine[2], [])
    assert.match(errorsByLine[3][0], /^parent_full_name: /)
    assert.match(errorsByLine[4][0], /^parent_email: Saisissez une adresse e-mail valide/)
    assert.match(errorsByLine[5][0], /codes inconnus \(kiwi\)/)
    assert.match(errorsByLine[6][0], /^subscription_start: Saisissez une date/)
    assert.match(errorsByLine[7][0], /La fin doit être/)
    assert.match(errorsByLine[8][0], /compte du personnel/)
    assert.match(errorsByLine[9][0], /chevauche/)
    assert.match(errorsByLine[10][0], /apparaît déjà ligne 2/)
    assert.match(errorsByLine[11][0], /Même e-mail que la ligne 2/)
    assert.match(errorsByLine[12][0], /^parent_locale: /)
    assert.equal(plan.summary.invalidRows, 10)

    const response = await confirm(client, manager, id)
    assert.equal(response.header('location'), `/admin/imports/families/${id}`)
    assert.isNull(await User.findBy('email', 'good@example.com'))
  })

  test('file-level errors: missing columns, empty file, wrong format', async ({
    client,
    assert,
  }) => {
    const { manager } = await setupSchool()

    const missing = await upload(
      client,
      manager,
      Buffer.from('parent_email,child_first_name\nx@y.z,A\n')
    )
    const plan = await preview(client, manager, missing)
    assert.match(plan.fileErrors[0], /Colonnes manquantes : parent_full_name, child_last_name/)
    assert.isFalse(plan.valid)

    const headerOnly = await upload(client, manager, csv())
    const headerPlan = await preview(client, manager, headerOnly)
    assert.match(headerPlan.fileErrors[0], /aucune ligne/)

    const broken = await upload(client, manager, csv('"unterminated,quote'))
    const brokenPlan = await preview(client, manager, broken)
    assert.match(brokenPlan.fileErrors[0], /pas un CSV valide/)

    const notCsv = await client
      .post('/admin/imports/families')
      .loginAs(manager)
      .file('file', Buffer.from('x'), { filename: 'photo.png' })
      .withCsrfToken()
      .redirects(0)
    assert.properties(notCsv.flashMessage('inputErrorsBag') as any, ['file'])
  })

  test('semicolon-separated files (Excel FR) are accepted', async ({ client, assert }) => {
    const { manager } = await setupSchool()
    const content = Buffer.from(
      `${CSV_COLUMNS.join(';')}\nAya Benali;aya@example.com;;fr;Nour;Benali;G1;1A;"gluten;milk";;\n`
    )
    const plan = await preview(client, manager, await upload(client, manager, content))
    assert.isTrue(plan.valid)
    assert.deepEqual(plan.rows[0].allergies, ['gluten', 'milk'])
  })

  test('the option sends invitations to new parents only', async ({ client, assert }) => {
    const { school, manager } = await setupSchool()
    await createParent(school.id, {
      email: 'john@example.com',
      fullName: 'John Smith',
      password: null,
    })

    const response = await confirm(client, manager, await upload(client, manager, VALID), true)
    assert.match(String(response.flashMessage('success')), /1 invitation\(s\) envoyée\(s\)/)
    mails.assertSentCount(1)
    const salma = await User.findByOrFail('email', 'salma@example.com')
    assert.isNotNull(salma.invitedAt)
    const john = await User.findByOrFail('email', 'john@example.com')
    assert.isNull(john.invitedAt)
  })

  test('an upload is only visible to the staff member who uploaded it', async ({ client }) => {
    const { school, manager } = await setupSchool()
    const colleague = await UserFactory.apply('manager').merge({ schoolId: school.id }).create()
    const id = await upload(client, manager, VALID)

    const response = await client
      .get(`/admin/imports/families/${id}`)
      .loginAs(colleague)
      .redirects(0)
    response.assertStatus(302)
    response.assertFlashMessage('error', 'Cet aperçu a expiré. Importez le fichier à nouveau.')
  })
})
