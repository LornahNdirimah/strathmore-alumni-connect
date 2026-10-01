/**
 * `npm run db:backup` — a consistent copy of the live database (DESIGN_BACKLOG #57).
 *
 * Uses SQLite's online backup API, so it is safe while the API is running and
 * writing: the copy is a single point-in-time snapshot, which copying the
 * file (and its -wal) by hand is not. Each copy is integrity-checked before it
 * counts, and only the newest BACKUP_KEEP are kept.
 *
 * Schedule it from cron (or a systemd timer), e.g. nightly at 02:30:
 *   30 2 * * *  cd /srv/alumni-connect && npm run db:backup >> backups.log 2>&1
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

import { env } from '../config/env.js'
import { isMainModule } from '../lib/main-module.js'

// See connection.ts for why node:sqlite is loaded this way.
const nodeRequire = createRequire(import.meta.url)
const sqlite = nodeRequire('node:sqlite') as typeof import('node:sqlite')

const PREFIX = 'app-'

function stamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

export async function backupDatabase(options: {
  databasePath?: string
  directory?: string
  keep?: number
  now?: Date
} = {}): Promise<{ file: string; removed: string[] }> {
  const source = resolve(options.databasePath ?? env.DATABASE_PATH)
  const directory = resolve(options.directory ?? env.BACKUP_DIR ?? join(dirname(source), 'backups'))
  const keep = options.keep ?? env.BACKUP_KEEP
  mkdirSync(directory, { recursive: true })

  const file = join(directory, `${PREFIX}${stamp(options.now ?? new Date())}.db`)
  const db = new sqlite.DatabaseSync(source, { readOnly: true })
  try {
    await sqlite.backup(db, file)
  } finally {
    db.close()
  }

  // The copy inherits WAL mode; switching it back makes the backup one
  // self-contained file rather than three.
  const copy = new sqlite.DatabaseSync(file)
  try {
    copy.exec('PRAGMA journal_mode = DELETE')
    const result = copy.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    if (result.integrity_check !== 'ok') {
      throw new Error(`The backup failed its integrity check: ${result.integrity_check}`)
    }
  } catch (error) {
    copy.close()
    rmSync(file, { force: true })
    throw error
  }
  copy.close()

  // Names sort by time, so the oldest are first.
  const backups = readdirSync(directory)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith('.db'))
    .sort()
  const removed = backups.slice(0, Math.max(0, backups.length - keep))
  for (const name of removed) rmSync(join(directory, name), { force: true })

  return { file, removed }
}

if (isMainModule(import.meta.url)) {
  backupDatabase()
    .then(({ file, removed }) => {
      console.log(`Backed up to ${file}`)
      if (removed.length > 0) console.log(`Removed ${removed.length} older backup(s).`)
    })
    .catch((error) => {
      console.error('Backup failed:', error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
