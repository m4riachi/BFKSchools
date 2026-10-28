import { test } from '@japa/runner'
import sharp from 'sharp'
import Meal from '#models/meal'
import MealPhoto from '#models/meal_photo'
import User from '#models/user'
import MealPolicy from '#policies/meal_policy'
import { centsToInput, parseMadToCents } from '#support/money'
import { detectImageFormat } from '#services/image_processor'
import { displayFileName } from '#services/meal_photo_service'
import {
  allergenLabel,
  allergenLabels,
  coverPhoto,
  mealCoverUrls,
  mealDescription,
  mealName,
  mealPhotoUrls,
  mealPrice,
} from '#support/meal_display'

function meal(attributes: Partial<Meal>) {
  const instance = new Meal()
  instance.merge({
    nameFr: 'Poulet rôti',
    nameEn: 'Roast chicken',
    descriptionFr: null,
    descriptionEn: null,
    priceCents: 4550,
    ...attributes,
  })
  return instance
}

function photo(id: number, position: number, isCover = false) {
  const instance = new MealPhoto()
  instance.merge({ id, position, isCover })
  return instance
}

test.group('Meals | display helpers', () => {
  test('name and description by locale, description falls back', ({ assert }) => {
    const m = meal({ descriptionFr: 'Avec riz', descriptionEn: null })
    assert.equal(mealName(m, 'fr'), 'Poulet rôti')
    assert.equal(mealName(m, 'en'), 'Roast chicken')
    assert.equal(mealDescription(m, 'fr'), 'Avec riz')
    assert.equal(mealDescription(m, 'en'), 'Avec riz')
    assert.isNull(mealDescription(meal({}), 'en'))
    assert.equal(mealDescription(meal({ descriptionEn: 'With rice' }), 'en'), 'With rice')
  })

  test('photo URLs use the id, never the storage key', ({ assert }) => {
    assert.deepEqual(mealPhotoUrls({ id: 7 }), {
      url: '/media/meal-photos/7/full',
      thumbUrl: '/media/meal-photos/7/thumb',
    })
  })

  test('cover: the flagged photo, else the first by position', ({ assert }) => {
    assert.equal(coverPhoto([photo(1, 0), photo(2, 1, true)])?.id, 2)
    assert.equal(coverPhoto([photo(3, 2), photo(4, 1)])?.id, 4)
    assert.isNull(coverPhoto([]))
    const m = meal({})
    m.$setRelated('photos', [photo(9, 0, true)])
    assert.deepEqual(mealCoverUrls(m), mealPhotoUrls({ id: 9 }))
  })

  test('allergen labels in French and English', ({ assert }) => {
    assert.equal(allergenLabel('eggs', 'fr'), 'Œufs')
    assert.equal(allergenLabel('eggs', 'en'), 'Eggs')
    assert.deepEqual(allergenLabels(['milk', 'nuts'], 'fr'), [
      { code: 'milk', label: 'Lait' },
      { code: 'nuts', label: 'Fruits à coque' },
    ])
    assert.deepEqual(
      allergenLabels(['milk', 'nuts'], 'en').map((a) => a.label),
      ['Milk', 'Tree nuts']
    )
  })

  test('formatted price and price input round-trip', ({ assert }) => {
    assert.match(mealPrice(meal({ priceCents: 4550 }), 'en'), /^45\.50 MAD$/)
    for (const cents of [1, 99, 100, 1250, 123456]) {
      assert.equal(parseMadToCents(centsToInput(cents, 'fr')), cents)
      assert.equal(parseMadToCents(centsToInput(cents, 'en')), cents)
    }
    assert.equal(centsToInput(1250, 'fr'), '12,50')
    assert.equal(centsToInput(5, 'en'), '0.05')
    assert.throws(() => centsToInput(1.5))
  })
})

test.group('Meals | upload helpers', () => {
  test('image formats are detected from magic bytes', async ({ assert }) => {
    const base = sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
    assert.equal(detectImageFormat(await base.clone().jpeg().toBuffer()), 'jpeg')
    assert.equal(detectImageFormat(await base.clone().png().toBuffer()), 'png')
    assert.equal(detectImageFormat(await base.clone().webp().toBuffer()), 'webp')
    assert.isNull(detectImageFormat(await base.clone().gif().toBuffer()))
    assert.isNull(detectImageFormat(Buffer.from('<svg></svg>')))
    assert.isNull(detectImageFormat(Buffer.from('RIFF0000WAVE')))
    assert.isNull(detectImageFormat(Buffer.alloc(0)))
  })

  test('client file names are sanitized for messages', ({ assert }) => {
    assert.equal(displayFileName('photo\u0000\n.jpg'), 'photo.jpg')
    assert.equal(displayFileName(''), '?')
    assert.lengthOf(displayFileName('a'.repeat(200)), 58)
  })
})

test.group('Meals | policy', () => {
  const user = (role: User['role'], isActive = true) => {
    const instance = new User()
    instance.merge({ role, isActive })
    return instance
  }

  test('roles', ({ assert }) => {
    const policy = new MealPolicy()
    for (const role of ['admin', 'manager'] as const) {
      assert.isTrue(policy.view(user(role)))
      assert.isTrue(policy.manage(user(role)))
    }
    assert.isTrue(policy.view(user('kitchen')))
    assert.isFalse(policy.manage(user('kitchen')))
    assert.isFalse(policy.view(user('parent')))
    assert.isFalse(policy.manage(user('parent')))
    assert.isFalse(policy.before(user('admin', false)))
  })
})
