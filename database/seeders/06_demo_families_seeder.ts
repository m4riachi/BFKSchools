import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'
import School from '#models/school'
import User from '#models/user'
import Child from '#models/child'
import Subscription from '#models/subscription'
import Clock from '#services/clock'
import type { AllergenCode } from '#enums/allergens'
import type { AppLocale } from '#enums/locales'
import { DEMO_FAMILY_DOMAIN, assertDemoSeeding, demoPassword } from '#database/demo/support'

type DemoChild = {
  firstName: string
  grade: string
  className: string
  allergies?: AllergenCode[]
  dietaryNotes?: string
  /** No subscription period (D2: supplements only). */
  noSubscription?: boolean
  isActive?: boolean
}

type DemoFamily = {
  fullName: string
  locale: AppLocale
  phone: string
  /** accepted = password set (can sign in) · invited = link sent, no password · none = never invited */
  access: 'accepted' | 'invited' | 'none'
  children: DemoChild[]
}

/**
 * 14 families (+ parent@bfk.test from 03_demo_family_seeder = 15 parents),
 * 1–3 children each: mixed grades/classes, some allergies and dietary notes,
 * some children without a subscription, one inactive child; most parents
 * can sign in (password Demo1234!), two are only invited, one never invited.
 */
export const DEMO_FAMILIES: DemoFamily[] = [
  {
    fullName: 'Karima Alaoui',
    locale: 'fr',
    phone: '+212661000101',
    access: 'accepted',
    children: [
      { firstName: 'Yanis', grade: 'G1', className: '1A' },
      { firstName: 'Nour', grade: 'G4', className: '4A', allergies: ['peanuts', 'nuts'] },
    ],
  },
  {
    fullName: 'Mehdi Bennis',
    locale: 'fr',
    phone: '+212661000102',
    access: 'accepted',
    children: [{ firstName: 'Sara', grade: 'G2', className: '2A' }],
  },
  {
    fullName: 'Leila Chraibi',
    locale: 'en',
    phone: '+212661000103',
    access: 'accepted',
    children: [
      { firstName: 'Rayan', grade: 'KG1', className: 'KG1-A', allergies: ['milk'] },
      { firstName: 'Inès', grade: 'G3', className: '3A' },
      { firstName: 'Omar', grade: 'G5', className: '5A', noSubscription: true },
    ],
  },
  {
    fullName: 'Youssef El Fassi',
    locale: 'fr',
    phone: '+212661000104',
    access: 'accepted',
    children: [
      {
        firstName: 'Maya',
        grade: 'G3',
        className: '3B',
        allergies: ['gluten'],
        dietaryNotes: 'Coeliac disease: strictly gluten-free.',
      },
    ],
  },
  {
    fullName: 'Hanane Tazi',
    locale: 'fr',
    phone: '+212661000105',
    access: 'accepted',
    children: [
      { firstName: 'Adam', grade: 'KG2', className: 'KG2-A' },
      { firstName: 'Lina', grade: 'G2', className: '2B', allergies: ['eggs'] },
    ],
  },
  {
    fullName: 'Robert Miller',
    locale: 'en',
    phone: '+212661000106',
    access: 'accepted',
    children: [
      { firstName: 'Emma', grade: 'G4', className: '4A', dietaryNotes: 'Vegetarian (no meat).' },
      { firstName: 'Noah', grade: 'G1', className: '1B' },
    ],
  },
  {
    fullName: 'Samira Berrada',
    locale: 'fr',
    phone: '+212661000107',
    access: 'accepted',
    children: [{ firstName: 'Ilyas', grade: 'G5', className: '5A', allergies: ['fish'] }],
  },
  {
    fullName: 'Hamza Kettani',
    locale: 'fr',
    phone: '+212661000108',
    access: 'accepted',
    children: [
      { firstName: 'Salma', grade: 'G3', className: '3A' },
      { firstName: 'Ali', grade: 'KG1', className: 'KG1-A', noSubscription: true },
    ],
  },
  {
    fullName: 'Nadia Benjelloun',
    locale: 'en',
    phone: '+212661000109',
    access: 'accepted',
    children: [
      { firstName: 'Zineb', grade: 'G2', className: '2A', allergies: ['sesame'] },
      { firstName: 'Amine', grade: 'G4', className: '4B' },
      { firstName: 'Rim', grade: 'KG2', className: 'KG2-A' },
    ],
  },
  {
    fullName: 'Omar Lahlou',
    locale: 'fr',
    phone: '+212661000110',
    access: 'accepted',
    children: [
      { firstName: 'Kenza', grade: 'G1', className: '1A' },
      { firstName: 'Ayoub', grade: 'G5', className: '5B', isActive: false },
    ],
  },
  {
    fullName: 'Fatima Zahra Idrissi',
    locale: 'fr',
    phone: '+212661000111',
    access: 'accepted',
    children: [{ firstName: 'Hiba', grade: 'G3', className: '3B', allergies: ['soybeans'] }],
  },
  {
    fullName: 'Sophie Laurent',
    locale: 'fr',
    phone: '+212661000112',
    access: 'invited',
    children: [
      { firstName: 'Lucas', grade: 'G2', className: '2B' },
      { firstName: 'Chloé', grade: 'KG1', className: 'KG1-A', noSubscription: true },
    ],
  },
  {
    fullName: 'Anas Sefrioui',
    locale: 'fr',
    phone: '+212661000113',
    access: 'invited',
    children: [{ firstName: 'Yasmine', grade: 'G4', className: '4A' }],
  },
  {
    fullName: 'Khalid Amrani',
    locale: 'fr',
    phone: '+212661000114',
    access: 'none',
    children: [
      { firstName: 'Mohamed', grade: 'G1', className: '1B', allergies: ['milk', 'eggs'] },
      { firstName: 'Aya', grade: 'G3', className: '3A' },
    ],
  },
]

function emailOf(fullName: string) {
  const slug = fullName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, '.')
    .replace(/^\.|\.$/g, '')
  return `${slug}@${DEMO_FAMILY_DOMAIN}`
}

/**
 * Demo families (development/test only). Idempotent: parents are matched
 * by email, children by (parent, first name); a subscription period
 * covering the school year is created once for subscribed children.
 */
export default class DemoFamiliesSeeder extends BaseSeeder {
  static environment = ['development', 'test']

  async run() {
    assertDemoSeeding()
    const school = await School.findByOrFail('slug', 'britech-school')
    const clock = await app.container.make(Clock)

    for (const family of DEMO_FAMILIES) {
      const email = emailOf(family.fullName)
      let parent = await User.findByEmail(email)
      if (!parent) {
        parent = await User.create({
          email,
          fullName: family.fullName,
          role: 'parent',
          locale: family.locale,
          phone: family.phone,
          schoolId: school.id,
          isActive: true,
          password: family.access === 'accepted' ? demoPassword() : null,
          invitedAt: family.access === 'none' ? null : clock.now().minus({ days: 40 }),
          notificationPrefs: {},
          credentialsVersion: 0,
        })
      }

      const lastName = family.fullName.split(' ').slice(-1)[0]
      for (const data of family.children) {
        let child = await Child.query()
          .where('parent_id', parent.id)
          .whereRaw('lower(first_name) = ?', [data.firstName.toLowerCase()])
          .first()
        if (!child) {
          child = await Child.create({
            parentId: parent.id,
            schoolId: school.id,
            firstName: data.firstName,
            lastName,
            grade: data.grade,
            className: data.className,
            allergies: data.allergies ?? [],
            dietaryNotes: data.dietaryNotes ?? null,
            isActive: data.isActive ?? true,
          })
        }
        if (data.noSubscription) continue
        const hasPeriod = await Subscription.query().where('child_id', child.id).first()
        if (!hasPeriod) {
          await Subscription.create({
            childId: child.id,
            startDate: school.schoolYearStart,
            endDate: school.schoolYearEnd,
            status: 'active',
          })
        }
      }
    }
  }
}
