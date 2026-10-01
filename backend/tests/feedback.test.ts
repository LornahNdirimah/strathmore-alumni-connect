/**
 * DESIGN_BACKLOG #5 — post-match feedback.
 *
 * The user's constraint on this was explicit: feedback is human-entered, never
 * model- or system-generated, because Tier-2 training must wait for real
 * responses. So the tests here check that a row can only ever be created by a
 * participant submitting the form, and that the stored shape matches
 * matching_engine.feedback_schema.FeedbackForm field for field.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { queryOne } from '../src/db/repository.js'
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

const VALID_FEEDBACK = {
  satisfactionRating: 4,
  wouldMatchAgain: true,
  sessionsHeld: 3,
  relationshipStatus: 'ongoing' as const,
  primaryGoalProgress: 'significant' as const,
  freeTextComments: 'The portfolio review was the most useful session.',
}

/** Establishes an accepted mentorship and returns its relationship id. */
async function establishRelationship(): Promise<{
  relationshipId: string
  mentor: Awaited<ReturnType<typeof createMentor>>
  student: Awaited<ReturnType<typeof createStudent>>
}> {
  const mentor = await createMentor(app)
  const student = await createStudent(app)
  const requestId = await sendRequest(app, student, mentor.mentorProfileId)

  const accept = await app.inject({
    method: 'PATCH',
    url: `/api/mentorship/requests/${requestId}`,
    headers: { cookie: mentor.cookie },
    payload: { status: 'accepted', responseNotes: 'Happy to help.' },
  })

  if (accept.statusCode !== 200) {
    throw new Error(`Accept failed (${accept.statusCode}): ${accept.body}`)
  }

  const relationships = await app.inject({
    method: 'GET',
    url: '/api/mentorship/relationships',
    headers: { cookie: student.cookie },
  })

  return {
    relationshipId: relationships.json().relationships[0].id as string,
    mentor,
    student,
  }
}

describe('pending feedback', () => {
  it('lists a mentorship for both participants until each has answered', async () => {
    const { relationshipId, mentor, student } = await establishRelationship()

    for (const [label, cookie] of [
      ['student', student.cookie],
      ['mentor', mentor.cookie],
    ] as const) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/feedback/pending',
        headers: { cookie },
      })
      expect(response.json().pending, `${label} should be prompted`).toHaveLength(1)
      expect(response.json().pending[0].relationshipId).toBe(relationshipId)
    }
  })

  it('drops only the respondent’s own prompt after they submit', async () => {
    const { relationshipId, mentor, student } = await establishRelationship()

    await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie: student.cookie },
      payload: { relationshipId, ...VALID_FEEDBACK },
    })

    const studentPending = await app.inject({
      method: 'GET',
      url: '/api/feedback/pending',
      headers: { cookie: student.cookie },
    })
    const mentorPending = await app.inject({
      method: 'GET',
      url: '/api/feedback/pending',
      headers: { cookie: mentor.cookie },
    })

    expect(studentPending.json().pending).toHaveLength(0)
    // The two sides answer independently — one submission is not both.
    expect(mentorPending.json().pending).toHaveLength(1)
  })

  it('prompts nobody when there is no mentorship', async () => {
    const student = await createStudent(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/feedback/pending',
      headers: { cookie: student.cookie },
    })

    expect(response.json().pending).toHaveLength(0)
  })
})

describe('submitting feedback', () => {
  it('stores every training field in the Tier-2 shape', async () => {
    const { relationshipId, student } = await establishRelationship()

    const response = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie: student.cookie },
      payload: { relationshipId, ...VALID_FEEDBACK },
    })

    expect(response.statusCode).toBe(201)

    const row = queryOne<{
      respondent_role: string
      satisfaction_rating: number
      would_match_again: number
      sessions_held: number
      relationship_status: string
      primary_goal_progress: string
      free_text_comments: string
    }>(getDatabase(), 'SELECT * FROM feedback WHERE relationship_id = ?', [relationshipId])

    expect(row).not.toBeNull()
    expect(row?.respondent_role).toBe('student')
    expect(row?.satisfaction_rating).toBe(4)
    expect(row?.would_match_again).toBe(1)
    expect(row?.sessions_held).toBe(3)
    expect(row?.relationship_status).toBe('ongoing')
    expect(row?.primary_goal_progress).toBe('significant')
    expect(row?.free_text_comments).toBe(VALID_FEEDBACK.freeTextComments)
  })

  it('records the mentor’s side with the alumni role', async () => {
    const { relationshipId, mentor } = await establishRelationship()

    await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie: mentor.cookie },
      payload: { relationshipId, ...VALID_FEEDBACK, satisfactionRating: 5 },
    })

    const row = queryOne<{ respondent_role: string }>(
      getDatabase(),
      'SELECT respondent_role FROM feedback WHERE relationship_id = ?',
      [relationshipId],
    )

    expect(row?.respondent_role).toBe('alumni')
  })

  it('rejects a second submission from the same respondent', async () => {
    const { relationshipId, student } = await establishRelationship()

    const payload = { relationshipId, ...VALID_FEEDBACK }
    const first = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie: student.cookie },
      payload,
    })
    const second = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie: student.cookie },
      payload,
    })

    expect(first.statusCode).toBe(201)
    // Duplicate ratings would silently skew any future training set.
    expect(second.statusCode).toBe(409)
  })
})

describe('feedback authorization', () => {
  it('forbids someone outside the mentorship from rating it', async () => {
    const { relationshipId } = await establishRelationship()
    const outsider = await createStudent(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie: outsider.cookie },
      payload: { relationshipId, ...VALID_FEEDBACK },
    })

    expect(response.statusCode).toBe(403)
  })

  it('404s an unknown mentorship', async () => {
    const student = await createStudent(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      headers: { cookie: student.cookie },
      payload: { relationshipId: 'rel_does-not-exist', ...VALID_FEEDBACK },
    })

    expect(response.statusCode).toBe(404)
  })

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { relationshipId: 'rel_x', ...VALID_FEEDBACK },
    })

    expect(response.statusCode).toBe(401)
  })
})

describe('feedback validation', () => {
  it('rejects ratings outside 1–5 and unknown enum values', async () => {
    const { relationshipId, student } = await establishRelationship()

    const invalidPayloads = [
      { ...VALID_FEEDBACK, satisfactionRating: 0 },
      { ...VALID_FEEDBACK, satisfactionRating: 6 },
      { ...VALID_FEEDBACK, sessionsHeld: -1 },
      { ...VALID_FEEDBACK, relationshipStatus: 'paused' },
      { ...VALID_FEEDBACK, primaryGoalProgress: 'lots' },
    ]

    for (const payload of invalidPayloads) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/feedback',
        headers: { cookie: student.cookie },
        payload: { relationshipId, ...payload },
      })
      expect(response.statusCode, JSON.stringify(payload)).toBe(400)
    }

    // None of the rejected attempts left a row behind.
    const row = queryOne(getDatabase(), 'SELECT id FROM feedback WHERE relationship_id = ?', [
      relationshipId,
    ])
    expect(row).toBeNull()
  })
})
