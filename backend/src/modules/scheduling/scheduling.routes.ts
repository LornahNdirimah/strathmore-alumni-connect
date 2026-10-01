import type { FastifyInstance } from 'fastify'

import { getDatabase } from '../../db/connection.js'
import { UnauthorizedError } from '../../lib/errors.js'
import { parseOrThrow } from '../../lib/validate.js'
import {
  availabilityUpdateSchema,
  bookSessionSchema,
  ratingSchema,
  sessionListQuerySchema,
  slotQuerySchema,
  updateSessionSchema,
} from './scheduling.schemas.js'
import * as service from './scheduling.service.js'

export async function schedulingRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireUserId(request: { currentUser?: { sub: string } }): string {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    return userId
  }

  // ── Mentor availability ───────────────────────────────────────────────────

  /** A mentor's own weekly schedule, for the editor. */
  app.get('/availability/me', { preHandler: app.requireCapability('mentorship.mentor') }, async (request) => {
    const mentorProfileId = service.requireOwnMentorProfile(db, requireUserId(request))
    return { availability: service.getAvailability(db, mentorProfileId) }
  })

  /**
   * Replaces the whole schedule. PUT rather than PATCH because a weekly
   * timetable is edited as a whole — see the schema for why.
   */
  app.put('/availability/me', { preHandler: app.requireCapability('mentorship.mentor') }, async (request) => {
    const mentorProfileId = service.requireOwnMentorProfile(db, requireUserId(request))
    const input = parseOrThrow(availabilityUpdateSchema, request.body, 'availability')

    const availability = service.setAvailability(db, mentorProfileId, input)
    const count = availability.windows.length

    return {
      availability,
      message:
        count === 0
          ? 'Availability cleared — students cannot book new sessions until you add a window.'
          : `Availability saved: ${count} weekly window${count === 1 ? '' : 's'}.`,
    }
  })

  /** Anyone signed in may read a mentor's published availability. */
  app.get('/availability/:mentorProfileId', { preHandler: app.requireCapability('mentorship.participate') }, async (request) => {
    const { mentorProfileId } = request.params as { mentorProfileId: string }
    return { availability: service.getAvailability(db, mentorProfileId) }
  })

  // ── Bookable slots ────────────────────────────────────────────────────────

  /**
   * Concrete slots a student can pick. The viewer's own commitments are excluded
   * as well as the mentor's, so every slot shown is actually bookable.
   */
  app.get('/slots/:mentorProfileId', { preHandler: app.requireCapability('mentorship.participate') }, async (request) => {
    const userId = requireUserId(request)
    const { mentorProfileId } = request.params as { mentorProfileId: string }
    const query = parseOrThrow(slotQuerySchema, request.query, 'slot range')

    const { slots, availability } = service.listOpenSlots(db, mentorProfileId, query.days, userId)
    return { slots, availability }
  })

  // ── Sessions ──────────────────────────────────────────────────────────────

  app.get('/sessions', { preHandler: app.requireCapability('mentorship.participate') }, async (request) => {
    const userId = requireUserId(request)
    const query = parseOrThrow(sessionListQuerySchema, request.query, 'session filters')

    return { sessions: service.listSessions(db, userId, query.scope) }
  })

  /** Booking, available at any point in a mentorship — not only at request time. */
  app.post('/sessions', { preHandler: app.requireCapability('mentorship.participate') }, async (request, reply) => {
    const userId = requireUserId(request)
    const input = parseOrThrow(bookSessionSchema, request.body, 'session')

    const session = service.bookSession(db, userId, input)
    return reply.code(201).send({ session, message: `Booked for ${session.slotLabel}.` })
  })

  app.post(
    '/sessions/:sessionId/rating',
    { preHandler: app.requireCapability('mentorship.participate') },
    async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string }
      const input = parseOrThrow(ratingSchema, request.body, 'rating')
      service.rateSession(db, requireUserId(request), sessionId, input)
      return reply.code(201).send({ message: 'Thanks for rating the session.' })
    },
  )

  /** The session as an .ics file for the viewer's own calendar. */
  app.get(
    '/sessions/:sessionId/calendar.ics',
    { preHandler: app.requireCapability('mentorship.participate') },
    async (request, reply) => {
      const userId = requireUserId(request)
      const { sessionId } = request.params as { sessionId: string }
      const { fileName, body } = service.sessionCalendar(db, userId, sessionId)

      return reply
        .header('Content-Type', 'text/calendar; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${fileName}"`)
        .send(body)
    },
  )

  /** Reschedule, cancel, or mark complete. */
  app.patch('/sessions/:sessionId', { preHandler: app.requireCapability('mentorship.participate') }, async (request) => {
    const userId = requireUserId(request)
    const { sessionId } = request.params as { sessionId: string }
    const input = parseOrThrow(updateSessionSchema, request.body, 'session update')

    const session = service.updateSession(db, userId, sessionId, input)

    const message =
      session.status === 'cancelled'
        ? 'Session cancelled. The slot is open again.'
        : session.status === 'completed'
          ? 'Session marked complete.'
          : `Session moved to ${session.slotLabel}.`

    return { session, message }
  })
}
