/* eslint-disable @unicorn/no-await-expression-member */
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import testUtils from '@adonisjs/core/services/test_utils'
import Ingredient from '#models/ingredient'
import PurchaseOrder from '#models/purchase_order'
import MealIngredientService from '#services/meal_ingredient_service'
import ProcurementService from '#services/procurement_service'
import { UserFactory } from '#database/factories/user_factory'
import { freezeClock, restoreClock } from '#tests/helpers/clock'
import { family, orderSchool, TUE } from '#tests/helpers/orders'
import { order as placeOrder } from '#tests/helpers/reports'

const OPEN = '2026-11-20T12:00'

async function ingredient(label: string, unit: string) {
  return Ingredient.create({ code: label, label, category: 'NOURRITURE', unit })
}

test.group('Économat / bon de commande (D56)', (group) => {
  group.each.setup(() => testUtils.db().truncate())
  group.each.teardown(() => restoreClock())

  test('provisional quantity = meals × quantity per meal, per ingredient', async ({ assert }) => {
    const ctx = await orderSchool()
    const chicken = await ingredient('Poulet', 'Kilogram')
    const salt = await ingredient('Sel', 'Kilogram')
    await (
      await app.container.make(MealIngredientService)
    ).save(ctx.main, [
      { ingredientId: chicken.id, customerVisible: true, quantityPerMeal: 0.15 },
      { ingredientId: salt.id, customerVisible: false, quantityPerMeal: 0.002 },
    ])
    const a = await family(ctx.school)
    const b = await family(ctx.school)
    freezeClock(OPEN)
    await placeOrder(a.parent, a.child, TUE, ctx.main.id)
    await placeOrder(b.parent, b.child, TUE, ctx.main.id)

    const lines = await (
      await app.container.make(ProcurementService)
    ).provisional(ctx.school.id, TUE)
    const chickenLine = lines.find((l) => l.label === 'Poulet')!
    assert.equal(chickenLine.quantity, 0.3) // 2 meals × 0.15
    assert.equal(chickenLine.unit, 'Kilogram')
    assert.equal(lines.find((l) => l.label === 'Sel')!.quantity, 0.004)
  })

  test('confirm saves the bon de commande; it reopens with the edited lines', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    const chicken = await ingredient('Poulet', 'Kilogram')
    await (
      await app.container.make(MealIngredientService)
    ).save(ctx.main, [{ ingredientId: chicken.id, customerVisible: true, quantityPerMeal: 0.15 }])
    const a = await family(ctx.school)
    freezeClock(OPEN)
    await placeOrder(a.parent, a.child, TUE, ctx.main.id)

    const confirm = await client
      .post('/kitchen/procurement/confirm')
      .loginAs(ctx.manager)
      .withCsrfToken()
      .json({
        date: TUE,
        note: 'Livraison 7h',
        lines: [
          { ingredientId: chicken.id, label: 'Poulet', unit: 'Kilogram', quantity: 0.5 },
          { ingredientId: null, label: 'Épices', unit: 'Paquet', quantity: 2 },
          { ingredientId: null, label: 'Ignored', unit: null, quantity: 0 },
        ],
      })
      .redirects(0)
    confirm.assertStatus(302)

    const saved = await PurchaseOrder.query().where('date', TUE).preload('lines').firstOrFail()
    assert.equal(saved.reference, `BC-${TUE.replace(/-/g, '')}`)
    assert.equal(saved.note, 'Livraison 7h')
    assert.isNotNull(saved.confirmedAt)
    // The zero-quantity line is dropped.
    assert.deepEqual(
      saved.lines.map((l) => [l.label, Number(l.quantity)]),
      [
        ['Poulet', 0.5],
        ['Épices', 2],
      ]
    )

    // Reopening returns the saved version (not recomputed).
    const view = await (await app.container.make(ProcurementService)).current(ctx.school.id, TUE)
    assert.isTrue(view.saved)
    assert.lengthOf(view.lines, 2)
  })

  test('a new article not in the catalog can be added with its unit', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: ctx.school.id }).create()
    const response = await client
      .post('/kitchen/procurement/ingredients')
      .loginAs(kitchen)
      .withCsrfToken()
      .json({ label: 'Safran premium', unit: 'Gramme' })
    response.assertStatus(200)
    const created = await Ingredient.findByOrFail('label', 'Safran premium')
    assert.equal(created.unit, 'Gramme')
    assert.equal(response.body().ingredient.id, created.id)

    // Searching finds it (with its unit).
    const search = await client.get('/kitchen/procurement/ingredients?q=safran').loginAs(kitchen)
    assert.isTrue(
      search.body().results.some((r: { label: string }) => r.label === 'Safran premium')
    )
  })

  test('the PDF needs a confirmed order; the kitchen reads the page', async ({
    client,
    assert,
  }) => {
    const ctx = await orderSchool()
    const kitchen = await UserFactory.apply('kitchen').merge({ schoolId: ctx.school.id }).create()
    freezeClock(OPEN)

    const page = await client.get(`/kitchen/procurement?date=${TUE}`).loginAs(kitchen).withInertia()
    page.assertStatus(200)

    // No saved order yet → redirect to the page.
    const before = await client
      .get(`/kitchen/procurement/download?date=${TUE}`)
      .loginAs(kitchen)
      .redirects(0)
    before.assertStatus(302)

    await (
      await app.container.make(ProcurementService)
    ).confirm(
      ctx.school,
      TUE,
      {
        note: null,
        lines: [{ ingredientId: null, label: 'Tomate', unit: 'Kilogram', quantity: 3 }],
      },
      kitchen
    )
    const pdf = await client.get(`/kitchen/procurement/download?date=${TUE}`).loginAs(kitchen)
    pdf.assertStatus(200)
    assert.include(String(pdf.header('content-type')), 'application/pdf')
    assert.equal((pdf.body() as Buffer).subarray(0, 5).toString('latin1'), '%PDF-')
  })
})
