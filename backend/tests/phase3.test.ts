/**
 * Opportunities owned by alumni, announcements reaching their audience, events
 * run by admins, and the admin audit log (DESIGN_BACKLOG #22, #23, #29, #45;
 * ROADMAP D5).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createAdmin, createMentor, createStudent } from './helpers/fixtures.js'
import { createTestApp, resetTables, signupAndAuth, type TestContext } from './helpers/testApp.js'

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

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  cookie: string,
  payload?: object,
) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) })
}

/** 'YYYY-MM-DDTHH:mm' this many days ahead, on whatever clock the test names. */
function localInDays(days: number, time = '18:00'): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return `${date}T${time}`
}

describe('opportunities', () => {
  it('lets an alumnus who does not mentor post one, and students apply', async () => {
    const alumnus = await signupAndAuth(app, { email: email('alum'), password: 'long-enough-pass', role: 'alumni' })
    const student = await createStudent(app)

    const posted = await call('POST', '/api/opportunities', alumnus.cookie, {
      title: 'Data analyst intern',
      type: 'Internship',
      location: 'Nairobi',
    })
    expect(posted.statusCode).toBe(201)
    const id = posted.json().opportunity.id as string

    const feed = (await call('GET', '/api/opportunities', student.cookie)).json().opportunities
    expect(feed.map((item: { id: string }) => item.id)).toContain(id)

    expect((await call('POST', `/api/opportunities/${id}/apply`, student.cookie, { message: 'Keen!' })).statusCode).toBe(201)
    expect((await call('POST', `/api/opportunities/${id}/apply`, student.cookie)).statusCode).toBe(409)
  })

  it('shows the poster — and only the poster — who applied', async () => {
    const poster = await createMentor(app)
    const other = await createMentor(app, { name: 'Brian Kimani' })
    const student = await createStudent(app)

    const id = (await call('POST', '/api/opportunities', poster.cookie, { title: 'Junior dev', type: 'Full-time' }))
      .json().opportunity.id as string
    await call('POST', `/api/opportunities/${id}/apply`, student.cookie, { message: 'I have built two APIs.' })

    const applicants = await call('GET', `/api/opportunities/${id}/applications`, poster.cookie)
    expect(applicants.json().applicants).toEqual([
      expect.objectContaining({ userId: student.userId, message: 'I have built two APIs.' }),
    ])
    expect((await call('GET', `/api/opportunities/${id}/applications`, other.cookie)).statusCode).toBe(404)

    const mine = (await call('GET', '/api/opportunities/mine', poster.cookie)).json().opportunities
    expect(mine[0]).toMatchObject({ id, applicantCount: 1 })
  })

  it('stops applications once the poster closes it, and hides it from the feed', async () => {
    const poster = await createMentor(app)
    const student = await createStudent(app)
    const id = (await call('POST', '/api/opportunities', poster.cookie, { title: 'Volunteer', type: 'Volunteer' }))
      .json().opportunity.id as string

    expect((await call('POST', `/api/opportunities/${id}/close`, poster.cookie)).statusCode).toBe(200)

    const feed = (await call('GET', '/api/opportunities', student.cookie)).json().opportunities
    expect(feed.map((item: { id: string }) => item.id)).not.toContain(id)
    expect((await call('POST', `/api/opportunities/${id}/apply`, student.cookie)).statusCode).toBe(409)
  })

  it('keeps students from posting and admins from the board', async () => {
    const student = await createStudent(app)
    const admin = await createAdmin(app)

    expect((await call('POST', '/api/opportunities', student.cookie, { title: 'x job', type: 'Volunteer' })).statusCode).toBe(403)
    expect((await call('GET', '/api/opportunities', admin.cookie)).statusCode).toBe(403)
  })
})

describe('announcements', () => {
  it('reach everyone they are addressed to, and no one else', async () => {
    const admin = await createAdmin(app)
    const student = await createStudent(app)
    const mentor = await createMentor(app)

    for (const [title, audience] of [
      ['For everyone', 'all'],
      ['For students', 'students'],
      ['For alumni', 'alumni'],
    ] as const) {
      await call('POST', '/api/admin/announcements', admin.cookie, { title, audience, body: 'Details inside.' })
    }

    const titles = async (cookie: string) =>
      ((await call('GET', '/api/announcements', cookie)).json().announcements as Array<{ title: string }>)
        .map((item) => item.title)
        .sort()

    expect(await titles(student.cookie)).toEqual(['For everyone', 'For students'])
    expect(await titles(mentor.cookie)).toEqual(['For alumni', 'For everyone'])
    expect(await titles(admin.cookie)).toEqual(['For alumni', 'For everyone', 'For students'])
  })
})

describe('events', () => {
  it('lets an admin schedule an event on a local clock, stored as the real instant', async () => {
    const admin = await createAdmin(app)
    const student = await createStudent(app)

    const created = await call('POST', '/api/events', admin.cookie, {
      title: 'Fintech careers evening',
      description: 'Alumni from three banks on their first jobs.',
      startsAt: localInDays(10, '18:00'),
      endsAt: localInDays(10, '20:00'),
      timezoneLabel: 'EAT',
      location: 'Strathmore Business School',
      type: 'In-Person',
      tag: 'Careers',
    })
    expect(created.statusCode).toBe(201)
    const event = created.json().event
    // 18:00 in Nairobi is 15:00 UTC.
    expect(new Date(event.startsAt).getUTCHours()).toBe(15)
    expect(event.time).toBe('6:00 PM - 8:00 PM EAT')
    expect(event.startsAtLocal).toBe(localInDays(10, '18:00'))

    const listed = (await call('GET', '/api/events', student.cookie)).json().events
    expect(listed.map((item: { id: string }) => item.id)).toContain(event.id)
  })

  it('shows attendees to admins, and cancelling closes registration', async () => {
    const admin = await createAdmin(app)
    const student = await createStudent(app)
    const id = (
      await call('POST', '/api/events', admin.cookie, {
        title: 'Hackathon',
        description: 'Build something in a day.',
        startsAt: localInDays(5, '09:00'),
        location: 'Online',
        type: 'Online',
        tag: 'Tech',
      })
    ).json().event.id as string

    await call('POST', `/api/events/${id}/register`, student.cookie)
    const attendees = (await call('GET', `/api/events/${id}/attendees`, admin.cookie)).json().attendees
    expect(attendees).toEqual([expect.objectContaining({ userId: student.userId })])
    expect((await call('GET', `/api/events/${id}/attendees`, student.cookie)).statusCode).toBe(403)

    expect((await call('POST', `/api/events/${id}/cancel`, admin.cookie)).statusCode).toBe(200)
    const other = await createStudent(app)
    expect((await call('POST', `/api/events/${id}/register`, other.cookie)).statusCode).toBe(409)
    const listed = (await call('GET', '/api/events', student.cookie)).json().events
    expect(listed.find((item: { id: string }) => item.id === id)?.cancelled).toBe(true)
  })

  it('refuses a past start, an end before the start, and non-admins', async () => {
    const admin = await createAdmin(app)
    const mentor = await createMentor(app)
    const base = { title: 'Talk', description: 'A short talk.', location: 'Online', type: 'Online', tag: 'Tech' }

    expect((await call('POST', '/api/events', admin.cookie, { ...base, startsAt: localInDays(-2) })).statusCode).toBe(400)
    expect(
      (await call('POST', '/api/events', admin.cookie, {
        ...base,
        startsAt: localInDays(3, '18:00'),
        endsAt: localInDays(3, '17:00'),
      })).statusCode,
    ).toBe(400)
    expect((await call('POST', '/api/events', mentor.cookie, { ...base, startsAt: localInDays(3) })).statusCode).toBe(403)
  })
})

describe('admin audit log', () => {
  it('records each admin action with who did it', async () => {
    const admin = await createAdmin(app)
    const student = await createStudent(app)

    await call('PATCH', `/api/admin/users/${student.userId}/status`, admin.cookie, { status: 'suspended' })
    await call('POST', '/api/admin/announcements', admin.cookie, { title: 'Exams', audience: 'all', body: 'Good luck all.' })
    await call('POST', '/api/events', admin.cookie, {
      title: 'Mixer',
      description: 'Meet the alumni.',
      startsAt: localInDays(4),
      location: 'Online',
      type: 'Online',
      tag: 'Social',
    })

    const entries = (await call('GET', '/api/admin/audit', admin.cookie)).json().entries as Array<{
      action: string
      adminName: string
    }>
    expect(entries.map((entry) => entry.action).sort()).toEqual(
      ['announcement.published', 'event.created', 'user.suspended'].sort(),
    )
    expect(entries.every((entry) => entry.adminName === 'Platform Admin')).toBe(true)

    expect((await call('GET', '/api/admin/audit', student.cookie)).statusCode).toBe(401) // suspended
  })
})
