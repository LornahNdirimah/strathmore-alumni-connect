/**
 * Mentor recommendations: who is eligible, and what gets logged.
 *
 * The ML worker is disabled under test, so these exercise the fallback path.
 * Eligibility is decided before either path runs (via the capacity map both
 * receive), so the rules pinned here hold for the ML ranking too.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { queryScalar } from '../src/db/repository.js'
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

async function recommend(cookie: string): Promise<string[]> {
  const response = await app.inject({
    method: 'GET',
    url: '/api/mentors/recommendations?limit=10',
    headers: { cookie },
  })
  if (response.statusCode !== 200) {
    throw new Error(`Recommendations failed (${response.statusCode}): ${response.body}`)
  }
  return (response.json().items as Array<{ id: string }>).map((item) => item.id)
}

describe('GET /api/mentors/recommendations', () => {
  it('suggests mentors with free capacity and skips full ones', async () => {
    const open = await createMentor(app, { capacity: 2 })
    const full = await createMentor(app, { capacity: 0 })
    const student = await createStudent(app)

    const ids = await recommend(student.cookie)

    expect(ids).toContain(open.mentorProfileId)
    expect(ids).not.toContain(full.mentorProfileId)
  })

  it('does not suggest a mentor the student already has a pending request with', async () => {
    const requested = await createMentor(app)
    const other = await createMentor(app)
    const student = await createStudent(app)
    await sendRequest(app, student, requested.mentorProfileId)

    const ids = await recommend(student.cookie)

    expect(ids).not.toContain(requested.mentorProfileId)
    expect(ids).toContain(other.mentorProfileId)
  })

  it('does not suggest a mentor the student is already working with', async () => {
    const current = await createMentor(app)
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, current.mentorProfileId)
    await app.inject({
      method: 'PATCH',
      url: `/api/mentorship/requests/${requestId}`,
      headers: { cookie: current.cookie },
      payload: { status: 'accepted' },
    })

    expect(await recommend(student.cookie)).not.toContain(current.mentorProfileId)
  })

  it('logs one "suggested" event per mentor per day, not one per page load', async () => {
    await createMentor(app)
    await createMentor(app)
    const student = await createStudent(app)

    const shown = await recommend(student.cookie)
    await recommend(student.cookie)
    await recommend(student.cookie)

    const logged = queryScalar<number>(
      getDatabase(),
      "SELECT COUNT(*) FROM match_events WHERE student_user_id = ? AND event_type = 'suggested'",
      [student.userId],
    )
    expect(logged).toBe(shown.length)
  })
})
