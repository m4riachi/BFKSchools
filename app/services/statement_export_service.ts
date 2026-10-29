import { PassThrough, type Readable } from 'node:stream'
import logger from '@adonisjs/core/services/logger'
import i18nManager from '@adonisjs/i18n/services/main'
import ExcelJS from 'exceljs'
import type { SchoolStatement } from '#services/statement_service'
import { safeCell } from '#support/spreadsheet_safety'
import { monthLabel } from '#support/statement_month'

/** Centimes as a MAD number with 2 decimals (integer maths, then one parse — no float arithmetic). */
export function centsToNumber(cents: number): number {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return Number(`${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`)
}

/**
 * Excel export of the statements of every family of a school for a month
 * (back-office): sheet 1 one row per family, sheet 2 one row per child,
 * both with a total row. No email addresses (D28): names, children and
 * amounts only. Built from the `SchoolStatement` already computed
 * (bounded by the number of children of the school) and written with the
 * streaming workbook writer. Every text cell goes through `safeCell()`;
 * amounts are numbers (format 0.00 MAD).
 */
export default class StatementExportService {
  xlsx(statement: SchoolStatement, locale: string): Readable {
    const output = new PassThrough()
    const i18n = i18nManager.locale(locale)
    const label = (key: string) => safeCell(i18n.t(`statements.export.${key}`))
    const money = { numFmt: '0.00' }
    const billed = (mode: string) => safeCell(i18n.t(`statements.billing_modes.${mode}`))

    const run = async () => {
      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: output,
        useStyles: true,
        useSharedStrings: false,
      })
      workbook.creator = 'BFK School Meals'

      const familySheet = workbook.addWorksheet(label('families_sheet').slice(0, 31), {
        views: [{ state: 'frozen', ySplit: 2 }],
      })
      familySheet.columns = [
        { key: 'parent', width: 28 },
        { key: 'children', width: 10 },
        { key: 'sub_count', width: 14 },
        { key: 'sub_amount', width: 16, style: money },
        { key: 'sup_count', width: 14 },
        { key: 'sup_amount', width: 16, style: money },
        { key: 'total', width: 16, style: money },
      ]
      familySheet
        .addRow([
          safeCell(
            i18n.t('statements.export.title', { month: monthLabel(statement.month, locale) })
          ),
          statement.provisional ? label('provisional') : '',
        ])
        .commit()
      const familyHeader = familySheet.addRow([
        label('parent'),
        label('children'),
        label('subscription_count'),
        label('subscription_amount'),
        label('supplement_count'),
        label('supplement_amount'),
        label('total'),
      ])
      familyHeader.font = { bold: true }
      familyHeader.commit()
      for (const family of statement.families) {
        familySheet
          .addRow([
            safeCell(family.parentName),
            family.children.length,
            family.totals.subscriptionCount,
            centsToNumber(family.totals.subscriptionCents),
            family.totals.supplementCount,
            centsToNumber(family.totals.supplementCents),
            centsToNumber(family.totals.totalCents),
          ])
          .commit()
      }
      const familyTotal = familySheet.addRow([
        label('grand_total'),
        statement.totals.children,
        statement.totals.subscriptionCount,
        centsToNumber(statement.totals.subscriptionCents),
        statement.totals.supplementCount,
        centsToNumber(statement.totals.supplementCents),
        centsToNumber(statement.totals.totalCents),
      ])
      familyTotal.font = { bold: true }
      familyTotal.commit()
      familySheet.commit()

      const childSheet = workbook.addWorksheet(label('children_sheet').slice(0, 31), {
        views: [{ state: 'frozen', ySplit: 1 }],
      })
      childSheet.columns = [
        { key: 'parent', width: 28 },
        { key: 'last_name', width: 18 },
        { key: 'first_name', width: 18 },
        { key: 'grade', width: 8 },
        { key: 'class', width: 10 },
        { key: 'billing', width: 18 },
        { key: 'sub_count', width: 14 },
        { key: 'sub_amount', width: 16, style: money },
        { key: 'sup_count', width: 14 },
        { key: 'sup_amount', width: 16, style: money },
        { key: 'total', width: 16, style: money },
      ]
      const childHeader = childSheet.addRow([
        label('parent'),
        label('last_name'),
        label('first_name'),
        label('grade'),
        label('class'),
        label('billing'),
        label('subscription_count'),
        label('subscription_amount'),
        label('supplement_count'),
        label('supplement_amount'),
        label('total'),
      ])
      childHeader.font = { bold: true }
      childHeader.commit()
      for (const family of statement.families) {
        for (const child of family.children) {
          childSheet
            .addRow([
              safeCell(family.parentName),
              safeCell(child.lastName),
              safeCell(child.firstName),
              safeCell(child.grade),
              safeCell(child.className),
              billed(child.billedAs),
              child.totals.subscriptionCount,
              centsToNumber(child.totals.subscriptionCents),
              child.totals.supplementCount,
              centsToNumber(child.totals.supplementCents),
              centsToNumber(child.totals.totalCents),
            ])
            .commit()
        }
      }
      const childTotal = childSheet.addRow([
        label('grand_total'),
        '',
        '',
        '',
        '',
        '',
        statement.totals.subscriptionCount,
        centsToNumber(statement.totals.subscriptionCents),
        statement.totals.supplementCount,
        centsToNumber(statement.totals.supplementCents),
        centsToNumber(statement.totals.totalCents),
      ])
      childTotal.font = { bold: true }
      childTotal.commit()
      childSheet.commit()
      await workbook.commit()
    }
    run().catch((error) => {
      logger.error({ error: (error as Error)?.name ?? 'Error' }, 'statement export (xlsx) failed')
      output.destroy(error as Error)
    })
    return output
  }
}
