/**
 * Admin surface: the role boundary, verification review, and the guarantee that
 * no credential material ever leaves the database layer.
 *
 * The mock's admin screens read the same in-memory user array the browser had,
 * plaintext passwords included. The boundary being tested here is the whole
 * reason that model had to go.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { queryOne } from '../src/db/repository.js'
import {
  createAdmin,
  createMentor,
  createStudent,
  queueVerification,
} from './helpers/fixtures.js'
import { createTestApp, resetTables, type TestContext } from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

const ADMIN_ROUTES = [
  { method: 'GET' as const, url: '/api/admin/verifications' },
  { method: 'GET' as const, url: '/api/admin/users' },
  { method: 'GET' as const, url: '/api/admin/stats' },
  { method: 'GET' as const, url: '/api/admin/announcements' },
]

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  resetTables()
})

describe('admin role boundary', () => {
  it('rejects anonymous callers on every admin route', async () => {
    for (const route of ADMIN_ROUTES) {
      const response = await app.inject(route)
      expect(response.statusCode, `${route.url} should require auth`).toBe(401)
    }
  })

  it('forbids students and alumni on every admin route', async () => {
    const student = await createStudent(app)
    const mentor = await createMentor(app)

    for (const route of ADMIN_ROUTES) {
      for (const [label, cookie] of [
        ['student', student.cookie],
        ['alumni', mentor.cookie],
      ] as const) {
        const response = await app.inject({ ...route, headers: { cookie } })
        expect(response.statusCode, `${label} → ${route.url}`).toBe(403)
      }
    }
  })

  it('forbids a student from publishing an announcement', async () => {
    const student = await createStudent(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/announcements',
      headers: { cookie: student.cookie },
      payload: { title: 'Free laptops', audience: 'all', body: 'Claim yours at this link.' },
    })

    expect(response.statusCode).toBe(403)
  })

  it('admits an admin to all of them', async () => {
    const admin = await createAdmin(app)

    for (const route of ADMIN_ROUTES) {
      const response = await app.inject({ ...route, headers: { cookie: admin.cookie } })
      expect(response.statusCode, route.url).toBe(200)
    }
  })
})

describe('credential exposure', () => {
  it('never includes password material in the user directory', async () => {
    const admin = await createAdmin(app)
    await createStudent(app)
    await createMentor(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      headers: { cookie: admin.cookie },
    })

    expect(response.statusCode).toBe(200)
    // Asserted on the raw body, so a nested or renamed field cannot slip past.
    expect(response.body).not.toMatch(/password/i)
    expect(response.body).not.toMatch(/salt/i)

    for (const user of response.json().users as Record<string, unknown>[]) {
      expect(Object.keys(user).sort()).toEqual(
        ['avatarUrl', 'created_at', 'email', 'id', 'name', 'role', 'status'].sort(),
      )
    }
  })
})

describe('verification review', () => {
  it('activates a pending alumni account on approval', async () => {
    const admin = await createAdmin(app)
    const mentor = await createMentor(app)
    const verificationId = queueVerification(mentor.userId)

    // Simulate the pending state an unverified alumnus signs up into.
    getDatabase().exec(`UPDATE users SET status = 'pending' WHERE id = '${mentor.userId}'`)

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/verifications/${verificationId}`,
      headers: { cookie: admin.cookie },
      payload: { status: 'approved' },
    })

    expect(response.statusCode).toBe(200)

    const user = queryOne<{ status: string }>(
      getDatabase(),
      'SELECT status FROM users WHERE id = ?',
      [mentor.userId],
    )
    // Approval and account status must move together, or an approved alumnus
    // stays locked out.
    expect(user?.status).toBe('active')

    const verification = queryOne<{ status: string; reviewed_by: string; reviewed_at: string }>(
      getDatabase(),
      'SELECT status, reviewed_by, reviewed_at FROM alumni_verifications WHERE id = ?',
      [verificationId],
    )
    expect(verification?.status).toBe('approved')
    expect(verification?.reviewed_by).toBe(admin.userId)
    expect(verification?.reviewed_at).toBeTruthy()
  })

  it('leaves the account alone when flagged for review', async () => {
    const admin = await createAdmin(app)
    const mentor = await createMentor(app)
    const verificationId = queueVerification(mentor.userId)
    getDatabase().exec(`UPDATE users SET status = 'pending' WHERE id = '${mentor.userId}'`)

    await app.inject({
      method: 'PATCH',
      url: `/api/admin/verifications/${verificationId}`,
      headers: { cookie: admin.cookie },
      payload: { status: 'review' },
    })

    const user = queryOne<{ status: string }>(
      getDatabase(),
      'SELECT status FROM users WHERE id = ?',
      [mentor.userId],
    )
    expect(user?.status).toBe('pending')
  })

  it('sorts pending entries to the top of the queue', async () => {
    const admin = await createAdmin(app)
    const first = await createMentor(app, { name: 'Amina Osei' })
    const second = await createMentor(app, { name: 'Brian Kimani' })
    const reviewed = queueVerification(first.userId)
    queueVerification(second.userId)

    await app.inject({
      method: 'PATCH',
      url: `/api/admin/verifications/${reviewed}`,
      headers: { cookie: admin.cookie },
      payload: { status: 'approved' },
    })

    const queue = await app.inject({
      method: 'GET',
      url: '/api/admin/verifications',
      headers: { cookie: admin.cookie },
    })

    const statuses = (queue.json().verifications as { status: string }[]).map((v) => v.status)
    expect(statuses[0]).toBe('pending')
  })

  it('404s an unknown verification and rejects a bad status', async () => {
    const admin = await createAdmin(app)
    const mentor = await createMentor(app)
    const verificationId = queueVerification(mentor.userId)

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/admin/verifications/ver_missing',
      headers: { cookie: admin.cookie },
      payload: { status: 'approved' },
    })
    expect(missing.statusCode).toBe(404)

    const invalid = await app.inject({
      method: 'PATCH',
      url: `/api/admin/verifications/${verificationId}`,
      headers: { cookie: admin.cookie },
      payload: { status: 'verified-ish' },
    })
    expect(invalid.statusCode).toBe(400)
  })
})

describe('announcements', () => {
  it('publishes and lists an announcement', async () => {
    const admin = await createAdmin(app)

    const published = await app.inject({
      method: 'POST',
      url: '/api/admin/announcements',
      headers: { cookie: admin.cookie },
      payload: {
        title: 'Mentorship cohort opens Monday',
        audience: 'students',
        body: 'Submit your career-goals form before Friday to be matched in this cohort.',
      },
    })

    expect(published.statusCode).toBe(201)
    expect(published.json().message).toBe('Announcement published to students.')

    const listing = await app.inject({
      method: 'GET',
      url: '/api/admin/announcements',
      headers: { cookie: admin.cookie },
    })
    expect(listing.json().announcements).toHaveLength(1)
  })

  it('rejects an empty title or an unknown audience', async () => {
    const admin = await createAdmin(app)

    for (const payload of [
      { title: '', audience: 'all', body: 'Body text that is long enough.' },
      { title: 'Valid title', audience: 'everyone', body: 'Body text that is long enough.' },
      { title: 'Valid title', audience: 'all', body: 'x' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/announcements',
        headers: { cookie: admin.cookie },
        payload,
      })
      expect(response.statusCode, JSON.stringify(payload)).toBe(400)
    }
  })
})

describe('platform stats', () => {
  it('counts real rows rather than returning fixed numbers', async () => {
    const admin = await createAdmin(app)
    await createMentor(app)
    await createStudent(app)
    await createStudent(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/stats',
      headers: { cookie: admin.cookie },
    })

    const stats = response.json().stats as Record<string, number>
    expect(stats.totalStudents).toBe(2)
    expect(stats.totalAlumni).toBe(1)
    expect(stats.activeMentors).toBe(1)
    expect(stats.optedInStudents).toBe(2)
    expect(stats.totalUsers).toBe(4) // 2 students + 1 alumnus + the admin
    expect(stats.activeRelationships).toBe(0)
  })
})
