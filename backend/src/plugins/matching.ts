/**
 * Owns the matching worker's lifecycle and exposes it on the Fastify instance.
 *
 * Warmup runs in the background rather than blocking `listen()`: the worker's
 * ~6.3s import cost should not delay the API's readiness, since every endpoint
 * except recommendations works without it.
 */
import type { FastifyInstance } from 'fastify'
import fp from 'fastify-plugin'

import { getDatabase } from '../db/connection.js'
import { MatchingWorker } from '../services/matching/MatchingWorker.js'
import { rebuildIndex } from '../services/matching/matching.service.js'

declare module 'fastify' {
  interface FastifyInstance {
    matching: MatchingWorker
    /** Rebuilds the retrieval index from current mentor rows. */
    refreshMatchingIndex: () => Promise<void>
  }
}

async function matchingPlugin(app: FastifyInstance): Promise<void> {
  const worker = new MatchingWorker({
    logger: {
      info: (msg) => app.log.info(msg),
      warn: (msg) => app.log.warn(msg),
      error: (msg) => app.log.error(msg),
    },
  })

  app.decorate('matching', worker)

  app.decorate('refreshMatchingIndex', async () => {
    if (!worker.isUsable()) return
    try {
      const { count } = await rebuildIndex(getDatabase(), worker)
      app.log.info(`[matching] index rebuilt with ${count} mentors`)
    } catch (error) {
      app.log.error({ err: error }, '[matching] index rebuild failed')
    }
  })

  // Build the index whenever a worker process becomes ready — including after a
  // crash and restart, when the new process starts with an empty index.
  worker.onReady(() => void app.refreshMatchingIndex())

  worker.start()

  // Only for the log line: warmup failing is worth saying once, loudly.
  void worker.waitUntilReady().catch((error: Error) => {
    app.log.warn(`[matching] unavailable, recommendations will use fallback ranking: ${error.message}`)
  })

  app.addHook('onClose', async () => {
    await worker.stop()
  })
}

export default fp(matchingPlugin, { name: 'matching' })
