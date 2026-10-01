import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { queryScalar } from '../../db/repository.js'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Liveness + dependency status. Public by design — a health probe that needs
   * credentials is not much use to a process manager or a demo operator.
   * Reports only whether dependencies work, never their configuration.
   */
  app.get('/', async (_request, reply) => {
    let database: 'ok' | 'error' = 'ok'
    try {
      queryScalar<number>(getDatabase(), 'SELECT 1 AS ok')
    } catch {
      database = 'error'
    }

    const matching = app.matching.getStatus()
    // Matching being unavailable is a degradation, not an outage: every other
    // endpoint works, and recommendations fall back to a deterministic ranking.
    const status = database === 'ok' ? 'ok' : 'error'

    return reply.code(status === 'ok' ? 200 : 503).send({
      status,
      database,
      matching: matching.state,
      matchingError: matching.lastError,
      uptimeSeconds: Math.round(process.uptime()),
    })
  })
}
