import { randomUUID } from 'node:crypto'
import factory from '@adonisjs/lucid/factories'
import School from '#models/school'

let sequence = 0

export const SchoolFactory = factory
  .define(School, () => {
    sequence += 1
    return {
      name: `School ${sequence}`,
      slug: `school-${sequence}-${randomUUID().slice(0, 8)}`,
      timezone: 'Africa/Casablanca',
      schoolDays: [1, 2, 3, 4, 5],
      schoolYearStart: '2026-08-24',
      schoolYearEnd: '2027-06-11',
      settings: {},
    }
  })
  .build()
