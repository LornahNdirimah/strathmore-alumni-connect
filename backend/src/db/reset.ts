/**
 * Drops the SQLite file and rebuilds it from migrations + seed.
 * Development convenience only — refuses to run under NODE_ENV=production.
 */
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { env, isProduction } from '../config/env.js'
import { isMainModule } from '../lib/main-module.js'
import { closeDatabase } from './connection.js'
import { runMigrations } from './migrate.js'

export function resetDatabase(): void {
  if (isProduction) {
    throw new Error('Refusing to reset the database in production.')
  }

  closeDatabase()

  const path = resolve(env.DATABASE_PATH)
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${path}${suffix}`, { force: true })
  }
}

if (isMainModule(import.meta.url)) {
  resetDatabase()
  const applied = runMigrations()
  console.log(`Database reset. Applied ${applied.length} migration(s).`)
  console.log('Run "npm run seed" to load demo data.')
}
