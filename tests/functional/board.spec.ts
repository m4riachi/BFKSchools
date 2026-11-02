/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import drive from '@adonisjs/drive/services/main'
import testUtils from '@adonisjs/core/services/test_utils'
import limiter from '@adonisjs/limiter/services/main'
import MealPhoto from '#models/meal_photo'
import School from '#models/school'
import SchoolSettingsService from '#services/school_settings_service'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { addHoliday, setupMenuSchool, supplementMeal, WED } from '#tests/helpers/menus'
import { family, orderSchool, orders, TUE } from '#tests/helpers/orders'

const SLUG = 'bfk-british-academy-school-marrakech'

async function boardSlug(schoolId: number) {
  const school = await School.findOrFail(schoolId)
  return new SchoolSettingsService().get(school).board_slug
}

async function enableBoard(client: any, admin: any, slug = SLUG) {
  const response = await client
    .post('/admin/settings/board')
    .loginAs(admin)
    .withCsrfToken()
    .json({ board_slug: slug })
    .redirects(0)
  response.assertStatus(302)
  return slug
}

test.group('School display board (D46)', (group) => {
  group.each.setup(async () => {
    const truncate = await testUtils.db().truncate()
    await limiter.clear(['memory'])
    drive.fake('fs')
    return async () => {
      drive.restore('fs')
      restoreClock()
      await truncate()
    }
  })

  test('the admin turns the board on; it shows the week menu without login', async ({
    client,
    assert,
  }) => {
    // orderSchool: a published menu with two main dishes and one supplement every day.
    const ctx = await orderSchool()
    const empty = await client.get('/admin/settings').loginAs(ctx.admin).withInertia()
    assert.isNull(empty.body().props.board.url)
    assert.match(empty.body().props.board.suggestion, /^bfk-[a-z0-9-]+$/)

    const token = await enableBoard(client, ctx.admin)
    assert.equal(await boardSlug(ctx.school.id), SLUG)
    const settings = await client.get('/admin/settings').loginAs(ctx.admin).withInertia()
    assert.match(settings.body().props.board.url, new RegExp(`/board/${SLUG}$`))

    // An order exists, but the board never shows orders or children.
    const home = await family(ctx.school)
    freezeClock('2026-11-20T12:00')
    await (
      await orders()
    ).saveDay(
      home.child.id,
      TUE,
      { subscriptionMealId: ctx.main.id, supplements: [] },
      { user: home.parent }
    )

    // Monday of the menu week: the board shows that week.
    freezeClock('2026-11-23T09:00')
    const response = await client.get(`/board/${token}`).withInertia()
    response.assertStatus(200)
    response.assertInertiaComponent('board/show')
    assert.equal(response.header('cache-control'), 'no-store')
    const board = response.body().props.board
    assert.equal(board.weekStart, '2026-11-23')
    assert.isTrue(board.published)
    assert.lengthOf(board.days, 5)

    const tuesday = board.days.find((day: { date: string }) => day.date === TUE)
    assert.sameMembers(
      tuesday.dishes.map((meal: { mealId: number }) => meal.mealId),
      [ctx.main.id, ctx.alt.id]
    )
    assert.deepEqual(
      tuesday.supplements.map((meal: { mealId: number; name: string }) => meal.mealId),
      [ctx.juice.id]
    )
    // Always English, whatever the browser's language.
    assert.equal(tuesday.dishes[0].name, ctx.main.nameEn)
    assert.equal(response.body().props.locale, 'en')
    assert.equal(response.body().props.messages['board.title'], 'Menu of the week')

    const body = JSON.stringify(response.body().props)
    assert.notInclude(body, home.child.firstName)
    assert.notInclude(body, home.parent.email)
    assert.notInclude(body, '"count"')
  })

  test('Saturday shows the next week; holidays are named; unpublished weeks are empty', async ({
    client,
    assert,
  }) => {
    const { school, admin } = await setupMenuSchool()
    await addHoliday(school, WED, 'Thanksgiving')
    const token = await enableBoard(client, admin)

    freezeClock('2026-11-21T10:00')
    const board = (await client.get(`/board/${token}`).withInertia()).body().props.board
    assert.equal(board.weekStart, '2026-11-23')
    assert.isFalse(board.published)
    const wednesday = board.days.find((day: { date: string }) => day.date === WED)
    assert.equal(wednesday.holiday, 'Thanksgiving')
    assert.deepEqual(wednesday.dishes, [])
  })

  test('the board installs as its own app: a manifest that starts on the board', async ({
    client,
    assert,
  }) => {
    const { admin } = await setupMenuSchool()
    const slug = await enableBoard(client, admin)
    const page = await client.get(`/board/${slug}`)
    page.assertStatus(200)
    assert.include(page.text(), `href="/board/${slug}/manifest.webmanifest"`)
    assert.notInclude(page.text(), 'href="/manifest.webmanifest"')

    const manifest = await client.get(`/board/${slug}/manifest.webmanifest`)
    manifest.assertStatus(200)
    assert.include(manifest.header('content-type'), 'application/manifest+json')
    assert.equal(manifest.body().start_url, `/board/${slug}`)
    assert.equal(manifest.body().id, `/board/${slug}`)
    assert.equal(manifest.body().scope, `/board/${slug}/`)
    ;(await client.get('/board/unknown-school/manifest.webmanifest')).assertStatus(404)

    // The rest of the app (parents, staff, login) keeps installing the main app.
    const login = await client.get('/login')
    assert.include(login.text(), 'href="/manifest.webmanifest"')
    assert.notInclude(login.text(), '/board/')
  })

  test('unknown, moved and turned-off addresses answer 404; slugs are unique', async ({
    client,
    assert,
  }) => {
    const { admin } = await setupMenuSchool()
    const other = await setupMenuSchool()
    ;(await client.get('/board/unknown-school')).assertStatus(404)

    const old = await enableBoard(client, admin, 'bfk-old-address')
    const renewed = await enableBoard(client, admin)
    ;(await client.get(`/board/${old}`)).assertStatus(404)
    ;(await client.get(`/board/${renewed}`).withInertia()).assertStatus(200)

    // Another school cannot take the same address; an invalid one is refused.
    for (const slug of [SLUG, 'Bad Slug!', 'ab', '-leading']) {
      const refused = await client
        .post('/admin/settings/board')
        .loginAs(other.admin)
        .withCsrfToken()
        .json({ board_slug: slug })
        .redirects(0)
      refused.assertStatus(302)
      assert.isNull(await boardSlug(other.school.id))
    }

    const off = await client
      .delete('/admin/settings/board')
      .loginAs(admin)
      .withCsrfToken()
      .redirects(0)
    off.assertStatus(302)
    ;(await client.get(`/board/${renewed}`)).assertStatus(404)
  })

  test('only the admin manages the link', async ({ client, assert }) => {
    const { school, manager } = await setupMenuSchool()
    const response = await client
      .post('/admin/settings/board')
      .loginAs(manager)
      .withCsrfToken()
      .json({ board_slug: SLUG })
      .redirects(0)
    assert.include([302, 403], response.status())
    assert.isNull(await boardSlug(school.id))
  })

  test('the settings form never changes the address', async ({ client, assert }) => {
    const { school, admin } = await setupMenuSchool()
    const slug = await enableBoard(client, admin)
    await new SchoolSettingsService().update(await School.findOrFail(school.id), {
      board_slug: 'bfk-other',
      supplement_max_quantity: 3,
    })
    assert.equal(await boardSlug(school.id), slug)
  })

  test('photos: only meals on the displayed week menu', async ({ client }) => {
    const ctx = await orderSchool()
    const token = await enableBoard(client, ctx.admin)
    freezeClock('2026-11-23T09:00')
    const disk = drive.use('fs')
    const photo = async (mealId: number) => {
      await disk.put(`meals/${mealId}/full.webp`, 'webp')
      return MealPhoto.create({
        mealId,
        disk: 'fs',
        path: `meals/${mealId}/full.webp`,
        thumbPath: `meals/${mealId}/thumb.webp`,
        position: 0,
        isCover: true,
      })
    }
    const onMenu = await photo(ctx.juice.id)
    const offMenu = await photo((await supplementMeal()).id)

    ;(await client.get(`/board/${token}/photos/${onMenu.id}/full`)).assertStatus(200)
    ;(await client.get(`/board/${token}/photos/${offMenu.id}/full`)).assertStatus(404)
    ;(await client.get(`/board/unknown-school/photos/${onMenu.id}/full`)).assertStatus(404)
  })
})
