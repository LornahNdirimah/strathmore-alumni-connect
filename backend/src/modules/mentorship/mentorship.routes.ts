import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { parseOrThrow } from '../../lib/validate.js'
import {
  checkInSchema,
  endSchema,
  goalSchema,
  goalUpdateSchema,
  requestSchema,
  respondSchema,
} from './mentorship.schemas.js'
import * as service from './mentorship.service.js'

export async function mentorshipRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireUserId(request: { currentUser?: { sub: string } }): string {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    return userId
  }

  app.post('/requests', { preHandler: app.requireCapability('mentorship.request') }, async (request, reply) => {
    const userId = requireUserId(request)
    const input = parseOrThrow(requestSchema, request.body, 'mentorship request')
    const created = service.createRequest(db, userId, input)

    return reply.code(201).send({ request: created, message: 'Request sent.' })
  })

  /** Students see the requests they sent; mentors see the ones they received. */
  app.get('/requests', { preHandler: app.requireCapability('mentorship.participate') }, async (request) => {
    const userId = requireUserId(request)
    const role = request.currentUser?.role

    const requests =
      role === 'student'
        ? service.listRequestsForStudent(db, userId)
        : service.listRequestsForMentorUser(db, userId)

    return { requests }
  })

  app.patch('/requests/:requestId', { preHandler: app.requireCapability('mentorship.mentor') }, async (request) => {
    const userId = requireUserId(request)
    const { requestId } = request.params as { requestId: string }
    const input = parseOrThrow(respondSchema, request.body, 'response')

    const updated = service.respondToRequest(db, userId, requestId, input)

    // Accepting a request that named a time books that time; saying so is what
    // makes the outcome legible, since the mentor never touched a booking form.
    const message = updated.firstSession
      ? `Request accepted. First session booked for ${updated.firstSession.slotLabel}.`
      : updated.status === 'accepted' && updated.preferredSlotAt
        ? 'Request accepted. Their requested time was no longer open — agree a new one from your availability.'
        : `Request ${updated.status}.`

    return { request: updated, firstSession: updated.firstSession, message }
  })

  app.get('/relationships', { preHandler: app.requireCapability('mentorship.participate') }, async (request) => {
    const userId = requireUserId(request)
    const role = request.currentUser?.role === 'student' ? 'student' : 'alumni'
    return { relationships: service.listRelationships(db, userId, role) }
  })

  /** A student takes back a request the mentor has not answered yet. */
  app.post(
    '/requests/:requestId/withdraw',
    { preHandler: app.requireCapability('mentorship.request') },
    async (request) => {
      const userId = requireUserId(request)
      const { requestId } = request.params as { requestId: string }
      return { request: service.withdrawRequest(db, userId, requestId), message: 'Request withdrawn.' }
    },
  )

  /** Either participant ends the mentorship (ROADMAP D3). */
  app.post(
    '/relationships/:relationshipId/end',
    { preHandler: app.requireCapability('mentorship.participate') },
    async (request) => {
      const userId = requireUserId(request)
      const { relationshipId } = request.params as { relationshipId: string }
      const input = parseOrThrow(endSchema, request.body ?? {}, 'ending')
      service.endMentorship(db, userId, relationshipId, input.reason)
      return {
        message:
          'The mentorship has ended and any upcoming sessions were cancelled. Please share feedback on how it went.',
      }
    },
  )

  // ── Goals (DESIGN_BACKLOG #32) ────────────────────────────────────────────

  app.post(
    '/relationships/:relationshipId/goals',
    { preHandler: app.requireCapability('mentorship.participate') },
    async (request, reply) => {
      const { relationshipId } = request.params as { relationshipId: string }
      const input = parseOrThrow(goalSchema, request.body, 'goal')
      const goal = service.addGoal(db, requireUserId(request), relationshipId, input.title)
      return reply.code(201).send({ goal, message: 'Goal added.' })
    },
  )

  app.patch('/goals/:goalId', { preHandler: app.requireCapability('mentorship.participate') }, async (request) => {
    const { goalId } = request.params as { goalId: string }
    const input = parseOrThrow(goalUpdateSchema, request.body, 'goal')
    service.setGoalCompleted(db, requireUserId(request), goalId, input.completed)
    return { message: input.completed ? 'Nice work — goal completed.' : 'Goal reopened.' }
  })

  app.delete('/goals/:goalId', { preHandler: app.requireCapability('mentorship.participate') }, async (request) => {
    const { goalId } = request.params as { goalId: string }
    service.removeGoal(db, requireUserId(request), goalId)
    return { message: 'Goal removed.' }
  })

  /** The mid-point check-in. */
  app.post(
    '/relationships/:relationshipId/checkin',
    { preHandler: app.requireCapability('mentorship.participate') },
    async (request, reply) => {
      const userId = requireUserId(request)
      const { relationshipId } = request.params as { relationshipId: string }
      const input = parseOrThrow(checkInSchema, request.body, 'check-in')
      service.submitCheckIn(db, userId, relationshipId, input)
      return reply.code(201).send({ message: 'Thanks — your check-in was recorded.' })
    },
  )

  // Sessions moved to /api/scheduling, which owns availability, slot generation
  // and booking together. Keeping a second set of session routes here would mean
  // two places that can create a session and only one of them checking a
  // mentor's availability.
}
