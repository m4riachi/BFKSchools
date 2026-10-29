import { readFile } from 'node:fs/promises'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'
import Meal from '#models/meal'
import MealPhoto from '#models/meal_photo'
import User from '#models/user'
import MealPhotoService from '#services/meal_photo_service'
import type { AllergenCode } from '#enums/allergens'
import type { MealCategory, MealType } from '#enums/meals'
import { loadBfkMenu, seedBfkMenu } from '#database/catalog/bfk_menu'

export type DemoMeal = {
  nameFr: string
  nameEn: string
  descriptionFr: string
  descriptionEn: string
  type: MealType
  category: MealCategory
  /** 0 for subscription meals (D31: free); > 0 for supplements. */
  priceCents: number
  allergens: AllergenCode[]
  tags: string[]
  /** A real BFK tray photo in `database/demo/meal_photos/` (re-encoded JPEG, ≤ 1200 px, no EXIF). */
  photo: { file: string }
}

/** Folder of the real meal photos used by the demo catalog. */
export const DEMO_PHOTO_DIR = 'database/demo/meal_photos'

const tray = (file: string) => ({ file: `${file}.jpg` })

/**
 * The 13 subscription trays (BFK's real lunches, real photos, free — D31).
 * Supplements come from BFK's restaurant menu (D32, `database/catalog/`).
 * Allergens are a conservative guess from
 * the tray contents (EU-14) — BFK must confirm them. The water, juice and
 * dairy drinks seen on the photos are part of the tray, not separate items.
 */
export const DEMO_MEALS: DemoMeal[] = [
  {
    nameFr: 'Penne bolognaise et beignet',
    nameEn: 'Penne bolognese and doughnut',
    descriptionFr:
      'Penne à la bolognaise (bœuf haché, sauce tomate), légumes vapeur, salade composée (tomates cerises, maïs, concombre) et beignet sucré.',
    descriptionEn:
      'Penne bolognese (minced beef, tomato sauce), steamed vegetables, mixed salad (cherry tomatoes, sweetcorn, cucumber) and a sugar doughnut.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['gluten', 'eggs', 'milk', 'celery'],
    tags: ['halal'],
    photo: tray('01-penne-bolognaise'),
  },
  {
    nameFr: 'Gratin de poulet à la béchamel',
    nameEn: 'Chicken béchamel gratin',
    descriptionFr: 'Gratin de poulet à la béchamel, salade de chou rouge et crème dessert.',
    descriptionEn: 'Chicken béchamel gratin, red cabbage slaw and a cream dessert.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['gluten', 'milk', 'eggs'],
    tags: ['halal'],
    photo: tray('02-gratin-poulet-bechamel'),
  },
  {
    nameFr: 'Brochettes de kefta, salade de riz au thon',
    nameEn: 'Kefta skewers, tuna rice salad',
    descriptionFr:
      'Brochettes de kefta (bœuf haché épicé), salade de riz au thon, carottes râpées à l’orange et gâteau aux amandes.',
    descriptionEn:
      'Kefta skewers (spiced minced beef), tuna rice salad, grated carrots with orange and an almond cake.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['fish', 'nuts', 'gluten', 'eggs', 'milk'],
    tags: ['halal'],
    photo: tray('03-brochettes-kefta'),
  },
  {
    nameFr: 'Saucisses grillées, purée maison',
    nameEn: 'Grilled sausages, homemade mash',
    descriptionFr:
      'Saucisses grillées, purée de pommes de terre maison, légumes vapeur et une poire.',
    descriptionEn: 'Grilled sausages, homemade mashed potatoes, steamed vegetables and a pear.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['milk'],
    tags: ['halal'],
    photo: tray('04-saucisses-puree'),
  },
  {
    nameFr: 'Rfissa au poulet et lentilles',
    nameEn: 'Chicken and lentil rfissa',
    descriptionFr:
      'Rfissa au poulet et aux lentilles (msemen effiloché, bouillon épicé, œuf dur), samoussas et salade de fruits.',
    descriptionEn:
      'Chicken and lentil rfissa (shredded msemen, spiced broth, boiled egg), samosas and a fruit salad.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['gluten', 'eggs'],
    tags: ['halal'],
    photo: tray('05-rfissa-poulet'),
  },
  {
    nameFr: 'Tajine de kefta à l’œuf',
    nameEn: 'Kefta and egg tagine',
    descriptionFr:
      'Tajine de kefta à la sauce tomate et à l’œuf, riz, carottes râpées à l’orange et roulé au chocolat.',
    descriptionEn:
      'Kefta tagine in tomato sauce with egg, rice, grated carrots with orange and a chocolate roll.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['eggs', 'gluten', 'milk'],
    tags: ['halal'],
    photo: tray('06-tajine-kefta-oeuf'),
  },
  {
    nameFr: 'Émincé de poulet à la crème, penne',
    nameEn: 'Creamy chicken strips, penne',
    descriptionFr:
      'Émincé de poulet à la crème, penne, salade de chou rouge et crêpe au chocolat et aux amandes.',
    descriptionEn:
      'Creamy chicken strips, penne, red cabbage slaw and a chocolate and almond crêpe.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['milk', 'gluten', 'eggs', 'nuts'],
    tags: ['halal'],
    photo: tray('07-emince-poulet-penne'),
  },
  {
    nameFr: 'Burger de poulet pané, frites',
    nameEn: 'Breaded chicken burger, fries',
    descriptionFr:
      'Burger de poulet pané (pain brioché, fromage, salade), frites, salade de concombre et cookies.',
    descriptionEn:
      'Breaded chicken burger (soft bun, cheese, lettuce), fries, cucumber salad and cookies.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['gluten', 'eggs', 'milk'],
    tags: ['halal'],
    photo: tray('08-burger-poulet-pane'),
  },
  {
    nameFr: 'Couscous aux sept légumes',
    nameEn: 'Seven-vegetable couscous',
    descriptionFr:
      'Couscous aux sept légumes (carottes, courgettes, potiron, navets, chou, pois chiches) et fruit de saison.',
    descriptionEn:
      'Seven-vegetable couscous (carrots, courgettes, pumpkin, turnips, cabbage, chickpeas) and a seasonal fruit.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['gluten', 'celery', 'milk'],
    tags: ['vegetarian', 'halal'],
    photo: tray('09-couscous-sept-legumes'),
  },
  {
    nameFr: 'Escalope de poulet gratinée, spaghetti',
    nameEn: 'Chicken escalope au gratin, spaghetti',
    descriptionFr:
      'Escalope de poulet gratinée au fromage, spaghetti bolognaise et salade marocaine (tomates, concombre, oignon).',
    descriptionEn:
      'Chicken escalope au gratin, spaghetti bolognese and Moroccan salad (tomatoes, cucumber, onion).',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['gluten', 'milk', 'eggs', 'celery'],
    tags: ['halal'],
    photo: tray('10-escalope-gratinee-spaghetti'),
  },
  {
    nameFr: 'Lasagnes à la bolognaise',
    nameEn: 'Beef lasagne',
    descriptionFr:
      'Lasagnes à la bolognaise (bœuf, béchamel), salade composée et salade de fruits.',
    descriptionEn: 'Beef lasagne (bolognese, béchamel), mixed salad and a fruit salad.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['gluten', 'milk', 'eggs', 'celery'],
    tags: ['halal'],
    photo: tray('11-lasagnes-bolognaise'),
  },
  {
    nameFr: 'Tajine de poulet au citron confit',
    nameEn: 'Chicken tagine with preserved lemon',
    descriptionFr:
      'Tajine de poulet au citron confit et aux olives, frites, salade marocaine et brownie aux noix.',
    descriptionEn:
      'Chicken tagine with preserved lemon and olives, fries, Moroccan salad and a walnut brownie.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['nuts', 'gluten', 'eggs', 'milk'],
    tags: ['halal'],
    photo: tray('12-tajine-poulet-citron'),
  },
  {
    nameFr: 'Émincé de poulet à la crème, riz',
    nameEn: 'Creamy chicken strips, rice',
    descriptionFr: 'Émincé de poulet à la crème, riz, légumes vapeur et une banane.',
    descriptionEn: 'Creamy chicken strips, rice, steamed vegetables and a banana.',
    type: 'subscription',
    category: 'main',
    priceCents: 0,
    allergens: ['milk'],
    tags: ['halal'],
    photo: tray('13-emince-poulet-riz'),
  },
]

/**
 * Demo only: BFK menu items made active (with their allergens, EU-14) so the
 * demo menus offer supplements. `bfk:seed catalog` leaves all of them inactive.
 */
export const DEMO_ACTIVE_SUPPLEMENTS: Record<string, AllergenCode[]> = {
  'bfk-site:44': [], // Sidi Ali 50 cl
  'bfk-site:36': [], // Orange juice
  'bfk-site:38': [], // Apple juice
  'bfk-site:176': [], // Salade marocaine
  'bfk-site:133': ['gluten', 'celery'], // Harira
  'bfk-site:118': ['gluten'], // M'smen
  'bfk-site:89': ['gluten', 'eggs', 'milk'], // Churros
  'bfk-site:289': ['eggs', 'milk'], // Crème brûlée
}

/**
 * The demo meal catalog (development/test): the 13 trays, BFK's restaurant
 * menu (inactive supplements, D32) and the DEMO_ACTIVE_SUPPLEMENTS turned on.
 * Every photo goes through the real upload pipeline (MealPhotoService:
 * sniffing, sharp → WebP + thumbnail, Drive disk from DRIVE_DISK).
 * Idempotent: trays are matched by French name, menu items by
 * `external_recipe_ref`; photos are added only to meals that have none.
 */
export default class DemoCatalogSeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    await seedDemoMeals(DEMO_MEALS)
    await seedBfkMenu(await loadBfkMenu())
    for (const [ref, allergens] of Object.entries(DEMO_ACTIVE_SUPPLEMENTS)) {
      await Meal.query()
        .where('external_recipe_ref', ref)
        .whereNull('deleted_at')
        .update({ is_active: true, allergens })
    }
  }
}

/** The trays (no account involved): also used by `node ace bfk:seed catalog`. */
export async function seedDemoMeals(meals: DemoMeal[]) {
  const admin = await User.query().where('role', 'admin').orderBy('id').first()
  const photos = await app.container.make(MealPhotoService)

  for (const demo of meals) {
    const { photo, ...data } = demo
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
    await photos.upload(meal, [
      {
        clientName: photo.file,
        data: await readFile(app.makePath(DEMO_PHOTO_DIR, photo.file)),
        tooLarge: false,
      },
    ])
  }
}
