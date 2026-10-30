import { BaseSchema } from '@adonisjs/lucid/schema'

/** D44: the school's real name. Its slug stays `britech-school` (internal only). */
export default class extends BaseSchema {
  async up() {
    this.defer(async (db) => {
      await db
        .from('schools')
        .where('name', 'Britech School')
        .update({ name: 'British Academy School Marrakech' })
    })
  }

  async down() {
    this.defer(async (db) => {
      await db
        .from('schools')
        .where('name', 'British Academy School Marrakech')
        .update({ name: 'Britech School' })
    })
  }
}
