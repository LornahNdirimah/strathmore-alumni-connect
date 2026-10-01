import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { parseOrThrow } from '../../lib/validate.js'
import { seekerSchema, seekerUpdateSchema } from './seekers.schemas.js'
import * as service from './seekers.service.js'

export async function seekerRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireUserId(request: { currentUser?: { sub: string } }): string {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    return userId
  }

  app.get('/me', { preHandler: app.requireRole('student') }, async (request) => ({
    seeker: service.getSeeker(db, requireUserId(request)),
  }))

  /** Submitting this form is the student's opt-in to the mentorship programme. */
  app.post('/me', { preHandler: app.requireRole('student') }, async (request, reply) => {
    const input = parseOrThrow(seekerSchema, request.body, 'career goals')
    const seeker = service.createSeeker(db, requireUserId(request), input)

    return reply.code(201).send({
      seeker,
      message: 'You are opted in. We can now match you with mentors.',
    })
  })

  app.patch('/me', { preHandler: app.requireRole('student') }, async (request) => {
    const input = parseOrThrow(seekerUpdateSchema, request.body, 'career goals')
    const seeker = service.updateSeeker(db, requireUserId(request), input)

    return { seeker, message: 'Preferences updated.' }
  })
}
