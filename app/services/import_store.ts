import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inject } from '@adonisjs/core'
import app from '@adonisjs/core/services/app'
import Clock from '#services/clock'

/** A previewed import waits at most this long for confirmation. */
const TTL_MINUTES = 60
/** Previews kept per user; uploading more drops that user's oldest ones. */
export const MAX_PENDING_IMPORTS_PER_USER = 5

type StoredImport = {
  userId: number
  schoolId: number
  createdAt: string
  /** Tie-breaker for previews stored in the same millisecond (see `nextSequence`). */
  seq?: number
  content: string
}

/**
 * Monotonic counter of this process: two previews created in the same
 * millisecond (or under a frozen Clock) still have a strict order, so the
 * per-user cap always drops the oldest ones — never the newest.
 */
let sequence = 0
function nextSequence() {
  sequence += 1
  return sequence
}

/**
 * Keeps an uploaded CSV between "preview" and "confirm" in tmp/imports
 * (one JSON file per upload, named by a random UUID, bound to the uploader
 * and their school). Files are deleted on confirm and after TTL_MINUTES.
 * Single-server storage: fine for the cPanel/VPS target (no shared disk).
 */
@inject()
export default class ImportStore {
  constructor(protected clock: Clock) {}

  protected get directory() {
    return app.tmpPath('imports')
  }

  protected path(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid import id')
    return join(this.directory, `${id}.json`)
  }

  async put(userId: number, schoolId: number, content: string): Promise<string> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await this.purgeExpired(userId)
    const id = randomUUID()
    const payload: StoredImport = {
      userId,
      schoolId,
      createdAt: this.clock.now().toISO()!,
      seq: nextSequence(),
      content,
    }
    await writeFile(this.path(id), JSON.stringify(payload), { mode: 0o600 })
    return id
  }

  /** The stored file content, only for its uploader, and only while fresh. */
  async get(id: string, userId: number, schoolId: number): Promise<string | null> {
    let payload: StoredImport
    try {
      payload = JSON.parse(await readFile(this.path(id), 'utf8')) as StoredImport
    } catch {
      return null
    }
    if (payload.userId !== userId || payload.schoolId !== schoolId) return null
    if (this.isExpired(payload)) {
      await this.delete(id)
      return null
    }
    return payload.content
  }

  async delete(id: string) {
    await rm(this.path(id), { force: true })
  }

  protected isExpired(payload: StoredImport) {
    const created = Date.parse(payload.createdAt)
    const age = this.clock.now().toMillis() - created
    return Number.isNaN(created) || age > TTL_MINUTES * 60_000
  }

  /**
   * Deletes expired previews, and keeps at most MAX_PENDING_IMPORTS_PER_USER - 1
   * of `userId`'s (oldest first) so the upload being stored fits the cap.
   */
  protected async purgeExpired(userId?: number) {
    const mine: { file: string; at: number; seq: number }[] = []
    for (const name of await readdir(this.directory).catch(() => [] as string[])) {
      if (!name.endsWith('.json')) continue
      const file = join(this.directory, name)
      try {
        const payload = JSON.parse(await readFile(file, 'utf8')) as StoredImport
        if (this.isExpired(payload)) await rm(file, { force: true })
        else if (payload.userId === userId) {
          mine.push({ file, at: Date.parse(payload.createdAt), seq: payload.seq ?? 0 })
        }
      } catch {
        await rm(file, { force: true })
      }
    }
    // Oldest first: creation instant, then the in-process sequence (ties).
    mine.sort((a, b) => a.at - b.at || a.seq - b.seq)
    for (const entry of mine.slice(
      0,
      Math.max(0, mine.length - MAX_PENDING_IMPORTS_PER_USER + 1)
    )) {
      await rm(entry.file, { force: true })
    }
  }
}
