import { test } from '@japa/runner'
import { ingredientIcon } from '#support/ingredient_icon'

test.group('ingredientIcon (D57)', () => {
  test('maps common ingredients to an emoji, accent- and case-insensitive', ({ assert }) => {
    assert.equal(ingredientIcon('Tomate'), '🍅')
    assert.equal(ingredientIcon('TOMATES PELEES'), '🍅')
    assert.equal(ingredientIcon('Oignon'), '🧅')
    assert.equal(ingredientIcon('CUISSE DE POULET'), '🍗')
    assert.equal(ingredientIcon('Lait UHT'), '🥛')
    assert.equal(ingredientIcon('Pâtes penne'), '🍝')
    assert.equal(ingredientIcon('Jus de pomme'), '🧃') // "jus" wins over "pomme" (order)
  })

  test('the most specific rule wins (crème brûlée is a dessert, not cream)', ({ assert }) => {
    assert.equal(ingredientIcon('Crème brûlée'), '🍮')
    assert.equal(ingredientIcon('Crème fraîche'), '🥛')
    assert.equal(ingredientIcon('Pomme de terre'), '🥔')
    assert.equal(ingredientIcon('Pomme golden'), '🍎')
  })

  test('falls back to a neutral icon for the unknown and the empty', ({ assert }) => {
    assert.equal(ingredientIcon('Xyz article inconnu'), '🍴')
    assert.equal(ingredientIcon(''), '🍴')
    assert.equal(ingredientIcon(null), '🍴')
  })
})
