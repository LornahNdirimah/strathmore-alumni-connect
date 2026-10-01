/**
 * Process entry point: migrate, build the app, listen, and shut down cleanly.
 */
import { buildApp } from './app.js'
import { env } from './config/env.js'
import { closeDatabase, getDatabase } from './db/connection.js'
import { runMigrations } from './db/migrate.js'
import { isMainModule } from './lib/main-module.js'

async function start(): Promise<void> {
  // Migrations run before the first request rather than as a separate manual
  // step, so a freshly cloned checkout boots into a working state.
  const applied = runMigrations(getDatabase())

  const app = await buildApp()

  if (applied.length > 0) {
    app.log.info({ applied }, 'Applied pending database migrations')
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down')
    try {
      await app.close()
      closeDatabase()
      process.exit(0)
    } catch (error) {
      app.log.error({ err: error }, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))

  await app.listen({ port: env.PORT, host: env.HOST })
}

if (isMainModule(import.meta.url)) {
  start().catch((error) => {
    console.error('Failed to start server:', error)
    process.exit(1)
  })
}
