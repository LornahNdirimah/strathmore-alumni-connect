import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createMentor, createStudent, sendRequest } from './helpers/fixtures.js'
import { createTestApp, resetTables, type TestContext } from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  resetTables()
})

describe('mentorship requests', () => {
  it('lets a student request a mentor and the mentor see it', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)

    const inbox = await app.inject({
      method: 'GET',
      url: '/api/mentorship/requests',
      headers: { cookie: mentor.cookie },
    })

    expect(inbox.statusCode).toBe(200)
    expect(inbox.json().requests).toHaveLength(1)
    expect(inbox.json().requests[0]).toMatchObject({ id: requestId, status: 'pending' })
  })

  it('rejects a duplicate pending request to the same mentor', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    await sendRequest(app, student, mentor.mentorProfileId)

    const second = await app.inject({
      method: 'POST',
      url: '/api/mentorship/requests',
      headers: { cookie: student.cookie },
      payload: {
        mentorProfileId: mentor.mentorProfileId,
        interest: 'Second attempt',
        preferredSlot: 'Thursday 5:30 PM',
        message: 'Trying again because the first one is still pending.',
      },
    })

    expect(second.statusCode).toBe(409)
  })

  it('refuses a request to a mentor with no remaining capacity', async () => {
    const mentor = await createMentor(app, { capacity: 1 })
    const first = await createStudent(app)
    const second = await createStudent(app)

    const requestId = await sendRequest(app, first, mentor.mentorProfileId)

    // Consume the single seat.
    await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'accepted' },
    })

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/mentorship/requests',
      headers: { cookie: second.cookie },
      payload: {
        mentorProfileId: mentor.mentorProfileId,
        interest: 'Data science guidance',
        preferredSlot: 'Friday 4:00 PM',
        message: 'Hoping to learn about the data science career path.',
      },
    })

    expect(blocked.statusCode).toBe(409)
  })
})

describe('responding to requests', () => {
  it('accepting creates a relationship and consumes capacity', async () => {
    const mentor = await createMentor(app, { capacity: 2 })
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)

    const accept = await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'accepted', notes: 'Happy to help.' },
    })

    expect(accept.statusCode).toBe(200)
    expect(accept.json().request.status).toBe('accepted')

    const relationships = await app.inject({
      method: 'GET',
      url: '/api/mentorship/relationships',
      headers: { cookie: student.cookie },
    })
    expect(relationships.json().relationships).toHaveLength(1)

    // Capacity 2 with one active relationship must report 1 remaining.
    const profile = await app.inject({
      method: 'GET',
      url: `/api/mentors/${mentor.mentorProfileId}`,
      headers: { cookie: student.cookie },
    })
    expect(profile.json().mentor.remainingCapacity).toBe(1)
  })

  it('is idempotent — a second response is rejected, not applied twice', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)

    const first = await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'accepted' },
    })
    const second = await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'declined' },
    })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(409)

    // Exactly one relationship — the duplicate must not have created another.
    const relationships = await app.inject({
      method: 'GET',
      url: '/api/mentorship/relationships',
      headers: { cookie: student.cookie },
    })
    expect(relationships.json().relationships).toHaveLength(1)
  })

  it('declining does not create a relationship', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)

    await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'declined', notes: 'At capacity this term.' },
    })

    const relationships = await app.inject({
      method: 'GET',
      url: '/api/mentorship/relationships',
      headers: { cookie: student.cookie },
    })
    expect(relationships.json().relationships).toHaveLength(0)
  })

  it('forbids a different mentor from answering someone else’s request', async () => {
    const mentor = await createMentor(app)
    const otherMentor = await createMentor(app, { name: 'James Mwangi' })
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: otherMentor.cookie },
      payload: { status: 'accepted' },
    })

    expect(response.statusCode).toBe(403)
  })

  it('forbids a student from answering a request', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: student.cookie },
      payload: { status: 'accepted' },
    })

    expect(response.statusCode).toBe(403)
  })
})

describe('capacity rules', () => {
  it('refuses to lower capacity below active commitments', async () => {
    const mentor = await createMentor(app, { capacity: 2 })
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)

    await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'accepted' },
    })

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/mentors/me',
      headers: { cookie: mentor.cookie },
      payload: { capacity: 0 },
    })

    expect(response.statusCode).toBe(409)
  })
})

describe('match event log (DESIGN_BACKLOG #4)', () => {
  it('records requested and accepted events', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)

    await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: mentor.cookie },
      payload: { status: 'accepted' },
    })

    const { getDatabase } = await import('../src/db/connection.js')
    const { listMatchEvents } = await import('../src/modules/mentorship/mentorship.repository.js')
    const events = listMatchEvents(getDatabase())

    expect(events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(['requested', 'accepted']),
    )
  })
})
