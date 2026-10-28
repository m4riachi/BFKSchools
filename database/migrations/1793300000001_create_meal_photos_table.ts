import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * docs/ERD.md §meal_photos. Both files are WebP re-encoded by the server
 * (original ≤ 1600 px + 400 px thumbnail) under random keys
 * `meals/<meal id>/<uuid>.webp` / `<uuid>_thumb.webp`. At most one cover per
 * meal (partial unique index); MealPhotoService keeps exactly one while the
 * meal has photos.
 */
export default class extends BaseSchema {
  protected tableName = 'meal_photos'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('meal_id').notNullable().references('id').inTable('meals').onDelete('CASCADE')
      table.text('disk').notNullable().defaultTo('fs')
      table.text('path').notNullable()
      table.text('thumb_path').notNullable()
      table.smallint('position').notNullable().defaultTo(0)
      table.boolean('is_cover').notNullable().defaultTo(false)
      table.integer('width').nullable()
      table.integer('height').nullable()
      table.integer('size_bytes').nullable()
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.index(['meal_id', 'position'], 'meal_photos_meal_id_position_index')
      table.unique(['path'], { indexName: 'meal_photos_path_unique' })
      table.unique(['thumb_path'], { indexName: 'meal_photos_thumb_path_unique' })
    })

    this.schema.raw(`
      ALTER TABLE meal_photos
        ADD CONSTRAINT meal_photos_position_check CHECK (position >= 0),
        ADD CONSTRAINT meal_photos_size_check CHECK (
          (width IS NULL OR width > 0) AND (height IS NULL OR height > 0)
          AND (size_bytes IS NULL OR size_bytes > 0)
        )
    `)
    this.schema.raw(`
      CREATE UNIQUE INDEX meal_photos_one_cover_per_meal
        ON meal_photos (meal_id) WHERE is_cover
    `)
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
