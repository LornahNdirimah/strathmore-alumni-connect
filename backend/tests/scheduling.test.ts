/**
 * Availability and session booking.
 *
 * The behaviours that matter here are the ones a UI cannot be trusted to
 * enforce: that a booking has to land on a time the mentor actually published,
 * that neither person can be in two places at once, and that only the two people
 * in a mentorship can touch its sessions.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { execute } from '../src/db/repository.js'
import { createAdmin, createMentor, createStudent, sendRequest } from './helpers/fixtures.js'
import { createTestApp, resetTables, type TestContext } from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  resetTables()
})

type Mentor = Awaited<ReturnType<typeof createMentor>>
type Student = Awaited<ReturnType<typeof createStudent>>

/** Every weekday, a wide window, so tests always have slots regardless of the day they run. */
const WIDE_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  dayOfWeek,
  startTime: '08:00',
  endTime: '20:00',
}))

async function setAvailability(
  mentor: Mentor,
  payload: {
    windows: Array<{ dayOfWeek: number; startTime: string; endTime: string }>
    sessionDurationMin?: number
    timezoneLabel?: string
  },
) {
  const response = await app.inject({
    method: 'PUT',
    url: '/api/scheduling/availability/me',
    headers: { cookie: mentor.cookie },
    payload,
  })

  if (response.statusCode !== 200) {
    throw new Error(`Setting availability failed (${response.statusCode}): ${response.body}`)
  }
  return response.json()
}

async function openSlots(viewerCookie: string, mentorProfileId: string, days = 14) {
  const response = await app.inject({
    method: 'GET',
    url: `/api/scheduling/slots/${mentorProfileId}?days=${days}`,
    headers: { cookie: viewerCookie },
  })
  if (response.statusCode !== 200) {
    throw new Error(`Slot listing failed (${response.statusCode}): ${response.body}`)
  }
  return response.json() as {
    slots: Array<{ startsAt: string; endsAt: string; label: string }>
    availability: { sessionDurationMin: number; timezoneLabel: string }
  }
}

/** An accepted mentorship between a fresh mentor and student, with availability set. */
async function establish(options: { sessionDurationMin?: number } = {}): Promise<{
  mentor: Mentor
  student: Student
  relationshipId: string
}> {
  const mentor = await createMentor(app, { capacity: 3 })
  const student = await createStudent(app)

  await setAvailability(mentor, {
    windows: WIDE_WEEK,
    sessionDurationMin: options.sessionDurationMin ?? 30,
  })

  const requestId = await sendRequest(app, student, mentor.mentorProfileId)
  const accept = await app.inject({
    method: 'PATCH',
    url: `/api/mentorship/requests/${requestId}`,
    headers: { cookie: mentor.cookie },
    payload: { status: 'accepted' },
  })
  if (accept.statusCode !== 200) {
    throw new Error(`Accept failed (${accept.statusCode}): ${accept.body}`)
  }

  const relationships = await app.inject({
    method: 'GET',
    url: '/api/mentorship/relationships',
    headers: { cookie: student.cookie },
  })

  return { mentor, student, relationshipId: relationships.json().relationships[0].id as string }
}

async function book(
  cookie: string,
  payload: { relationshipId: string; title: string; scheduledAt: string; notes?: string },
) {
  return app.inject({
    method: 'POST',
    url: '/api/scheduling/sessions',
    headers: { cookie },
    payload,
  })
}

describe('publishing availability', () => {
  it('stores a weekly schedule and reports it back', async () => {
    const mentor = await createMentor(app)

    const result = await setAvailability(mentor, {
      timezoneLabel: 'EAT',
      sessionDurationMin: 60,
      windows: [
        { dayOfWeek: 2, startTime: '17:00', endTime: '19:00' },
        { dayOfWeek: 4, startTime: '09:00', endTime: '11:00' },
      ],
    })

    expect(result.availability.sessionDurationMin).toBe(60)
    expect(result.availability.windows).toHaveLength(2)
    expect(result.availability.windows[0]).toMatchObject({
      dayOfWeek: 2,
      dayName: 'Tuesday',
      startTime: '17:00',
      endTime: '19:00',
    })
  })

  it('replaces the previous schedule rather than appending to it', async () => {
    const mentor = await createMentor(app)

    await setAvailability(mentor, {
      windows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }],
    })
    const second = await setAvailability(mentor, {
      windows: [{ dayOfWeek: 3, startTime: '14:00', endTime: '16:00' }],
    })

    expect(second.availability.windows).toHaveLength(1)
    expect(second.availability.windows[0].dayName).toBe('Wednesday')
  })

  it('accepts an empty schedule as "not taking bookings"', async () => {
    const mentor = await createMentor(app)
    await setAvailability(mentor, { windows: [{ dayOfWeek: 1, startTime: '09:00', endTime: '11:00' }] })

    const cleared = await setAvailability(mentor, { windows: [] })

    expect(cleared.availability.windows).toEqual([])
    expect(cleared.message).toMatch(/cannot book/i)
  })

  it('rejects overlapping windows on the same day', async () => {
    const mentor = await createMentor(app)

    const response = await app.inject({
      method: 'PUT',
      url: '/api/scheduling/availability/me',
      headers: { cookie: mentor.cookie },
      payload: {
        windows: [
          { dayOfWeek: 2, startTime: '17:00', endTime: '19:00' },
          { dayOfWeek: 2, startTime: '18:00', endTime: '20:00' },
        ],
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toMatch(/overlap/i)
  })

  it('allows the same clock time on different days', async () => {
    const mentor = await createMentor(app)

    const result = await setAvailability(mentor, {
      windows: [
        { dayOfWeek: 2, startTime: '17:00', endTime: '19:00' },
        { dayOfWeek: 3, startTime: '17:00', endTime: '19:00' },
      ],
    })

    expect(result.availability.windows).toHaveLength(2)
  })

  it('rejects an end time before the start and a malformed clock time', async () => {
    const mentor = await createMentor(app)

    for (const windows of [
      [{ dayOfWeek: 2, startTime: '19:00', endTime: '17:00' }],
      [{ dayOfWeek: 2, startTime: '25:00', endTime: '26:00' }],
      [{ dayOfWeek: 9, startTime: '09:00', endTime: '10:00' }],
    ]) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/scheduling/availability/me',
        headers: { cookie: mentor.cookie },
        payload: { windows },
      })
      expect(response.statusCode, JSON.stringify(windows)).toBe(400)
    }
  })

  it('is alumni-only, and requires a mentor profile', async () => {
    const student = await createStudent(app)

    const asStudent = await app.inject({
      method: 'PUT',
      url: '/api/scheduling/availability/me',
      headers: { cookie: student.cookie },
      payload: { windows: [] },
    })
    expect(asStudent.statusCode).toBe(403)
  })

  it('lets any signed-in user read a mentor’s published availability', async () => {
    const mentor = await createMentor(app)
    await setAvailability(mentor, { windows: [{ dayOfWeek: 2, startTime: '17:00', endTime: '19:00' }] })
    const student = await createStudent(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/scheduling/availability/${mentor.mentorProfileId}`,
      headers: { cookie: student.cookie },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().availability.windows).toHaveLength(1)
  })
})

describe('open slots', () => {
  it('offers nothing for a mentor who has published no availability', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)

    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    expect(slots).toEqual([])
  })

  it('offers slots at the mentor’s own cadence', async () => {
    const mentor = await createMentor(app)
    await setAvailability(mentor, { windows: WIDE_WEEK, sessionDurationMin: 60 })
    const student = await createStudent(app)

    const { slots, availability } = await openSlots(student.cookie, mentor.mentorProfileId, 7)

    expect(availability.sessionDurationMin).toBe(60)
    expect(slots.length).toBeGreaterThan(0)

    for (const slot of slots) {
      const minutes =
        (new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()) / 60_000
      expect(minutes).toBe(60)
    }
  })

  it('never offers a time in the past', async () => {
    const mentor = await createMentor(app)
    await setAvailability(mentor, { windows: WIDE_WEEK })
    const student = await createStudent(app)

    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const now = new Date().toISOString()

    for (const slot of slots) {
      expect(slot.startsAt > now, `${slot.startsAt} should be in the future`).toBe(true)
    }
  })

  it('drops a slot once it is booked', async () => {
    const { mentor, student, relationshipId } = await establish()
    const before = await openSlots(student.cookie, mentor.mentorProfileId)
    const target = before.slots[0]!.startsAt

    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: target,
    })
    expect(booked.statusCode).toBe(201)

    const after = await openSlots(student.cookie, mentor.mentorProfileId)
    expect(after.slots.map((slot) => slot.startsAt)).not.toContain(target)
    expect(after.slots).toHaveLength(before.slots.length - 1)
  })

  it('carries a human label with the mentor’s timezone', async () => {
    const mentor = await createMentor(app)
    await setAvailability(mentor, { windows: WIDE_WEEK, timezoneLabel: 'EAT' })
    const student = await createStudent(app)

    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    expect(slots[0]!.label).toMatch(/EAT$/)
    // And it must not read '9:00 AM PM' — the label is one time plus one zone.
    expect(slots[0]!.label).not.toMatch(/(AM|PM)\s+(AM|PM)/)
  })
})

describe('timezones', () => {
  it('reads a mentor’s windows on their own clock and stores the real instant', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    // Every day, 17:00-18:00 in Nairobi.
    await setAvailability(mentor, {
      windows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '17:00', endTime: '18:00' })),
      sessionDurationMin: 60,
      timezoneLabel: 'EAT',
    })

    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) {
      // 17:00 EAT is 14:00 UTC; the label shows the mentor's clock.
      expect(new Date(slot.startsAt).getUTCHours()).toBe(14)
      expect(slot.label).toMatch(/5:00 PM EAT$/)
    }
  })

  it('refuses an unknown timezone label rather than silently reading it as UTC', async () => {
    const mentor = await createMentor(app)
    const response = await app.inject({
      method: 'PUT',
      url: '/api/scheduling/availability/me',
      headers: { cookie: mentor.cookie },
      payload: { windows: WIDE_WEEK, timezoneLabel: 'Nairobi' },
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('booking a session', () => {
  it('can be done at any point in a mentorship, not only when requesting', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)

    // Two separate bookings, made after the mentorship already existed.
    const first = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })
    const second = await book(student.cookie, {
      relationshipId,
      title: 'Interview practice',
      scheduledAt: slots[1]!.startsAt,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)

    const listing = await app.inject({
      method: 'GET',
      url: '/api/scheduling/sessions?scope=upcoming',
      headers: { cookie: student.cookie },
    })
    expect(listing.json().sessions.length).toBeGreaterThanOrEqual(2)
  })

  it('can be done by the mentor as well as the student', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)

    const response = await book(mentor.cookie, {
      relationshipId,
      title: 'Check-in',
      scheduledAt: slots[0]!.startsAt,
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().session.bookedByMe).toBe(true)
  })

  it('records the real timestamp, not a display string', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const target = slots[0]!.startsAt

    const response = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: target,
    })

    const session = response.json().session
    expect(session.scheduledAt).toBe(target)
    expect(new Date(session.scheduledAt).toISOString()).toBe(target)
    expect(session.endsAt > session.scheduledAt).toBe(true)
    expect(session.slotLabel).toMatch(/\d/)
  })

  it('stores one canonical form, so formatting cannot dodge the double-booking index', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const canonical = slots[0]!.startsAt
    // The same instant without milliseconds: a different string, same moment.
    const variant = canonical.replace('.000Z', 'Z')
    expect(variant).not.toBe(canonical)

    const response = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: variant,
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().session.scheduledAt).toBe(canonical)
  })

  it('refuses a time outside the mentor’s availability', async () => {
    const { mentor, student, relationshipId } = await establish()
    await setAvailability(mentor, {
      windows: [{ dayOfWeek: 2, startTime: '17:00', endTime: '19:00' }],
    })

    // 03:00 on some future day is inside nobody's window.
    const target = new Date(Date.now() + 3 * 86_400_000)
    target.setUTCHours(3, 0, 0, 0)

    const response = await book(student.cookie, {
      relationshipId,
      title: 'Middle of the night',
      scheduledAt: target.toISOString(),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/open slots/i)
  })

  it('refuses a time inside a window but off the cadence', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)

    // Seven minutes past a real slot: inside the window, not a slot on offer.
    const offCadence = new Date(new Date(slots[0]!.startsAt).getTime() + 7 * 60_000).toISOString()

    const response = await book(student.cookie, {
      relationshipId,
      title: 'Off cadence',
      scheduledAt: offCadence,
    })

    expect(response.statusCode).toBe(409)
  })

  it('refuses a time in the past', async () => {
    const { student, relationshipId } = await establish()

    const response = await book(student.cookie, {
      relationshipId,
      title: 'Last week',
      scheduledAt: new Date(Date.now() - 86_400_000).toISOString(),
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toMatch(/future/i)
  })

  it('refuses a mentor’s slot that another student already took', async () => {
    const mentor = await createMentor(app, { capacity: 3 })
    await setAvailability(mentor, { windows: WIDE_WEEK })

    // Two students, two mentorships, one mentor — the case a per-relationship
    // uniqueness check would miss entirely.
    const relationshipIds: string[] = []
    for (const _ of [0, 1]) {
      const student = await createStudent(app)
      const requestId = await sendRequest(app, student, mentor.mentorProfileId)
      await app.inject({
        method: 'PATCH',
        url: `/api/mentorship/requests/${requestId}`,
        headers: { cookie: mentor.cookie },
        payload: { status: 'accepted' },
      })
      const rels = await app.inject({
        method: 'GET',
        url: '/api/mentorship/relationships',
        headers: { cookie: student.cookie },
      })
      relationshipIds.push(rels.json().relationships[0].id as string)
    }

    const { slots } = await openSlots(mentor.cookie, mentor.mentorProfileId)
    const target = slots[0]!.startsAt

    const first = await book(mentor.cookie, {
      relationshipId: relationshipIds[0]!,
      title: 'Student one',
      scheduledAt: target,
    })
    const second = await book(mentor.cookie, {
      relationshipId: relationshipIds[1]!,
      title: 'Student two',
      scheduledAt: target,
    })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(409)
  })

  it('refuses someone outside the mentorship', async () => {
    const { mentor, student, relationshipId } = await establish()
    const admin = await createAdmin(app)
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)

    const response = await book(admin.cookie, {
      relationshipId,
      title: 'Not my mentorship',
      scheduledAt: slots[0]!.startsAt,
    })

    expect(response.statusCode).toBe(403)
  })

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/scheduling/sessions',
      payload: { relationshipId: 'rel_x', title: 'Anon', scheduledAt: new Date().toISOString() },
    })

    expect(response.statusCode).toBe(401)
  })

  it('rejects a non-ISO timestamp', async () => {
    const { relationshipId, student } = await establish()

    const response = await book(student.cookie, {
      relationshipId,
      title: 'Free text time',
      scheduledAt: 'Wednesday 5:30 PM',
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('accepting a request books the requested time', () => {
  it('creates the first session from the slot the student picked', async () => {
    const mentor = await createMentor(app, { capacity: 2 })
    await setAvailability(mentor, { windows: WIDE_WEEK })
    const student = await createStudent(app)

    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const wanted = slots[0]!.startsAt

    const requested = await app.inject({
      method: 'POST',
      url: '/api/mentorship/requests',
      headers: { cookie: student.cookie },
      payload: {
        mentorProfileId: mentor.mentorProfileId,
        interest: 'Machine learning career path',
        preferredSlot: slots[0]!.label,
        preferredSlotAt: wanted,
        message: 'I would value guidance on internships and portfolio building.',
      },
    })
    expect(requested.statusCode).toBe(201)
    expect(requested.json().request.preferredSlotAt).toBe(wanted)

    const accept = await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requested.json().request.id}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'accepted' },
    })

    expect(accept.statusCode).toBe(200)
    expect(accept.json().firstSession).not.toBeNull()
    expect(accept.json().firstSession.scheduledAt).toBe(wanted)
    expect(accept.json().message).toMatch(/First session booked/i)
  })

  it('still accepts when no time was requested', async () => {
    const mentor = await createMentor(app, { capacity: 2 })
    await setAvailability(mentor, { windows: WIDE_WEEK })
    const student = await createStudent(app)

    const requestId = await sendRequest(app, student, mentor.mentorProfileId)
    const accept = await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'accepted' },
    })

    expect(accept.statusCode).toBe(200)
    expect(accept.json().firstSession).toBeNull()
  })

  it('accepts even when the requested slot has become unbookable', async () => {
    const mentor = await createMentor(app, { capacity: 2 })
    await setAvailability(mentor, { windows: WIDE_WEEK })
    const student = await createStudent(app)

    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const requested = await app.inject({
      method: 'POST',
      url: '/api/mentorship/requests',
      headers: { cookie: student.cookie },
      payload: {
        mentorProfileId: mentor.mentorProfileId,
        interest: 'Machine learning career path',
        preferredSlot: slots[0]!.label,
        preferredSlotAt: slots[0]!.startsAt,
        message: 'I would value guidance on internships and portfolio building.',
      },
    })

    // The mentor withdraws that availability before answering. Their decision to
    // accept must still stand — scheduling is a detail to settle afterwards.
    await setAvailability(mentor, { windows: [] })

    const accept = await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requested.json().request.id}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'accepted' },
    })

    expect(accept.statusCode).toBe(200)
    expect(accept.json().request.status).toBe('accepted')
    expect(accept.json().firstSession).toBeNull()
    expect(accept.json().message).toMatch(/no longer open/i)
  })
})

describe('changing a session', () => {
  it('reschedules onto another open slot', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)

    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })
    const sessionId = booked.json().session.id as string

    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${sessionId}`,
      headers: { cookie: student.cookie },
      payload: { scheduledAt: slots[1]!.startsAt },
    })

    expect(moved.statusCode).toBe(200)
    expect(moved.json().session.scheduledAt).toBe(slots[1]!.startsAt)
  })

  it('does not treat a session as clashing with itself', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)

    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })
    const sessionId = booked.json().session.id as string

    // Renaming while passing the unchanged time must not be refused as a clash.
    const renamed = await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${sessionId}`,
      headers: { cookie: student.cookie },
      payload: { scheduledAt: slots[0]!.startsAt, title: 'Portfolio review v2' },
    })

    expect(renamed.statusCode).toBe(200)
    expect(renamed.json().session.title).toBe('Portfolio review v2')
  })

  it('refuses to reschedule outside availability', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })

    const target = new Date(Date.now() + 4 * 86_400_000)
    target.setUTCHours(4, 0, 0, 0)
    await setAvailability(mentor, { windows: [{ dayOfWeek: 2, startTime: '17:00', endTime: '19:00' }] })

    const moved = await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${booked.json().session.id}`,
      headers: { cookie: student.cookie },
      payload: { scheduledAt: target.toISOString() },
    })

    // A PATCH must not be a way around the rules a POST enforces.
    expect(moved.statusCode).toBe(409)
  })

  it('cancels and frees the slot for rebooking', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const target = slots[0]!.startsAt

    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: target,
    })

    const cancelled = await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${booked.json().session.id}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'cancelled', cancelledReason: 'Work deadline.' },
    })

    expect(cancelled.statusCode).toBe(200)
    expect(cancelled.json().session.status).toBe('cancelled')
    expect(cancelled.json().session.cancelledReason).toBe('Work deadline.')

    const after = await openSlots(student.cookie, mentor.mentorProfileId)
    expect(after.slots.map((slot) => slot.startsAt)).toContain(target)

    // And the freed slot really is bookable again.
    const rebooked = await book(student.cookie, {
      relationshipId,
      title: 'Second attempt',
      scheduledAt: target,
    })
    expect(rebooked.statusCode).toBe(201)
  })

  it('refuses to change a cancelled session', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })
    const sessionId = booked.json().session.id as string

    await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${sessionId}`,
      headers: { cookie: student.cookie },
      payload: { status: 'cancelled' },
    })

    const again = await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${sessionId}`,
      headers: { cookie: student.cookie },
      payload: { title: 'Reviving it' },
    })

    expect(again.statusCode).toBe(409)
  })

  it('refuses to mark a future session complete', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${booked.json().session.id}`,
      headers: { cookie: student.cookie },
      payload: { status: 'completed' },
    })

    // Otherwise the "sessions held" figure feedback reports on is meaningless.
    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toMatch(/not happened yet/i)
  })

  it('refuses "completed" combined with a reschedule to skip the future check', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${booked.json().session.id}`,
      headers: { cookie: student.cookie },
      payload: { status: 'completed', scheduledAt: slots[1]!.startsAt },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.message).toMatch(/not happened yet/i)
  })

  it('keeps a held session fixed, apart from its title and notes', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })
    const sessionId = booked.json().session.id as string

    // Move it into the past and mark it held, as if it had taken place.
    execute(
      getDatabase(),
      "UPDATE sessions SET scheduled_at = ?, status = 'completed' WHERE id = ?",
      [new Date(Date.now() - 86_400_000).toISOString(), sessionId],
    )

    const patch = (payload: Record<string, unknown>) =>
      app.inject({
        method: 'PATCH',
        url: `/api/scheduling/sessions/${sessionId}`,
        headers: { cookie: student.cookie },
        payload,
      })

    expect((await patch({ status: 'upcoming' })).statusCode).toBe(409)
    expect((await patch({ status: 'cancelled' })).statusCode).toBe(409)
    expect((await patch({ scheduledAt: slots[1]!.startsAt })).statusCode).toBe(409)
    expect((await patch({ notes: 'Went through two case studies.' })).statusCode).toBe(200)
  })

  it('refuses to move a session whose time has already passed', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })
    const sessionId = booked.json().session.id as string

    execute(getDatabase(), 'UPDATE sessions SET scheduled_at = ? WHERE id = ?', [
      new Date(Date.now() - 86_400_000).toISOString(),
      sessionId,
    ])

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${sessionId}`,
      headers: { cookie: student.cookie },
      payload: { scheduledAt: slots[1]!.startsAt },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/already passed/i)
  })

  it('forbids a non-participant from changing a session', async () => {
    const { mentor, student, relationshipId } = await establish()
    const admin = await createAdmin(app)
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${booked.json().session.id}`,
      headers: { cookie: admin.cookie },
      payload: { status: 'cancelled' },
    })

    expect(response.statusCode).toBe(403)
  })

  it('404s an unknown session', async () => {
    const { student } = await establish()

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/scheduling/sessions/sess_nope',
      headers: { cookie: student.cookie },
      payload: { status: 'cancelled' },
    })

    expect(response.statusCode).toBe(404)
  })

  it('rejects an update that changes nothing', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)
    const booked = await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/scheduling/sessions/${booked.json().session.id}`,
      headers: { cookie: student.cookie },
      payload: {},
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('listing sessions', () => {
  it('separates upcoming from past', async () => {
    const { mentor, student, relationshipId } = await establish()
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)

    await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })

    const upcoming = await app.inject({
      method: 'GET',
      url: '/api/scheduling/sessions?scope=upcoming',
      headers: { cookie: student.cookie },
    })
    const past = await app.inject({
      method: 'GET',
      url: '/api/scheduling/sessions?scope=past',
      headers: { cookie: student.cookie },
    })

    expect(upcoming.json().sessions.length).toBeGreaterThan(0)
    expect(past.json().sessions).toHaveLength(0)
  })

  it('shows a session to both participants and to nobody else', async () => {
    const { mentor, student, relationshipId } = await establish()
    const admin = await createAdmin(app)
    const { slots } = await openSlots(student.cookie, mentor.mentorProfileId)

    await book(student.cookie, {
      relationshipId,
      title: 'Portfolio review',
      scheduledAt: slots[0]!.startsAt,
    })

    for (const [label, cookie] of [
      ['student', student.cookie],
      ['mentor', mentor.cookie],
    ] as const) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/scheduling/sessions',
        headers: { cookie },
      })
      expect(response.json().sessions.length, label).toBeGreaterThan(0)
    }

    const otherStudent = await createStudent(app)
    const outsider = await app.inject({
      method: 'GET',
      url: '/api/scheduling/sessions',
      headers: { cookie: otherStudent.cookie },
    })
    expect(outsider.json().sessions).toHaveLength(0)

    // Admins take no part in mentorship, so they are refused outright rather
    // than shown an empty list.
    const asAdmin = await app.inject({
      method: 'GET',
      url: '/api/scheduling/sessions',
      headers: { cookie: admin.cookie },
    })
    expect(asAdmin.statusCode).toBe(403)
  })
})
