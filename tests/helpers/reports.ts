import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import type School from '#models/school'
import type User from '#models/user'
import type Child from '#models/child'
import ProductionReportService from '#services/production_report_service'
import DashboardService from '#services/dashboard_service'
import type { AllergenCode } from '#enums/allergens'
import type { IsoDate } from '#support/dates'
import { addChild, family, orders } from '#tests/helpers/orders'

export function reports() {
  return app.container.make(ProductionReportService)
}

export function dashboards() {
  return app.container.make(DashboardService)
}

/** A family (one child) with a grade / class / allergies, subscribed unless told otherwise. */
export async function pupil(
  school: School,
  options: {
    grade?: string | null
    className?: string | null
    allergies?: AllergenCode[]
    subscribed?: boolean
    firstName?: string
    lastName?: string
    dietaryNotes?: string | null
    parent?: Partial<User>
  } = {}
) {
  const { parent, child } = await family(school, {
    subscribed: options.subscribed,
    allergies: options.allergies,
    parent: options.parent,
    child: {
      grade: options.grade === undefined ? 'G3' : options.grade,
      className: options.className === undefined ? '3B' : options.className,
      dietaryNotes: options.dietaryNotes ?? null,
      ...(options.firstName ? { firstName: options.firstName } : {}),
      ...(options.lastName ? { lastName: options.lastName } : {}),
    } as Partial<Child>,
  })
  return { parent, child }
}

export { addChild }

/** Parent order for a day (main meal + extras). */
export async function order(
  parent: User,
  child: Child,
  date: IsoDate,
  mainId: number | null,
  supplements: { mealId: number; qty: number }[] = []
) {
  const service = await orders()
  return service.saveDay(
    child.id,
    date,
    { subscriptionMealId: mainId, supplements },
    { user: parent }
  )
}

/**
 * Counts the SQL queries run by `work` (knex `query` event on the shared
 * client: every Lucid query client of the connection goes through it).
 */
export async function countQueries(work: () => Promise<unknown>): Promise<number> {
  const knex = db.connection().getWriteClient()
  let count = 0
  const listener = () => (count += 1)
  knex.on('query', listener)
  try {
    await work()
  } finally {
    knex.removeListener('query', listener)
  }
  return count
}

/**
 * Makes the API client keep a streamed binary body (xlsx) as a Buffer:
 * superagent only buffers known binary types by itself (the PDF, sent in
 * one piece, already comes back as a Buffer).
 */
export function asBinary<T extends { request: { buffer: Function; parse: Function } }>(
  request: T
): T {
  request.request.buffer(true).parse((res: NodeJS.ReadableStream, callback: Function) => {
    const chunks: Buffer[] = []
    res.on('data', (chunk: Buffer) => chunks.push(chunk))
    res.on('end', () => callback(null, Buffer.concat(chunks)))
  })
  return request
}

/** Rows of a CSV export (BOM, header and the trailing CRLF removed). */
export function csvRows(text: string, delimiter = ';'): string[][] {
  const bom = String.fromCodePoint(0xfeff)
  const body = (text.startsWith(bom) ? text.slice(1) : text).replace(/\r\n$/, '')
  return body.split('\r\n').map((line) => splitCsvLine(line, delimiter))
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        current += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === delimiter) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells
}
