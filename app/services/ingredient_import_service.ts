import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'
import db from '@adonisjs/lucid/services/db'
import app from '@adonisjs/core/services/app'
import Clock from '#services/clock'
import { inject } from '@adonisjs/core'

/** Only these categories are ingredients for a fiche technique (D55). */
const FOOD_CATEGORIES = new Set(['NOURRITURE', 'BOISSONS'])

export type ImportResult = { total: number; imported: number; updated: number; skipped: number }

/**
 * D55: imports the kitchen's article list (CSV) as the ingredient catalog.
 * Only active food/drinks are kept (`Categorie` NOURRITURE/BOISSONS and
 * `Statut` true). Rows are upserted by `Code`, so re-running updates labels
 * and keeps the ids (fiches techniques stay valid). Idempotent.
 */
@inject()
export default class IngredientImportService {
  constructor(protected clock: Clock) {}

  /** The bundled catalog file (database/catalog/articles.csv). */
  defaultPath() {
    return app.makePath('database/catalog/articles.csv')
  }

  async importFromFile(path?: string): Promise<ImportResult> {
    const content = await readFile(path ?? this.defaultPath(), 'utf8')
    return this.importFromContent(content)
  }

  async importFromContent(content: string): Promise<ImportResult> {
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
    }) as Record<string, string>[]

    const rows = records
      .filter(
        (row) =>
          FOOD_CATEGORIES.has((row['Categorie'] ?? '').trim()) &&
          (row['Statut'] ?? '').trim().toLowerCase() === 'true' &&
          (row['Code'] ?? '').trim() &&
          (row['Libellé'] ?? row['Libelle'] ?? '').trim()
      )
      .map((row) => ({
        code: row['Code'].trim(),
        label: (row['Libellé'] ?? row['Libelle']).trim(),
        category: row['Categorie'].trim(),
        famille: (row['Famille'] ?? '').trim() || null,
        sous_famille: (row['Sous Famille'] ?? '').trim() || null,
        unit: (row['Unit'] ?? '').trim() || null,
      }))

    // Keep the last row for a duplicated code.
    const byCode = new Map(rows.map((row) => [row.code, row]))
    const now = this.clock.now().toISO()!
    let imported = 0
    let updated = 0

    await db.transaction(async (trx) => {
      const existingRows = await trx.from('ingredients').select('code')
      const existing = new Set<string>(existingRows.map((r) => r.code as string))
      for (const row of byCode.values()) {
        if (existing.has(row.code)) {
          await trx
            .from('ingredients')
            .where('code', row.code)
            .update({ ...row, updated_at: now })
          updated += 1
        } else {
          await trx.table('ingredients').insert({ ...row, created_at: now, updated_at: now })
          imported += 1
        }
      }
    })

    return {
      total: records.length,
      imported,
      updated,
      skipped: records.length - byCode.size,
    }
  }
}
