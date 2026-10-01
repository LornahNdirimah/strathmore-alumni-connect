/**
 * SQLite connection built on Node's built-in `node:sqlite` (Node >= 22.5).
 *
 * Chosen over better-sqlite3/Prisma deliberately: no native compilation step,
 * no engine binary download, no database server to start before a demo. The
 * cost is that `node:sqlite` is still flagged experimental upstream, so the API
 * surface is kept behind this module — if it has to be swapped later, only this
 * file and `repository.ts` change.
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'

import { env } from '../config/env.js'

/**
 * `node:sqlite` is loaded through createRequire rather than a static import.
 *
 * Node deliberately omits "sqlite" from `module.builtinModules` (it is
 * prefix-only), so bundlers that special-case `node:` imports strip the prefix,
 * try to resolve a bare `sqlite` package, and fail — which is exactly what
 * Vitest does. Resolving it at runtime hands the decision back to Node. The
 * type-only import above is erased at compile time, so it never reaches a
 * bundler.
 */
const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite')

export type Database = DatabaseSyncType

let instance: Database | null = null

/**
 * Applies the pragmas we want on every connection.
 *
 * `foreign_keys` is OFF by default in SQLite — without this the FK constraints
 * declared in the migrations would be inert documentation rather than enforced
 * rules, which is exactly the class of bug this schema exists to prevent.
 */
function applyPragmas(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA busy_timeout = 5000')
}

export function openDatabase(databasePath: string = env.DATABASE_PATH): Database {
  const absolutePath = databasePath === ':memory:' ? databasePath : resolve(databasePath)

  if (absolutePath !== ':memory:') {
    mkdirSync(dirname(absolutePath), { recursive: true })
  }

  const db = new DatabaseSync(absolutePath)
  applyPragmas(db)
  return db
}

/** Process-wide connection. SQLite is single-writer, so one handle is correct here. */
export function getDatabase(): Database {
  if (!instance) {
    instance = openDatabase()
  }
  return instance
}

export function closeDatabase(): void {
  if (instance) {
    instance.close()
    instance = null
  }
}

/**
 * Runs `fn` inside a transaction, rolling back on any throw.
 *
 * Used wherever a single API call has to write more than one row and a partial
 * write would corrupt state — e.g. accepting a mentorship request writes the
 * request status, the new relationship, the capacity decrement and the match
 * event, and any one of those failing must undo the rest.
 */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
