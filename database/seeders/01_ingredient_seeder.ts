import { existsSync } from 'node:fs'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import IngredientImportService from '#services/ingredient_import_service'

/**
 * D55: the ingredient catalog, imported from the kitchen's article CSV
 * (`database/catalog/articles.csv`, active food/drinks only). Runs in
 * development and production so `db:seed` fills it on every deploy — an
 * idempotent upsert, so re-running only updates labels. Skipped in tests,
 * which build their own ingredient fixtures. If the bundled CSV is missing
 * (unexpected), it logs and skips rather than failing the whole seed.
 */
export default class IngredientSeeder extends BaseSeeder {
  static environment = ['development', 'production']

  async run() {
    const service = await app.container.make(IngredientImportService)
    const path = service.defaultPath()
    if (!existsSync(path)) {
      logger.warn({ path }, 'ingredient catalog CSV not found — skipping ingredient seed')
      return
    }
    const result = await service.importFromFile(path)
    logger.info(
      { imported: result.imported, updated: result.updated, skipped: result.skipped },
      'ingredient catalog seeded'
    )
  }
}
