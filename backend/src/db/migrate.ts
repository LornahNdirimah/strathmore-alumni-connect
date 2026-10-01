/**
 * Forward-only migration runner.
 *
 * Applies every .sql file in ./migrations in filename order, exactly once,
 * each inside a transaction. Kept deliberately small — a project this size
 * does not need a migration framework, but it does need "did this already
 * run?" to be answered by the database rather than by convention.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMainModule } from '../lib/main-module.js'
import { type Database, getDatabase, transaction } from './connection.js'

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

type MigrationRow = { name: string; checksum: string }

function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      checksum   TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)
}

function checksumOf(sql: string): string {
  return createHash('sha256').update(sql).digest('hex').slice(0, 16)
}

/**
 * A migration that rebuilds a table declares this on a line of its own.
 *
 * SQLite cannot alter a column's constraints in place; the documented method
 * (https://sqlite.org/lang_altertable.html, "making other kinds of table schema
 * changes") is to create the new table, copy, drop the old one and rename. With
 * foreign keys enforced, dropping a parent table would cascade-delete every
 * child row, so enforcement must be off — and `PRAGMA foreign_keys` is a no-op
 * inside a transaction, so it has to be switched outside it. Integrity is then
 * checked with `foreign_key_check` before the transaction commits.
 */
const FOREIGN_KEYS_OFF_DIRECTIVE = /^--\s*migrate:\s*foreign_keys=off\s*$/m

function applyMigration(db: Database, file: string, sql: string, checksum: string): void {
  const rebuild = FOREIGN_KEYS_OFF_DIRECTIVE.test(sql)
  if (rebuild) db.exec('PRAGMA foreign_keys = OFF')

  try {
    transaction(db, () => {
      db.exec(sql)

      if (rebuild) {
        const violations = db.prepare('PRAGMA foreign_key_check').all()
        if (violations.length > 0) {
          throw new Error(
            `Migration "${file}" left ${violations.length} foreign-key violation(s): ` +
              JSON.stringify(violations.slice(0, 5)),
          )
        }
      }

      db.prepare('INSERT INTO _migrations (name, checksum, applied_at) VALUES (?, ?, ?)').run(
        file,
        checksum,
        new Date().toISOString(),
      )
    })
  } finally {
    if (rebuild) db.exec('PRAGMA foreign_keys = ON')
  }
}

export function runMigrations(db: Database = getDatabase()): string[] {
  ensureMigrationsTable(db)

  const applied = new Map(
    (db.prepare('SELECT name, checksum FROM _migrations').all() as MigrationRow[]).map((row) => [
      row.name,
      row.checksum,
    ]),
  )

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  const newlyApplied: string[] = []

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8')
    const checksum = checksumOf(sql)
    const previous = applied.get(file)

    if (previous !== undefined) {
      // An already-applied migration whose contents changed means the file was
      // edited after the fact — the database and the source no longer agree,
      // and silently continuing would hide real schema drift.
      if (previous !== checksum) {
        throw new Error(
          `Migration "${file}" has already been applied but its contents changed ` +
            `(recorded ${previous}, found ${checksum}). Add a new migration instead of ` +
            `editing an applied one, or run "npm run reset" to rebuild the database.`,
        )
      }
      continue
    }

    applyMigration(db, file, sql, checksum)
    newlyApplied.push(file)
  }

  return newlyApplied
}

// Allow `npm run migrate` to invoke this directly.
if (isMainModule(import.meta.url)) {
  const applied = runMigrations()
  if (applied.length === 0) {
    console.log('Database is up to date; no migrations to apply.')
  } else {
    console.log(`Applied ${applied.length} migration(s):`)
    for (const name of applied) console.log(`  - ${name}`)
  }
}
