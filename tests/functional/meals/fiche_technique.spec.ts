/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import Child from '#models/child'
import Ingredient from '#models/ingredient'
import MealOrder from '#models/meal_order'
import IngredientImportService from '#services/ingredient_import_service'
import MealIngredientService from '#services/meal_ingredient_service'
import ProductionReportService from '#services/production_report_service'
import { UserFactory } from '#database/factories/user_factory'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { family, orders, orderSchool, TUE } from '#tests/helpers/orders'

const OPEN = '2026-11-20T12:00'

const CSV = [
  'Code,Libellé,Min Qte,Max Qte,Tolerance,Categorie,Famille,Sous Famille,Tva,taux Tva,Unit,Crée le,Statut',
  'T1,Tomate,0,0,0,NOURRITURE,Fruits & Legumes,Legumes,T00,0,Kilogram,x,true',
  'T2,Oignon,0,0,0,NOURRITURE,Fruits & Legumes,Legumes,T00,0,Kilogram,x,true',
  'T3,Jus,0,0,0,BOISSONS,Eaux,Jus,T00,0,Unité,x,true',
  'T4,Stylo,0,0,0,PAPETERIE-INFO,Bureau,Bureau,T20,20,PIECE,x,true',
  'T5,Sel inactif,0,0,0,NOURRITURE,Epicerie,Sel,T00,0,Kilogram,x,false',
].join('\r\n')

test.group('Fiche technique (D55)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('the import keeps active food/drinks only and is idempotent', async ({ assert }) => {
    const service = await app.container.make(IngredientImportService)
    const first = await service.importFromContent(CSV)
    assert.equal(first.imported, 3) // Tomate, Oignon, Jus
    assert.equal(first.total, 5)
    const labels = (await Ingredient.all()).map((i) => i.label).sort()
    assert.deepEqual(labels, ['Jus', 'Oignon', 'Tomate'])

    // Re-import updates, never duplicates; ids are stable.
    const before = (await Ingredient.findByOrFail('code', 'T1')).id
    const again = await service.importFromContent(CSV.replace('Tomate', 'Tomate fraîche'))
    assert.equal(again.imported, 0)
    assert.equal(again.updated, 3)
    assert.equal((await Ingredient.findByOrFail('code', 'T1')).id, before)
    assert.equal((await Ingredient.findByOrFail('code', 'T1')).label, 'Tomate fraîche')
  })

  test('the admin builds a fiche; a manager may, a parent may not', async ({ client, assert }) => {
    const ctx = await orderSchool()
    await (await app.container.make(IngredientImportService)).importFromContent(CSV)
    const tomate = await Ingredient.findByOrFail('code', 'T1')
    const oignon = await Ingredient.findByOrFail('code', 'T2')
    const parent = await UserFactory.apply('parent').merge({ schoolId: ctx.school.id }).create()

    // Search endpoint.
    const search = await client.get('/admin/ingredients?q=oign').loginAs(ctx.manager)
    search.assertStatus(200)
    assert.isTrue(search.body().results.some((r: { label: string }) => r.label === 'Oignon'))

    // Save the fiche: tomato shown, onion hidden.
    const save = await client
      .put(`/admin/meals/${ctx.main.id}/ingredients`)
      .loginAs(ctx.manager)
      .withCsrfToken()
      .json({
        ingredients: [
          { ingredientId: tomate.id, customerVisible: true },
          { ingredientId: oignon.id, customerVisible: false },
        ],
      })
      .redirects(0)
    save.assertStatus(302)

    const fiche = await (await app.container.make(MealIngredientService)).fiche(ctx.main.id)
    assert.deepEqual(
      fiche.map((l) => [l.label, l.customerVisible]),
      [
        ['Tomate', true],
        ['Oignon', false],
      ]
    )
    const visible = await (
      await app.container.make(MealIngredientService)
    ).visibleByMeal([ctx.main.id])
    assert.deepEqual(
      visible.get(ctx.main.id)?.map((i) => i.label),
      ['Tomate']
    )

    // A parent cannot reach the fiche.
    ;(await client.get(`/admin/meals/${ctx.main.id}/ingredients`).loginAs(parent)).assertStatus(403)
    const refused = await client
      .put(`/admin/meals/${ctx.main.id}/ingredients`)
      .loginAs(parent)
      .withCsrfToken()
      .json({ ingredients: [] })
      .redirects(0)
    assert.include([302, 403], refused.status())
  })

  test('a parent removes a shown ingredient: saved on the order, remembered, shown to the kitchen', async ({
    assert,
  }) => {
    const ctx = await orderSchool()
    await (await app.container.make(IngredientImportService)).importFromContent(CSV)
    const tomate = await Ingredient.findByOrFail('code', 'T1')
    const oignon = await Ingredient.findByOrFail('code', 'T2')
    await (
      await app.container.make(MealIngredientService)
    ).save(ctx.main, [
      { ingredientId: tomate.id, customerVisible: true },
      { ingredientId: oignon.id, customerVisible: false },
    ])
    const home = await family(ctx.school)
    freezeClock(OPEN)

    await (
      await orders()
    ).saveDay(
      home.child.id,
      TUE,
      {
        subscriptionMealId: ctx.main.id,
        supplements: [],
        exclusions: [{ mealId: ctx.main.id, ingredientIds: [tomate.id, oignon.id] }],
      },
      { user: home.parent }
    )

    const order = await MealOrder.query()
      .where('child_id', home.child.id)
      .where('date', TUE)
      .preload('items')
      .firstOrFail()
    const line = order.items.find((l) => l.mealId === ctx.main.id)!
    // Only the shown ingredient (Tomate) is removable; the hidden Oignon is ignored.
    assert.deepEqual(
      line.excludedIngredients.map((i) => i.label),
      ['Tomate']
    )
    // Remembered on the child (the shown ingredient only).
    const child = await Child.findOrFail(home.child.id)
    assert.deepEqual(child.dislikedIngredients, [tomate.id])

    // The kitchen production sheet lists the removal.
    const removals = await (
      await app.container.make(ProductionReportService)
    ).ingredientRemovals(ctx.school.id, TUE)
    assert.lengthOf(removals, 1)
    assert.deepEqual(removals[0].removed, ['Tomate'])
    assert.equal(removals[0].firstName, home.child.firstName)

    // Re-including it forgets the dislike.
    await (
      await orders()
    ).saveDay(
      home.child.id,
      TUE,
      { subscriptionMealId: ctx.main.id, supplements: [], exclusions: [] },
      { user: home.parent }
    )
    assert.deepEqual((await Child.findOrFail(home.child.id)).dislikedIngredients, [])
  })
})
