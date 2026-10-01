/**
 * The role model (lib/policy.ts) as the API enforces it.
 *
 * Students are mentored; alumni may mentor or not; admins verify, manage and
 * announce but take no part in mentorship, messaging or community membership;
 * an alumnus awaiting verification can do nothing but learn that they are
 * waiting; a suspended account is shut out on its very next request.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { queryOne } from '../src/db/repository.js'
import { createAdmin, createMentor, createStudent } from './helpers/fixtures.js'
import {
  createTestApp,
  resetTables,
  signupAndAuth,
  type TestContext,
} from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  resetTables()
})

let counter = 0
const email = (prefix: string) => `${prefix}-${++counter}-${Date.now()}@strathmore.edu`

async function me(cookie: string) {
  return app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: object) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) })
}

describe('alumni verification on signup', () => {
  it('requires a class year and programme from alumni, not from students', async () => {
    const alumni = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { name: 'Grace Wanjiru', email: email('a'), password: 'long-enough-pass', role: 'alumni', acceptTerms: true },
    })
    expect(alumni.statusCode).toBe(400)
    const fields = (alumni.json().error.details as Array<{ field: string }>).map((d) => d.field)
    expect(fields).toEqual(expect.arrayContaining(['classYear', 'program']))

    const student = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { name: 'Kevin Otieno', email: email('s'), password: 'long-enough-pass', role: 'student', acceptTerms: true },
    })
    expect(student.statusCode).toBe(201)
  })

  it('puts a new alumnus in the admin queue, pending, with no capabilities', async () => {
    const { cookie, userId } = await signupAndAuth(app, {
      email: email('pending'),
      password: 'long-enough-pass',
      role: 'alumni',
      verified: false,
    })
    const admin = await createAdmin(app)

    const queue = await call('GET', '/api/admin/verifications', admin.cookie)
    const entry = (queue.json().verifications as Array<{ user_id: string; status: string }>).find(
      (item) => item.user_id === userId,
    )
    expect(entry?.status).toBe('pending')

    // They can still learn where they stand...
    const session = await me(cookie)
    expect(session.statusCode).toBe(200)
    expect(session.json().user).toMatchObject({
      status: 'pending',
      capabilities: [],
      verification: { status: 'pending', classYear: '2016', program: 'BSc Informatics' },
    })

    // ...but nothing else.
    expect((await call('GET', '/api/groups', cookie)).statusCode).toBe(403)
    expect((await call('GET', '/api/mentors', cookie)).statusCode).toBe(403)
    expect((await call('GET', '/api/events', cookie)).statusCode).toBe(403)
  })

  it('hides a pending alumnus from the mentor directory', async () => {
    const pending = await createMentor(app, { name: 'Pending Mentor' })
    getDatabase().prepare("UPDATE users SET status = 'pending' WHERE id = ?").run(pending.userId)
    const student = await createStudent(app)

    const search = await call('GET', '/api/mentors?limit=50', student.cookie)
    const ids = (search.json().items as Array<{ id: string }>).map((item) => item.id)
    expect(ids).not.toContain(pending.mentorProfileId)
  })

  it('grants capabilities once an administrator approves', async () => {
    const { cookie, userId } = await signupAndAuth(app, {
      email: email('approve'),
      password: 'long-enough-pass',
      role: 'alumni',
      verified: false,
    })
    const admin = await createAdmin(app)
    const entry = queryOne<{ id: string }>(
      getDatabase(),
      'SELECT id FROM alumni_verifications WHERE user_id = ?',
      [userId],
    )

    await call('PATCH', `/api/admin/verifications/${entry!.id}`, admin.cookie, { status: 'approved' })

    const session = (await me(cookie)).json().user
    expect(session.status).toBe('active')
    expect(session.capabilities).toContain('communities.create')
    expect((await call('GET', '/api/groups', cookie)).statusCode).toBe(200)
  })
})

describe('capabilities by role', () => {
  it('describes each role as decided', async () => {
    const student = await createStudent(app)
    const mentor = await createMentor(app)
    const nonMentor = await signupAndAuth(app, {
      email: email('alum'),
      password: 'long-enough-pass',
      role: 'alumni',
    })
    const admin = await createAdmin(app)

    const caps = async (cookie: string) => (await me(cookie)).json().user.capabilities as string[]

    expect(await caps(student.cookie)).toEqual(
      expect.arrayContaining(['mentorship.request', 'opportunities.apply', 'communities.join']),
    )
    expect(await caps(student.cookie)).not.toContain('communities.create')

    expect(await caps(mentor.cookie)).toContain('mentorship.mentor')
    expect(await caps(mentor.cookie)).not.toContain('mentorship.become-mentor')

    // Mentoring is optional for alumni: a non-mentor is a full member.
    expect(await caps(nonMentor.cookie)).toEqual(
      expect.arrayContaining(['mentorship.become-mentor', 'communities.create', 'messaging.use']),
    )
    expect(await caps(nonMentor.cookie)).not.toContain('mentorship.mentor')

    expect((await caps(admin.cookie)).sort()).toEqual(
      ['admin.manage', 'communities.moderate', 'communities.view', 'events.manage', 'events.view'].sort(),
    )
  })

  it('keeps an alumnus who does not mentor out of mentor-only actions, but lets them post jobs', async () => {
    const alumnus = await signupAndAuth(app, {
      email: email('alum'),
      password: 'long-enough-pass',
      role: 'alumni',
    })

    expect((await call('GET', '/api/scheduling/availability/me', alumnus.cookie)).statusCode).toBe(403)
    expect((await call('GET', '/api/mentorship/requests', alumnus.cookie)).statusCode).toBe(200)
    // Sharing an opening is not a mentoring act (ROADMAP D5).
    expect(
      (await call('POST', '/api/opportunities', alumnus.cookie, { title: 'Intern', type: 'Internship' }))
        .statusCode,
    ).toBe(201)
  })
})

describe('admins take no part in mentorship', () => {
  it('refuses admins the mentor directory, requests, sessions, feedback and event registration', async () => {
    const admin = await createAdmin(app)
    const mentor = await createMentor(app)

    const refused = [
      await call('GET', '/api/mentors', admin.cookie),
      await call('GET', `/api/mentors/${mentor.mentorProfileId}`, admin.cookie),
      await call('GET', '/api/mentorship/requests', admin.cookie),
      await call('GET', '/api/mentorship/relationships', admin.cookie),
      await call('GET', '/api/feedback/pending', admin.cookie),
      await call('POST', '/api/events/evt-1/register', admin.cookie),
    ]
    for (const response of refused) expect(response.statusCode).toBe(403)
  })

  it('lets admins see and remove a community, but never join or create one', async () => {
    const admin = await createAdmin(app)
    const mentor = await createMentor(app)
    const created = await call('POST', '/api/groups', mentor.cookie, {
      name: 'Fintech circle',
      topic: 'Finance',
      description: 'Alumni working in fintech.',
    })
    const groupId = created.json().group.id as string

    expect((await call('GET', `/api/groups/${groupId}`, admin.cookie)).statusCode).toBe(200)
    expect((await call('POST', `/api/groups/${groupId}/join`, admin.cookie)).statusCode).toBe(403)
    expect(
      (await call('POST', '/api/groups', admin.cookie, { name: 'Admins', topic: 'x', description: 'y' }))
        .statusCode,
    ).toBe(403)

    // Moderation belongs to admins alone — not even the creator.
    expect((await call('DELETE', `/api/groups/${groupId}`, mentor.cookie)).statusCode).toBe(403)
    expect((await call('DELETE', `/api/groups/${groupId}`, admin.cookie)).statusCode).toBe(200)
    expect((await call('GET', `/api/groups/${groupId}`, mentor.cookie)).statusCode).toBe(404)
  })
})

describe('suspension', () => {
  it('shuts a suspended account out on its next request, and reactivation restores it', async () => {
    const admin = await createAdmin(app)
    const student = await createStudent(app)

    const suspend = await call('PATCH', `/api/admin/users/${student.userId}/status`, admin.cookie, {
      status: 'suspended',
    })
    expect(suspend.statusCode).toBe(200)

    // The student's token is still within its 12 hours — and no longer enough.
    expect((await me(student.cookie)).statusCode).toBe(401)
    expect((await call('GET', '/api/events', student.cookie)).statusCode).toBe(401)

    await call('PATCH', `/api/admin/users/${student.userId}/status`, admin.cookie, { status: 'active' })
    expect((await me(student.cookie)).statusCode).toBe(200)
  })

  it('cannot suspend an admin, or activate a pending alumnus around verification', async () => {
    const admin = await createAdmin(app)
    const other = await createAdmin(app)
    const pending = await signupAndAuth(app, {
      email: email('pending'),
      password: 'long-enough-pass',
      role: 'alumni',
      verified: false,
    })

    const onAdmin = await call('PATCH', `/api/admin/users/${other.userId}/status`, admin.cookie, {
      status: 'suspended',
    })
    expect(onAdmin.statusCode).toBe(403)

    const bypass = await call('PATCH', `/api/admin/users/${pending.userId}/status`, admin.cookie, {
      status: 'active',
    })
    expect(bypass.statusCode).toBe(409)
  })

  it('is admin-only', async () => {
    const student = await createStudent(app)
    const other = await createStudent(app)

    const response = await call('PATCH', `/api/admin/users/${other.userId}/status`, student.cookie, {
      status: 'suspended',
    })
    expect(response.statusCode).toBe(403)
  })
})
