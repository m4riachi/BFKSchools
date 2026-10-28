import { parentPort, workerData } from 'node:worker_threads'
import { IcsInvalidError, parseIcs } from '#services/ics_parser'

/**
 * Worker thread that parses one untrusted ICS calendar (see IcsParser in
 * app/services/ics_parser.ts): the main thread caps its heap with
 * `resourceLimits` and terminates it after a timeout, so a hostile file can
 * never block the HTTP server's event loop or exhaust its memory.
 * Input: { content, periodStart, periodEnd }. Output: one message,
 * `{ ok: true, result }` or `{ ok: false, reason }`.
 */
const { content, periodStart, periodEnd } = workerData as {
  content: string
  periodStart: string
  periodEnd: string
}

try {
  parentPort!.postMessage({ ok: true, result: parseIcs(content, periodStart, periodEnd) })
} catch (error) {
  parentPort!.postMessage({
    ok: false,
    reason: error instanceof IcsInvalidError ? error.reason : 'unreadable',
  })
}
