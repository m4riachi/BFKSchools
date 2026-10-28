import factory from '@adonisjs/lucid/factories'
import Child from '#models/child'

let sequence = 0

const FIRST_NAMES = ['Adam', 'Lina', 'Yanis', 'Sara', 'Rayan', 'Inès', 'Omar', 'Maya']
const LAST_NAMES = ['Alaoui', 'Bennis', 'Chraibi', 'Fassi', 'Idrissi', 'Tazi']

/**
 * Children for tests. Set `parentId` and `schoolId` with `.merge()` or
 * create them through `UserFactory.with('children')`.
 */
export const ChildFactory = factory
  .define(Child, () => {
    sequence += 1
    return {
      firstName: `${FIRST_NAMES[sequence % FIRST_NAMES.length]}${sequence}`,
      lastName: LAST_NAMES[sequence % LAST_NAMES.length],
      grade: 'G3',
      className: '3B',
      allergies: [],
      dietaryNotes: null,
      isActive: true,
    }
  })
  .state('inactive', (child) => (child.isActive = false))
  .build()
