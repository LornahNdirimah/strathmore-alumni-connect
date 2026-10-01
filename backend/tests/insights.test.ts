/**
 * Phase 8: re-ranking by reliability and exposure (#51, #52), the admin
 * insights (#47, #48, #50) and paged user lists (#49).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { execute, queryAll } from '../src/db/repository.js'
import { newId } from '../src/lib/id.js'
import { exposureFactor, reliabilityFactor, rerank } from '../src/services/matching/rerank.js'
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

/** A request from a fresh student that lapsed unanswered a while ago. */
async function lapsedRequest(mentorProfileId: string) {
  const student = await createStudent(app)
  const id = await sendRequest(app, student, mentorProfileId)
  execute(getDatabase(), "UPDATE mentorship_requests SET status = 'expired', created_at = ? WHERE id = ?", [daysAgo(20), id])
}

function suggest(studentUserId: string, mentorProfileId: string, metadata: object = {}, at = daysAgo(1)) {
  execute(
    getDatabase(),
    `INSERT INTO match_events (id, event_type, student_user_id, mentor_profile_id, occurred_at, metadata)
     VALUES (?, 'suggested', ?, ?, ?, ?)`,
    [newId('evt'), studentUserId, mentorProfileId, at, JSON.stringify(metadata)],
  )
}

async function recommendIds(cookie: string, limit = 2): Promise<string[]> {
  const response = await call('GET', `/api/mentors/recommendations?limit=${limit}`, cookie)
  expect(response.statusCode).toBe(200)
  return (response.json().items as Array<{ id: string }>).map((item) => item.id)
}

describe('re-ranking arithmetic', () => {
  it('leaves a mentor with no history, or one miss among many answers, near neutral', () => {
    expect(reliabilityFactor(0, 0, null)).toBe(1)
    expect(reliabilityFactor(10, 1, 12)).toBeGreaterThan(0.95)
    expect(reliabilityFactor(0, 5, null)).toBeLessThan(0.75)
    expect(reliabilityFactor(0, 50, null)).toBeGreaterThanOrEqual(0.6)
    // Answering, but slowly, costs a little.
    expect(reliabilityFactor(5, 0, 100)).toBeLessThan(reliabilityFactor(5, 0, 10))
  })

  it('starts easing a mentor down only past the weekly allowance per free seat', () => {
    expect(exposureFactor(3, 1)).toBe(1)
    expect(exposureFactor(6, 2)).toBe(1)
    expect(exposureFactor(13, 1)).toBeCloseTo(0.5)
    expect(exposureFactor(4, 0)).toBeLessThan(1) // a full mentor counts as one seat
  })

  it("keeps the matcher's order when nothing distinguishes the candidates", () => {
    const candidates = [
      { mentorProfileId: 'a', score: 0.5 },
      { mentorProfileId: 'b', score: 0.5 },
      { mentorProfileId: 'c', score: 0.4 },
    ]
    const empty = { reliability: new Map(), exposure: new Map(), remaining: new Map() }
    expect(rerank(candidates, empty, 2).map((entry) => entry.mentorProfileId)).toEqual(['a', 'b'])
  })
})

describe('recommendations', () => {
  it('ranks a mentor who lets requests lapse below an equally good one who answers', async () => {
    await createMentor(app, { capacity: 5 })
    await createMentor(app, { capacity: 5 })
    // The two tie on fit; whichever the matcher puts first is the one that lapses.
    const [lapsing, answering] = await recommendIds((await createStudent(app)).cookie)
    execute(getDatabase(), 'DELETE FROM match_events')
    for (let i = 0; i < 4; i += 1) await lapsedRequest(lapsing!)

    const student = await createStudent(app)
    expect(await recommendIds(student.cookie)).toEqual([answering, lapsing])
  })

  it('rotates in a mentor who has not been shown when another has been shown to everyone', async () => {
    const popular = await createMentor(app, { capacity: 1 })
    const unseen = await createMentor(app, { capacity: 1 })
    // Ordinarily the tie keeps the matcher's order; make the popular one first.
    const [first] = await recommendIds((await createStudent(app)).cookie, 1)
    const [shown, other] = first === popular.mentorProfileId ? [popular, unseen] : [unseen, popular]
    execute(getDatabase(), "DELETE FROM match_events")

    for (let i = 0; i < 10; i += 1) suggest((await createStudent(app)).userId, shown.mentorProfileId)

    const student = await createStudent(app)
    expect(await recommendIds(student.cookie, 1)).toEqual([other.mentorProfileId])
  })

  it('logs the rank of each suggestion, for the outcome evaluation', async () => {
    await createMentor(app)
    await createMentor(app)
    const student = await createStudent(app)
    await recommendIds(student.cookie)

    const ranks = queryAll<{ metadata: string }>(getDatabase(), 'SELECT metadata FROM match_events')
      .map((row) => JSON.parse(row.metadata).rank as number)
      .sort()
    expect(ranks).toEqual([1, 2])
  })
})

describe('admin insights', () => {
  it('shows where students outnumber free seats', async () => {
    const admin = await createAdmin(app)
    await createMentor(app, { capacity: 1, tracks: ['Finance'] })
    await createStudent(app, { targetTrack: 'Data Science' })
    await createStudent(app, { targetTrack: 'Data Science' })
    await createStudent(app, { targetTrack: 'Finance' })

    const response = await call('GET', '/api/admin/insights', admin.cookie)
    expect(response.statusCode).toBe(200)
    const supply = response.json().supply as Array<{ track: string; waiting: number; freeSeats: number; shortfall: number }>
    expect(supply[0]).toMatchObject({ track: 'Data Science', waiting: 2, freeSeats: 0, shortfall: 2 })
    expect(supply.find((row) => row.track === 'Finance')).toMatchObject({ waiting: 1, freeSeats: 1, shortfall: 0 })
    expect(supply).toHaveLength(8)
  })

  it('follows suggestions through to requests, acceptance, a held session and feedback', async () => {
    const admin = await createAdmin(app)
    const mentor = await createMentor(app, { capacity: 5 })
    const taken = await createStudent(app)
    const ignored = await createStudent(app)
    suggest(taken.userId, mentor.mentorProfileId, { score: 0.8, rank: 1 }, daysAgo(2))
    suggest(ignored.userId, mentor.mentorProfileId, { score: 0.3, rank: 2 }, daysAgo(2))

    const requestId = await sendRequest(app, taken, mentor.mentorProfileId)
    await call('PATCH', `/api/mentorship/requests/${requestId}`, mentor.cookie, { status: 'accepted', responseNotes: 'Yes.' })
    const [relationship] = queryAll<{ id: string }>(getDatabase(), 'SELECT id FROM mentorship_relationships')
    execute(
      getDatabase(),
      `INSERT INTO sessions (id, relationship_id, title, scheduled_at, duration_min, status, created_at, mentor_profile_id, student_user_id)
       VALUES ('s-held', ?, 'Kick-off', ?, 30, 'completed', ?, ?, ?)`,
      [relationship!.id, daysAgo(0), daysAgo(0), mentor.mentorProfileId, taken.userId],
    )
    const feedback = await call('POST', '/api/feedback', taken.cookie, {
      relationshipId: relationship!.id,
      satisfactionRating: 5,
      wouldMatchAgain: true,
      sessionsHeld: 1,
      relationshipStatus: 'ongoing',
      primaryGoalProgress: 'some',
    })
    expect(feedback.statusCode).toBe(201)

    const { pipeline } = (await call('GET', '/api/admin/insights?days=30', admin.cookie)).json()
    expect(pipeline.stages.map((stage: { count: number }) => stage.count)).toEqual([2, 1, 1, 1, 1])
    expect(pipeline.stages[1].rateFromPrevious).toBe(0.5)
    expect(pipeline.requests).toMatchObject({ total: 1, afterSuggestion: 1, accepted: 1, acceptRateAfterSuggestion: 1 })
    expect(pipeline.byScore[0]).toMatchObject({ label: '0.75 – 1', suggested: 1, requested: 1, accepted: 1 })
    expect(pipeline.byScore[2]).toMatchObject({ suggested: 1, requested: 0, requestRate: 0 })
    expect(pipeline.byRank[0]).toMatchObject({ suggested: 1, accepted: 1 })
  })

  it('names the mentors whose requests lapse, least responsive first', async () => {
    const admin = await createAdmin(app)
    const often = await createMentor(app, { name: 'Often Missing' })
    const once = await createMentor(app, { name: 'Missed Once' })
    await createMentor(app, { name: 'Never Missed' })
    for (let i = 0; i < 3; i += 1) await lapsedRequest(often.mentorProfileId)
    await lapsedRequest(once.mentorProfileId)

    const { responsiveness } = (await call('GET', '/api/admin/insights', admin.cookie)).json()
    expect(responsiveness.mentors.map((mentor: { name: string }) => mentor.name)).toEqual(['Often Missing', 'Missed Once'])
  })

  it('reports the evaluation as unavailable when the matcher is not running', async () => {
    const admin = await createAdmin(app)
    const response = await call('GET', '/api/admin/insights/evaluation', admin.cookie)
    expect(response.json()).toEqual({ evaluation: null, matching: 'unavailable' })
  })

  it('is for admins only, and accepts only the offered periods', async () => {
    const admin = await createAdmin(app)
    const student = await createStudent(app)
    expect((await call('GET', '/api/admin/insights', student.cookie)).statusCode).toBe(403)
    expect((await call('GET', '/api/admin/insights?days=7', admin.cookie)).statusCode).toBe(400)
  })
})

describe('admin user list', () => {
  it('pages, searches and filters on the server', async () => {
    const admin = await createAdmin(app)
    for (let i = 0; i < 3; i += 1) await createStudent(app)
    await createMentor(app, { name: 'Findable Mentor' })

    const page = (await call('GET', '/api/admin/users?limit=2&page=2', admin.cookie)).json()
    expect(page).toMatchObject({ total: 5, page: 2, limit: 2 })
    expect(page.users).toHaveLength(2)

    const found = (await call('GET', '/api/admin/users?q=findable', admin.cookie)).json()
    expect(found.total).toBe(1)
    expect(found.users[0].name).toBe('Findable Mentor')

    const alumni = (await call('GET', '/api/admin/users?role=alumni', admin.cookie)).json()
    expect(alumni.users.every((user: { role: string }) => user.role === 'alumni')).toBe(true)
    expect(JSON.stringify(alumni)).not.toContain('password')
  })
})
