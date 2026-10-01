import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { getDatabase } from '../../db/connection.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { parseOrThrow } from '../../lib/validate.js'
import * as service from './office-hours.service.js'

const listQuerySchema = z.object({ mentorProfileId: z.string().trim().min(1).optional() })

export async function officeHourRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireUserId(request: { currentUser?: { sub: string } }): string {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    return userId
  }

  /** Upcoming office hours; `?mentorProfileId=` narrows to one mentor. */
  app.get('/', { preHandler: app.requireCapability('mentors.browse') }, async (request) => {
    const query = parseOrThrow(listQuerySchema, request.query, 'filters')
    return { officeHours: service.listUpcoming(db, requireUserId(request), query.mentorProfileId) }
  })

  app.get('/mine', { preHandler: app.requireCapability('mentorship.mentor') }, async (request) => ({
    officeHours: service.listMine(db, requireUserId(request)),
  }))

  app.post('/', { preHandler: app.requireCapability('mentorship.mentor') }, async (request, reply) => {
    const input = parseOrThrow(service.officeHourSchema, request.body, 'office hour')
    const officeHour = service.create(db, requireUserId(request), input)
    return reply.code(201).send({ officeHour, message: 'Office hour published.' })
  })

  app.post('/:id/join', { preHandler: app.requireCapability('mentorship.request') }, async (request) => {
    const { id } = request.params as { id: string }
    return { officeHour: service.join(db, requireUserId(request), id), message: 'You are in. See you there.' }
  })

  app.delete('/:id/join', { preHandler: app.requireCapability('mentorship.request') }, async (request) => {
    const { id } = request.params as { id: string }
    return { officeHour: service.leave(db, requireUserId(request), id), message: 'Your place was released.' }
  })

  app.post('/:id/cancel', { preHandler: app.requireCapability('mentorship.mentor') }, async (request) => {
    const { id } = request.params as { id: string }
    return { officeHour: service.cancel(db, requireUserId(request), id), message: 'Office hour cancelled.' }
  })
}
