import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'
import Meal from '#models/meal'
import MealPhoto from '#models/meal_photo'
import User from '#models/user'
import MealPhotoService from '#services/meal_photo_service'
import type { AllergenCode } from '#enums/allergens'
import type { MealCategory, MealType } from '#enums/meals'
import { assertDemoSeeding, placeholderPhoto } from '#database/demo/support'

type DemoMeal = {
  nameFr: string
  nameEn: string
  descriptionFr: string
  descriptionEn: string
  type: MealType
  category: MealCategory
  priceCents: number
  allergens: AllergenCode[]
  tags: string[]
  /** Background, food and garnish colors of the placeholder photo. */
  colors: [string, string, string]
  photos?: number
}

/** 21 meals: 12 subscription mains, 9 supplements (starters, desserts, drinks, snacks). */
export const DEMO_MEALS: DemoMeal[] = [
  {
    nameFr: 'Tajine de poulet aux olives',
    nameEn: 'Chicken tajine with olives',
    descriptionFr: 'Poulet mijoté, citron confit, olives vertes, pommes de terre.',
    descriptionEn: 'Slow-cooked chicken, preserved lemon, green olives, potatoes.',
    type: 'subscription',
    category: 'main',
    priceCents: 4200,
    allergens: [],
    tags: ['halal'],
    colors: ['#e9d8b4', '#d79a3b', '#7a8b2f'],
    photos: 2,
  },
  {
    nameFr: 'Couscous aux sept légumes',
    nameEn: 'Seven-vegetable couscous',
    descriptionFr: 'Semoule fine, légumes de saison, pois chiches.',
    descriptionEn: 'Fine semolina, seasonal vegetables, chickpeas.',
    type: 'subscription',
    category: 'main',
    priceCents: 3800,
    allergens: ['gluten', 'celery'],
    tags: ['vegetarian', 'halal'],
    colors: ['#f2e3c4', '#e8c56a', '#d0662f'],
    photos: 2,
  },
  {
    nameFr: 'Poisson grillé, riz safrané',
    nameEn: 'Grilled fish, saffron rice',
    descriptionFr: 'Filet de merlan grillé, riz au safran, haricots verts.',
    descriptionEn: 'Grilled whiting fillet, saffron rice, green beans.',
    type: 'subscription',
    category: 'main',
    priceCents: 4500,
    allergens: ['fish'],
    tags: ['halal'],
    colors: ['#dce9ee', '#f0c94a', '#5d9a4a'],
  },
  {
    nameFr: 'Spaghetti bolognaise',
    nameEn: 'Spaghetti bolognese',
    descriptionFr: 'Pâtes, sauce tomate à la viande hachée de bœuf.',
    descriptionEn: 'Pasta with a beef and tomato sauce.',
    type: 'subscription',
    category: 'main',
    priceCents: 3900,
    allergens: ['gluten', 'celery'],
    tags: ['halal'],
    colors: ['#f5e6d3', '#c8442f', '#f0d27a'],
  },
  {
    nameFr: 'Kefta à la tomate',
    nameEn: 'Kefta meatballs in tomato sauce',
    descriptionFr: 'Boulettes de bœuf épicées, sauce tomate, œuf.',
    descriptionEn: 'Spiced beef meatballs, tomato sauce, egg.',
    type: 'subscription',
    category: 'main',
    priceCents: 4100,
    allergens: ['eggs'],
    tags: ['halal', 'spicy'],
    colors: ['#f1dfcf', '#b8452c', '#f3e08a'],
  },
  {
    nameFr: 'Gratin de légumes',
    nameEn: 'Vegetable gratin',
    descriptionFr: 'Courgettes, carottes et pommes de terre gratinées.',
    descriptionEn: 'Baked courgettes, carrots and potatoes with cheese.',
    type: 'subscription',
    category: 'main',
    priceCents: 3600,
    allergens: ['milk', 'eggs'],
    tags: ['vegetarian'],
    colors: ['#efe4cf', '#e1b45a', '#6f9a3e'],
  },
  {
    nameFr: 'Poulet rôti, pommes de terre',
    nameEn: 'Roast chicken with potatoes',
    descriptionFr: 'Cuisse de poulet rôtie, pommes de terre au four.',
    descriptionEn: 'Roast chicken leg, oven-baked potatoes.',
    type: 'subscription',
    category: 'main',
    priceCents: 4300,
    allergens: [],
    tags: ['halal', 'gluten_free'],
    colors: ['#f3e5c9', '#c9822f', '#e9c35b'],
  },
  {
    nameFr: 'Pastilla au poulet',
    nameEn: 'Chicken pastilla',
    descriptionFr: 'Feuilles de brick, poulet, amandes, cannelle.',
    descriptionEn: 'Filo pastry, chicken, almonds, cinnamon.',
    type: 'subscription',
    category: 'main',
    priceCents: 4800,
    allergens: ['gluten', 'eggs', 'nuts'],
    tags: ['halal'],
    colors: ['#f4e7d2', '#d8a254', '#f7f1e3'],
  },
  {
    nameFr: 'Lentilles et riz',
    nameEn: 'Lentils and rice',
    descriptionFr: 'Lentilles mijotées aux épices douces, riz blanc.',
    descriptionEn: 'Lentils with mild spices, white rice.',
    type: 'subscription',
    category: 'main',
    priceCents: 3200,
    allergens: [],
    tags: ['vegetarian', 'vegan', 'gluten_free'],
    colors: ['#ede3cf', '#8a5a2b', '#f6f0e0'],
  },
  {
    nameFr: 'Burger maison',
    nameEn: 'Homemade burger',
    descriptionFr: 'Steak haché de bœuf, pain aux graines de sésame, cheddar.',
    descriptionEn: 'Beef patty, sesame bun, cheddar.',
    type: 'subscription',
    category: 'main',
    priceCents: 4600,
    allergens: ['gluten', 'sesame', 'milk'],
    tags: ['halal'],
    colors: ['#f6e4c8', '#a8642c', '#e8b93a'],
  },
  {
    nameFr: 'Saumon, purée',
    nameEn: 'Salmon with mashed potatoes',
    descriptionFr: 'Pavé de saumon, purée maison au beurre.',
    descriptionEn: 'Salmon fillet, homemade buttery mash.',
    type: 'subscription',
    category: 'main',
    priceCents: 5200,
    allergens: ['fish', 'milk'],
    tags: [],
    colors: ['#e5eef0', '#ee8a5f', '#f4e7c3'],
  },
  {
    nameFr: 'Quiche aux épinards',
    nameEn: 'Spinach quiche',
    descriptionFr: 'Pâte brisée, épinards, œufs et fromage.',
    descriptionEn: 'Shortcrust pastry, spinach, eggs and cheese.',
    type: 'subscription',
    category: 'main',
    priceCents: 3500,
    allergens: ['gluten', 'eggs', 'milk'],
    tags: ['vegetarian'],
    colors: ['#eef0dd', '#e2c06a', '#4f7f34'],
  },
  {
    nameFr: 'Salade marocaine',
    nameEn: 'Moroccan salad',
    descriptionFr: 'Tomates, concombre, oignon, persil.',
    descriptionEn: 'Tomatoes, cucumber, onion, parsley.',
    type: 'supplement',
    category: 'starter',
    priceCents: 1200,
    allergens: [],
    tags: ['vegan', 'gluten_free'],
    colors: ['#e9f1df', '#d64535', '#5b9c45'],
  },
  {
    nameFr: 'Harira',
    nameEn: 'Harira soup',
    descriptionFr: 'Soupe de tomates, lentilles, pois chiches et vermicelles.',
    descriptionEn: 'Tomato, lentil, chickpea and vermicelli soup.',
    type: 'supplement',
    category: 'starter',
    priceCents: 1400,
    allergens: ['gluten', 'celery'],
    tags: ['halal'],
    colors: ['#f2e2cf', '#b9552d', '#e6c27a'],
  },
  {
    nameFr: 'Salade de fruits',
    nameEn: 'Fruit salad',
    descriptionFr: 'Fruits frais de saison.',
    descriptionEn: 'Fresh seasonal fruit.',
    type: 'supplement',
    category: 'dessert',
    priceCents: 1000,
    allergens: [],
    tags: ['vegan', 'gluten_free'],
    colors: ['#fbeee0', '#f2a53a', '#d23f55'],
  },
  {
    nameFr: 'Yaourt nature',
    nameEn: 'Plain yogurt',
    descriptionFr: 'Yaourt au lait entier.',
    descriptionEn: 'Whole-milk yogurt.',
    type: 'supplement',
    category: 'dessert',
    priceCents: 600,
    allergens: ['milk'],
    tags: ['vegetarian', 'gluten_free'],
    colors: ['#eaf0f4', '#fbfbf8', '#c9d7e2'],
  },
  {
    nameFr: 'Mousse au chocolat',
    nameEn: 'Chocolate mousse',
    descriptionFr: 'Chocolat noir, œufs, crème.',
    descriptionEn: 'Dark chocolate, eggs, cream.',
    type: 'supplement',
    category: 'dessert',
    priceCents: 1300,
    allergens: ['eggs', 'milk'],
    tags: ['vegetarian'],
    colors: ['#f3e9df', '#5a3220', '#8a5a3a'],
  },
  {
    nameFr: 'Jus d’orange frais',
    nameEn: 'Fresh orange juice',
    descriptionFr: 'Oranges pressées le matin même.',
    descriptionEn: 'Oranges squeezed the same morning.',
    type: 'supplement',
    category: 'drink',
    priceCents: 900,
    allergens: [],
    tags: ['vegan', 'gluten_free'],
    colors: ['#fdf1d8', '#f39a1e', '#f7c65a'],
  },
  {
    nameFr: 'Eau minérale',
    nameEn: 'Mineral water',
    descriptionFr: 'Bouteille de 50 cl.',
    descriptionEn: '50 cl bottle.',
    type: 'supplement',
    category: 'drink',
    priceCents: 500,
    allergens: [],
    tags: ['vegan', 'gluten_free'],
    colors: ['#e3f0f7', '#9fd0ea', '#e8f6fd'],
  },
  {
    nameFr: 'Msemen au miel',
    nameEn: 'Msemen with honey',
    descriptionFr: 'Crêpe feuilletée marocaine, miel.',
    descriptionEn: 'Flaky Moroccan flatbread with honey.',
    type: 'supplement',
    category: 'snack',
    priceCents: 800,
    allergens: ['gluten'],
    tags: ['vegetarian'],
    colors: ['#f6ead2', '#d8a54a', '#b77a22'],
  },
  {
    nameFr: 'Cookie aux pépites de chocolat',
    nameEn: 'Chocolate chip cookie',
    descriptionFr: 'Cookie maison.',
    descriptionEn: 'Homemade cookie.',
    type: 'supplement',
    category: 'snack',
    priceCents: 700,
    allergens: ['gluten', 'eggs', 'milk', 'soybeans'],
    tags: ['vegetarian'],
    colors: ['#f4e8d6', '#c48a4a', '#4a2b1a'],
  },
]

/**
 * The demo meal catalog (development/test only): 21 meals with FR/EN
 * names, prices, EU allergens and tags, each with 1–2 placeholder photos
 * generated locally and stored through the normal photo pipeline (Drive
 * disk from DRIVE_DISK, WebP + thumbnail). Idempotent: meals are matched by
 * French name; photos are added only to meals that have none.
 */
export default class DemoCatalogSeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    assertDemoSeeding()
    const admin = await User.findByEmail('admin@bfk.test')
    const photos = await app.container.make(MealPhotoService)

    for (const demo of DEMO_MEALS) {
      const { colors, photos: photoCount = 1, ...data } = demo
      let meal = await Meal.query()
        .whereNull('deleted_at')
        .whereRaw('lower(name_fr) = ?', [data.nameFr.toLowerCase()])
        .first()
      if (!meal) {
        meal = await Meal.create({
          ...data,
          isActive: true,
          externalRecipeRef: null,
          createdBy: admin?.id ?? null,
          deletedAt: null,
        })
      }
      const hasPhoto = await MealPhoto.query().where('meal_id', meal.id).first()
      if (hasPhoto) continue
      const files = []
      for (let variant = 0; variant < photoCount; variant++) {
        files.push({
          clientName: `demo-${meal.id}-${variant + 1}.png`,
          data: await placeholderPhoto(colors, variant),
          tooLarge: false,
        })
      }
      await photos.upload(meal, files)
    }
  }
}
