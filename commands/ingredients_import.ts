import { BaseCommand, args } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'

/**
 * D55: imports the kitchen's article list as the ingredient catalog (active
 * food/drinks only). Reads database/catalog/articles.csv by default, or the
 * file given as an argument. Idempotent (upsert by Code).
 *
 *   node ace bfk:import-ingredients
 *   node ace bfk:import-ingredients ./articles.csv
 */
export default class IngredientsImport extends BaseCommand {
  static commandName = 'bfk:import-ingredients'
  static description = 'Import the ingredient catalog from the kitchen article CSV'
  static options: CommandOptions = { startApp: true }

  @args.string({
    description: 'CSV path (default: database/catalog/articles.csv)',
    required: false,
  })
  declare path?: string

  async run() {
    const { default: IngredientImportService } = await import('#services/ingredient_import_service')
    const service = await this.app.container.make(IngredientImportService)
    const result = await service.importFromFile(this.path)
    this.logger.success(
      `Ingredients: ${result.imported} added, ${result.updated} updated ` +
        `(${result.skipped} non-food/inactive skipped of ${result.total} rows).`
    )
  }
}
