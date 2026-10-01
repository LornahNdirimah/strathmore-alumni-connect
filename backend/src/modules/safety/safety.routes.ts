import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { parseOrThrow } from '../../lib/validate.js'
import * as service from './safety.service.js'

/** Blocking and reporting for every signed-in account (DESIGN_BACKLOG #42). */
export async function safetyRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireUserId(request: { currentUser?: { sub: string } }): string {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    return userId
  }

  app.get('/blocks', { preHandler: app.requireAuth }, async (request) => ({
    blocked: service.listBlocked(db, requireUserId(request)),
  }))

  app.post('/blocks', { preHandler: app.requireAuth }, async (request) => {
    const { userId } = parseOrThrow(service.blockSchema, request.body, 'block')
    const user = service.block(db, requireUserId(request), userId)
    return { message: `You blocked ${user.name}. Neither of you can message or send requests to the other.` }
  })

  app.delete('/blocks/:userId', { preHandler: app.requireAuth }, async (request) => {
    const { userId } = request.params as { userId: string }
    service.unblock(db, requireUserId(request), userId)
    return { message: 'Unblocked.' }
  })

  app.post('/reports', { preHandler: app.requireAuth }, async (request, reply) => {
    const input = parseOrThrow(service.reportSchema, request.body, 'report')
    service.fileReport(db, requireUserId(request), input)
    return reply
      .code(201)
      .send({ message: 'Thank you. An administrator will review your report; you will hear when they have.' })
  })
}
