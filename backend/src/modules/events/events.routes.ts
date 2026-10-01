import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { getDatabase, transaction } from '../../db/connection.js'
import { execute, queryAll, queryOne } from '../../db/repository.js'
import { recordAudit } from '../../lib/audit.js'
import { buildCalendar, calendarFileName } from '../../lib/ics.js'
import { notify } from '../../lib/notifications.js'
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from '../../lib/errors.js'
import { newId } from '../../lib/id.js'
import {
  DEFAULT_TIMEZONE,
  formatDisplayDate,
  formatDisplayTimeRange,
  isoToWallClock,
  nowIso,
  offsetMinutesFor,
  TIMEZONE_LABELS,
  type TimezoneLabel,
  wallClockToIso,
} from '../../lib/time.js'
import { parseOrThrow } from '../../lib/validate.js'

const listQuerySchema = z.object({
  type: z.enum(['In-Person', 'Online', 'Hybrid']).optional(),
  upcomingOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value !== 'false'),
})

/** A wall-clock date-time as a person enters it: '2026-10-15T18:00'. */
const localDateTime = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Enter a date and time.')

const eventFields = {
  title: z.string().trim().min(2).max(160),
  description: z.string().trim().min(5).max(4000),
  startsAt: localDateTime,
  endsAt: localDateTime.optional(),
  timezoneLabel: z
    .enum(TIMEZONE_LABELS as [TimezoneLabel, ...TimezoneLabel[]])
    .default(DEFAULT_TIMEZONE),
  location: z.string().trim().min(2).max(200),
  type: z.enum(['In-Person', 'Online', 'Hybrid']),
  tag: z.string().trim().min(2).max(40),
}

const createEventSchema = z.object(eventFields)
const updateEventSchema = z
  .object(eventFields)
  .partial()
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: 'Provide at least one field to change.',
  })

type EventRow = {
  id: string
  title: string
  description: string
  starts_at: string
  ends_at: string | null
  timezone_label: string
  location: string
  type: string
  tag: string
  image_url: string | null
  cancelled_at: string | null
  registered: number
  attendee_count: number
}

const EVENT_SELECT = `
  SELECT e.*,
         EXISTS (SELECT 1 FROM event_registrations r
                 WHERE r.event_id = e.id AND r.user_id = ?) AS registered,
         (SELECT COUNT(*) FROM event_registrations r2 WHERE r2.event_id = e.id) AS attendee_count
  FROM events e
`

function toView(row: EventRow) {
  const offset = offsetMinutesFor(row.timezone_label)
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    // ISO stays available for clients that want to format it themselves;
    // the display strings match what the UI already renders.
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    date: formatDisplayDate(row.starts_at, offset),
    time: formatDisplayTimeRange(row.starts_at, row.ends_at, row.timezone_label),
    timezoneLabel: row.timezone_label,
    // The same moments on the event's own clock, for the admin's edit form.
    startsAtLocal: isoToWallClock(row.starts_at, offset),
    endsAtLocal: row.ends_at ? isoToWallClock(row.ends_at, offset) : null,
    location: row.location,
    type: row.type,
    tag: row.tag,
    imageUrl: row.image_url,
    cancelled: row.cancelled_at !== null,
    registered: row.registered === 1,
    attendeeCount: row.attendee_count,
  }
}

/** Resolves entered wall-clock times into stored instants, validating order. */
function resolveTimes(
  startsAtLocal: string,
  endsAtLocal: string | undefined | null,
  timezoneLabel: string,
): { startsAt: string; endsAt: string | null } {
  const offset = offsetMinutesFor(timezoneLabel)
  const startsAt = wallClockToIso(startsAtLocal, offset)
  if (!startsAt) throw new BadRequestError('That start date does not exist.')

  let endsAt: string | null = null
  if (endsAtLocal) {
    endsAt = wallClockToIso(endsAtLocal, offset)
    if (!endsAt) throw new BadRequestError('That end date does not exist.')
    if (endsAt <= startsAt) throw new BadRequestError('The event must end after it starts.')
  }
  return { startsAt, endsAt }
}

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  const db = getDatabase()

  function requireUserId(request: { currentUser?: { sub: string } }): string {
    const userId = request.currentUser?.sub
    if (!userId) throw new UnauthorizedError()
    return userId
  }

  function findEvent(eventId: string, viewerId: string): EventRow {
    const row = queryOne<EventRow>(db, `${EVENT_SELECT} WHERE e.id = ?`, [viewerId, eventId])
    if (!row) throw new NotFoundError('Event not found.')
    return row
  }

  app.get('/', { preHandler: app.requireCapability('events.view') }, async (request) => {
    const userId = requireUserId(request)
    const query = parseOrThrow(listQuerySchema, request.query, 'event filters')

    const conditions: string[] = []
    const params: (string | number)[] = [userId]

    if (query.type) {
      conditions.push('e.type = ?')
      params.push(query.type)
    }
    if (query.upcomingOnly) {
      // Sortable because starts_at is ISO; the mock's 'October 15, 2026'
      // strings could not be compared at all.
      conditions.push('e.starts_at >= ?')
      params.push(nowIso())
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = queryAll<EventRow>(db, `${EVENT_SELECT} ${where} ORDER BY e.starts_at ASC`, params)

    return { events: rows.map(toView) }
  })

  /** The event as an .ics file for the viewer's own calendar (DESIGN_BACKLOG #39). */
  app.get('/:eventId/calendar.ics', { preHandler: app.requireCapability('events.view') }, async (request, reply) => {
    const event = findEvent((request.params as { eventId: string }).eventId, requireUserId(request))
    // An event with no end time is shown as two hours long.
    const end = event.ends_at ?? new Date(new Date(event.starts_at).getTime() + 2 * 3_600_000).toISOString()

    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${calendarFileName(event.title)}"`)
      .send(
        buildCalendar({
          uid: event.id,
          start: event.starts_at,
          end,
          summary: event.title,
          description: event.description,
          location: event.location,
          cancelled: event.cancelled_at !== null,
        }),
      )
  })

  /** The "Register" button the mock had wired to nothing. */
  app.post('/:eventId/register', { preHandler: app.requireCapability('events.register') }, async (request, reply) => {
    const userId = requireUserId(request)
    const { eventId } = request.params as { eventId: string }

    const event = findEvent(eventId, userId)
    if (event.cancelled_at) throw new ConflictError('This event has been cancelled.')
    if (event.starts_at <= nowIso()) throw new ConflictError('This event has already started.')
    if (event.registered === 1) throw new ConflictError('You are already registered for this event.')

    execute(
      db,
      'INSERT INTO event_registrations (event_id, user_id, created_at) VALUES (?, ?, ?)',
      [eventId, userId, nowIso()],
    )

    return reply.code(201).send({ message: 'You are registered.' })
  })

  app.delete('/:eventId/register', { preHandler: app.requireCapability('events.register') }, async (request) => {
    const userId = requireUserId(request)
    const { eventId } = request.params as { eventId: string }

    execute(db, 'DELETE FROM event_registrations WHERE event_id = ? AND user_id = ?', [
      eventId,
      userId,
    ])
    return { message: 'Registration cancelled.' }
  })

  // --- Management (admins; DESIGN_BACKLOG #23) -----------------------------

  app.post('/', { preHandler: app.requireCapability('events.manage') }, async (request, reply) => {
    const adminId = requireUserId(request)
    const input = parseOrThrow(createEventSchema, request.body, 'event')
    const { startsAt, endsAt } = resolveTimes(input.startsAt, input.endsAt, input.timezoneLabel)
    if (startsAt <= nowIso()) throw new BadRequestError('Schedule the event in the future.')

    const id = newId('event')
    transaction(db, () => {
      execute(
        db,
        `INSERT INTO events (id, title, description, starts_at, ends_at, timezone_label, location,
                             type, tag, image_url, created_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [id, input.title, input.description, startsAt, endsAt, input.timezoneLabel,
         input.location, input.type, input.tag, nowIso(), adminId],
      )
      recordAudit(db, {
        adminUserId: adminId,
        action: 'event.created',
        targetType: 'event',
        targetId: id,
        summary: `Scheduled “${input.title}”.`,
      })
    })

    return reply.code(201).send({ event: toView(findEvent(id, adminId)), message: 'Event scheduled.' })
  })

  app.patch('/:eventId', { preHandler: app.requireCapability('events.manage') }, async (request) => {
    const adminId = requireUserId(request)
    const { eventId } = request.params as { eventId: string }
    const input = parseOrThrow(updateEventSchema, request.body, 'event')
    const existing = findEvent(eventId, adminId)
    if (existing.cancelled_at) throw new ConflictError('A cancelled event cannot be edited.')

    // Times are re-resolved whenever any of them changes, so a new timezone
    // label moves the event rather than just relabelling it.
    const offset = offsetMinutesFor(existing.timezone_label)
    const timezoneLabel = input.timezoneLabel ?? existing.timezone_label
    const { startsAt, endsAt } = resolveTimes(
      input.startsAt ?? isoToWallClock(existing.starts_at, offset),
      input.endsAt !== undefined
        ? input.endsAt
        : existing.ends_at
          ? isoToWallClock(existing.ends_at, offset)
          : null,
      timezoneLabel,
    )

    transaction(db, () => {
      execute(
        db,
        `UPDATE events SET title = ?, description = ?, starts_at = ?, ends_at = ?, timezone_label = ?,
                           location = ?, type = ?, tag = ?
         WHERE id = ?`,
        [
          input.title ?? existing.title,
          input.description ?? existing.description,
          startsAt,
          endsAt,
          timezoneLabel,
          input.location ?? existing.location,
          input.type ?? existing.type,
          input.tag ?? existing.tag,
          eventId,
        ],
      )
      recordAudit(db, {
        adminUserId: adminId,
        action: 'event.updated',
        targetType: 'event',
        targetId: eventId,
        summary: `Edited “${input.title ?? existing.title}”.`,
      })
    })

    return { event: toView(findEvent(eventId, adminId)), message: 'Event updated.' }
  })

  /** Cancelled, not deleted: registrants still see it, marked as cancelled. */
  app.post('/:eventId/cancel', { preHandler: app.requireCapability('events.manage') }, async (request) => {
    const adminId = requireUserId(request)
    const { eventId } = request.params as { eventId: string }
    const existing = findEvent(eventId, adminId)
    if (existing.cancelled_at) throw new ConflictError('This event is already cancelled.')

    transaction(db, () => {
      execute(db, 'UPDATE events SET cancelled_at = ? WHERE id = ?', [nowIso(), eventId])
      const registrants = queryAll<{ user_id: string }>(
        db,
        'SELECT user_id FROM event_registrations WHERE event_id = ?',
        [eventId],
      )
      for (const { user_id: userId } of registrants) {
        notify(db, {
          userId,
          type: 'event.cancelled',
          title: `Cancelled: ${existing.title}`,
          body: `${formatDisplayDate(existing.starts_at, offsetMinutesFor(existing.timezone_label))} · ${existing.location}`,
          link: '/events',
        })
      }
      recordAudit(db, {
        adminUserId: adminId,
        action: 'event.cancelled',
        targetType: 'event',
        targetId: eventId,
        summary: `Cancelled “${existing.title}” (${existing.attendee_count} registered).`,
      })
    })

    return { event: toView(findEvent(eventId, adminId)), message: 'Event cancelled.' }
  })

  app.get('/:eventId/attendees', { preHandler: app.requireCapability('events.manage') }, async (request) => {
    const adminId = requireUserId(request)
    const { eventId } = request.params as { eventId: string }
    findEvent(eventId, adminId)

    return {
      attendees: queryAll<{ id: string; name: string; email: string; role: string; created_at: string }>(
        db,
        `SELECT u.id, u.name, u.email, u.role, r.created_at
         FROM event_registrations r JOIN users u ON u.id = r.user_id
         WHERE r.event_id = ? ORDER BY r.created_at ASC`,
        [eventId],
      ).map((row) => ({
        userId: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        registeredAt: row.created_at,
      })),
    }
  })
}
