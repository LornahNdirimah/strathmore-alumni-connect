/**
 * The mentorship lifecycle: terms, ending, withdrawal, request limits and
 * expiry, and the mid-point check-in (DESIGN_BACKLOG #7, #34, #35).
 *
 * Capacity is derived from active relationships, so "a mentorship can end" is
 * what keeps a mentor's seats from being used up for good.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { execute, queryOne } from '../src/db/repository.js'
import {
  MAX_PENDING_REQUESTS,
  MENTORSHIP_TERM_DAYS,
  runLifecycleSweep,
} from '../src/modules/mentorship/mentorship.service.js'
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

const DAY_MS = 24 * 60 * 60 * 1000
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString()

async function call(method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, payload?: object) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) })
}

/** An accepted mentorship; returns its id. */
async function mentorship(capacity = 3) {
  const mentor = await createMentor(app, { capacity })
  const student = await createStudent(app)
  const requestId = await sendRequest(app, student, mentor.mentorProfileId)
  await call('PATCH', `/api/mentorship/requests/${requestId}`, mentor.cookie, { status: 'accepted' })
  const relationships = await call('GET', '/api/mentorship/relationships', student.cookie)
  const relationship = relationships.json().relationships[0]
  return { mentor, student, relationshipId: relationship.id as string, relationship }
}

async function remainingCapacity(cookie: string, mentorProfileId: string): Promise<number> {
  return (await call('GET', `/api/mentors/${mentorProfileId}`, cookie)).json().mentor
    .remainingCapacity as number
}

describe('terms', () => {
  it(`gives a new mentorship a ${MENTORSHIP_TERM_DAYS}-day term with a mid-point check-in`, async () => {
    const { relationship } = await mentorship()

    const started = new Date(relationship.startedAt).getTime()
    expect(new Date(relationship.endsOn).getTime() - started).toBe(MENTORSHIP_TERM_DAYS * DAY_MS)
    expect(new Date(relationship.checkInOpensAt).getTime() - started).toBe(
      (MENTORSHIP_TERM_DAYS / 2) * DAY_MS,
    )
    expect(relationship.checkInDue).toBe(false)
  })

  it('closes a mentorship when its term runs out, freeing the seat', async () => {
    const { mentor, student, relationshipId } = await mentorship(1)
    expect(await remainingCapacity(student.cookie, mentor.mentorProfileId)).toBe(0)

    execute(getDatabase(), 'UPDATE mentorship_relationships SET ends_on = ? WHERE id = ?', [
      daysAgo(1),
      relationshipId,
    ])
    const result = runLifecycleSweep(getDatabase())

    expect(result.endedMentorships).toBe(1)
    const row = queryOne<{ status: string; end_reason: string }>(
      getDatabase(),
      'SELECT status, end_reason FROM mentorship_relationships WHERE id = ?',
      [relationshipId],
    )
    expect(row).toEqual({ status: 'completed', end_reason: 'term-complete' })
    expect(await remainingCapacity(student.cookie, mentor.mentorProfileId)).toBe(1)

    // Idempotent: a second sweep has nothing left to do.
    expect(runLifecycleSweep(getDatabase()).endedMentorships).toBe(0)
  })
})

describe('ending a mentorship', () => {
  it('lets either participant end it, freeing the seat and cancelling future sessions', async () => {
    const { mentor, student, relationshipId } = await mentorship(1)

    // A booked session in the future, inserted directly so the test does not
    // depend on the day it runs.
    execute(
      getDatabase(),
      `INSERT INTO sessions (id, relationship_id, title, scheduled_at, duration_min, status, created_at,
                             mentor_profile_id, student_user_id)
       VALUES ('sess-future', ?, 'Next steps', ?, 30, 'upcoming', ?, ?, ?)`,
      [relationshipId, new Date(Date.now() + 3 * DAY_MS).toISOString(), daysAgo(0),
       mentor.mentorProfileId, student.userId],
    )

    const response = await call('POST', `/api/mentorship/relationships/${relationshipId}/end`, student.cookie, {
      reason: 'I got the internship I was preparing for.',
    })
    expect(response.statusCode).toBe(200)

    const row = queryOne<{ status: string; ended_by_user_id: string; end_reason: string }>(
      getDatabase(),
      'SELECT status, ended_by_user_id, end_reason FROM mentorship_relationships WHERE id = ?',
      [relationshipId],
    )
    expect(row).toEqual({
      status: 'completed',
      ended_by_user_id: student.userId,
      end_reason: 'I got the internship I was preparing for.',
    })
    const session = queryOne<{ status: string }>(getDatabase(), "SELECT status FROM sessions WHERE id = 'sess-future'")
    expect(session?.status).toBe('cancelled')
    expect(await remainingCapacity(student.cookie, mentor.mentorProfileId)).toBe(1)

    // Once only.
    const again = await call('POST', `/api/mentorship/relationships/${relationshipId}/end`, mentor.cookie)
    expect(again.statusCode).toBe(409)
  })

  it('lets the mentor end it too, and nobody outside it', async () => {
    const { mentor, relationshipId } = await mentorship()
    const outsider = await createStudent(app)
    const admin = await createAdmin(app)

    expect((await call('POST', `/api/mentorship/relationships/${relationshipId}/end`, outsider.cookie)).statusCode).toBe(403)
    expect((await call('POST', `/api/mentorship/relationships/${relationshipId}/end`, admin.cookie)).statusCode).toBe(403)
    expect((await call('POST', `/api/mentorship/relationships/${relationshipId}/end`, mentor.cookie)).statusCode).toBe(200)
  })

  it('does not let a student re-request a mentor they have finished with', async () => {
    const { mentor, student, relationshipId } = await mentorship()
    await call('POST', `/api/mentorship/relationships/${relationshipId}/end`, student.cookie)

    const response = await app.inject({
      method: 'POST',
      url: '/api/mentorship/requests',
      headers: { cookie: student.cookie },
      payload: {
        mentorProfileId: mentor.mentorProfileId,
        interest: 'A second round',
        preferredSlot: 'Any time',
        message: 'Could we work together again next term?',
      },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().error.message).toMatch(/already completed/i)
  })
})

describe('requests', () => {
  it(`caps a student at ${MAX_PENDING_REQUESTS} requests waiting at once`, async () => {
    const student = await createStudent(app)
    for (let index = 0; index < MAX_PENDING_REQUESTS; index += 1) {
      const mentor = await createMentor(app)
      await sendRequest(app, student, mentor.mentorProfileId)
    }
    const oneTooMany = await createMentor(app)

    await expect(sendRequest(app, student, oneTooMany.mentorProfileId)).rejects.toThrow(/409/)
  })

  it('lets a student withdraw their own pending request, once', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    const other = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)

    expect((await call('POST', `/api/mentorship/requests/${requestId}/withdraw`, other.cookie)).statusCode).toBe(404)

    const withdrawn = await call('POST', `/api/mentorship/requests/${requestId}/withdraw`, student.cookie)
    expect(withdrawn.statusCode).toBe(200)
    expect(withdrawn.json().request.status).toBe('withdrawn')

    expect((await call('POST', `/api/mentorship/requests/${requestId}/withdraw`, student.cookie)).statusCode).toBe(409)
    // And the mentor can no longer accept it.
    const accept = await call('PATCH', `/api/mentorship/requests/${requestId}`, mentor.cookie, { status: 'accepted' })
    expect(accept.statusCode).toBe(409)
  })

  it('expires an unanswered request and frees the student to ask someone else', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)
    const fresh = await sendRequest(app, student, (await createMentor(app)).mentorProfileId)

    execute(getDatabase(), 'UPDATE mentorship_requests SET created_at = ? WHERE id = ?', [daysAgo(8), requestId])
    expect(runLifecycleSweep(getDatabase()).expiredRequests).toBe(1)

    const requests = (await call('GET', '/api/mentorship/requests', student.cookie)).json().requests as Array<{
      id: string
      status: string
      expiresAt: string | null
    }>
    expect(requests.find((r) => r.id === requestId)).toMatchObject({ status: 'expired', expiresAt: null })
    // The recent one is untouched and says when it will lapse.
    expect(requests.find((r) => r.id === fresh)?.status).toBe('pending')
    expect(requests.find((r) => r.id === fresh)?.expiresAt).toBeTruthy()
  })
})

describe('mid-point check-in', () => {
  it('opens halfway through the term, once per person', async () => {
    const { student, relationshipId } = await mentorship()

    const early = await call('POST', `/api/mentorship/relationships/${relationshipId}/checkin`, student.cookie, {
      progress: 'on-track',
    })
    expect(early.statusCode).toBe(409)

    // Move the start back so the mid-point has passed.
    execute(getDatabase(), 'UPDATE mentorship_relationships SET started_at = ?, ends_on = ? WHERE id = ?', [
      daysAgo(50),
      new Date(Date.now() + 34 * DAY_MS).toISOString(),
      relationshipId,
    ])

    const before = (await call('GET', '/api/mentorship/relationships', student.cookie)).json().relationships[0]
    expect(before.checkInDue).toBe(true)

    const checkIn = await call('POST', `/api/mentorship/relationships/${relationshipId}/checkin`, student.cookie, {
      progress: 'needs-attention',
      note: 'We keep missing sessions.',
    })
    expect(checkIn.statusCode).toBe(201)

    const after = (await call('GET', '/api/mentorship/relationships', student.cookie)).json().relationships[0]
    expect(after.checkInDue).toBe(false)
    expect(after.myCheckIn).toEqual({ progress: 'needs-attention', note: 'We keep missing sessions.' })

    const twice = await call('POST', `/api/mentorship/relationships/${relationshipId}/checkin`, student.cookie, {
      progress: 'on-track',
    })
    expect(twice.statusCode).toBe(409)
  })
})
