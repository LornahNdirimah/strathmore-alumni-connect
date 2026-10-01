/**
 * Mentorship quality (ROADMAP Phase 6): goals, session ratings, match
 * explanations, office hours, the opportunities board and the alumni
 * directory (DESIGN_BACKLOG #32, #33, #36, #37, #38, #41).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { execute } from '../src/db/repository.js'
import { explainMatch } from '../src/services/matching/explain.js'
import { createAdmin, createMentor, createStudent, sendRequest } from './helpers/fixtures.js'
import { createTestApp, resetTables, signupAndAuth, type TestContext } from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  resetTables()
})

async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: object) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) })
}

/** 'YYYY-MM-DDTHH:mm' a number of days ahead. */
function localInDays(days: number, time = '18:00'): string {
  return `${new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)}T${time}`
}

const WIDE_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' }))

async function mentorship() {
  const mentor = await createMentor(app)
  const student = await createStudent(app)
  await call('PUT', '/api/scheduling/availability/me', mentor.cookie, { windows: WIDE_WEEK, timezoneLabel: 'UTC' })
  const requestId = await sendRequest(app, student, mentor.mentorProfileId)
  await call('PATCH', `/api/mentorship/requests/${requestId}`, mentor.cookie, { status: 'accepted' })
  const relationshipId = (await call('GET', '/api/mentorship/relationships', student.cookie)).json()
    .relationships[0].id as string
  return { mentor, student, relationshipId }
}

describe('goals', () => {
  it('can be added by either side, ticked off, and removed — up to five', async () => {
    const { mentor, student, relationshipId } = await mentorship()

    const first = await call('POST', `/api/mentorship/relationships/${relationshipId}/goals`, student.cookie, {
      title: 'Land a data internship',
    })
    expect(first.statusCode).toBe(201)
    const goalId = first.json().goal.id as string
    for (const title of ['Finish portfolio', 'Practise interviews', 'Learn SQL', 'Network with 5 alumni']) {
      await call('POST', `/api/mentorship/relationships/${relationshipId}/goals`, mentor.cookie, { title })
    }
    const sixth = await call('POST', `/api/mentorship/relationships/${relationshipId}/goals`, student.cookie, {
      title: 'One too many',
    })
    expect(sixth.statusCode).toBe(409)

    await call('PATCH', `/api/mentorship/goals/${goalId}`, mentor.cookie, { completed: true })
    const view = (await call('GET', '/api/mentorship/relationships', student.cookie)).json().relationships[0]
    expect(view.goals).toHaveLength(5)
    expect(view.goals.find((goal: { id: string }) => goal.id === goalId)).toMatchObject({ completed: true })

    await call('DELETE', `/api/mentorship/goals/${goalId}`, student.cookie)
    expect((await call('GET', '/api/mentorship/relationships', student.cookie)).json().relationships[0].goals).toHaveLength(4)
  })

  it('belong to the pair alone', async () => {
    const { student, relationshipId } = await mentorship()
    const outsider = await createStudent(app)
    const goalId = (
      await call('POST', `/api/mentorship/relationships/${relationshipId}/goals`, student.cookie, { title: 'Ship it' })
    ).json().goal.id as string

    expect((await call('POST', `/api/mentorship/relationships/${relationshipId}/goals`, outsider.cookie, { title: 'Mine now' })).statusCode).toBe(403)
    expect((await call('PATCH', `/api/mentorship/goals/${goalId}`, outsider.cookie, { completed: true })).statusCode).toBe(403)
  })
})

describe('session ratings', () => {
  it('open once a session is held, once per person, participants only', async () => {
    const { mentor, student, relationshipId } = await mentorship()
    const outsider = await createStudent(app)
    const slots = (await call('GET', `/api/scheduling/slots/${mentor.mentorProfileId}?days=7`, student.cookie)).json().slots
    const sessionId = (
      await call('POST', '/api/scheduling/sessions', student.cookie, { relationshipId, title: 'CV', scheduledAt: slots[0].startsAt })
    ).json().session.id as string

    const early = await call('POST', `/api/scheduling/sessions/${sessionId}/rating`, student.cookie, { rating: 5 })
    expect(early.statusCode).toBe(409)

    execute(getDatabase(), "UPDATE sessions SET status = 'completed', scheduled_at = ? WHERE id = ?", [
      new Date(Date.now() - 86_400_000).toISOString(),
      sessionId,
    ])

    expect((await call('POST', `/api/scheduling/sessions/${sessionId}/rating`, outsider.cookie, { rating: 1 })).statusCode).toBe(403)
    expect((await call('POST', `/api/scheduling/sessions/${sessionId}/rating`, student.cookie, { rating: 6 })).statusCode).toBe(400)
    expect(
      (await call('POST', `/api/scheduling/sessions/${sessionId}/rating`, student.cookie, { rating: 5, comment: 'Very useful' })).statusCode,
    ).toBe(201)
    expect((await call('POST', `/api/scheduling/sessions/${sessionId}/rating`, student.cookie, { rating: 4 })).statusCode).toBe(409)

    const past = (await call('GET', '/api/scheduling/sessions?scope=past', student.cookie)).json().sessions
    expect(past[0].myRating).toBe(5)
    const mentorPast = (await call('GET', '/api/scheduling/sessions?scope=past', mentor.cookie)).json().sessions
    expect(mentorPast[0].myRating).toBeNull()
  })
})

describe('match explanations', () => {
  it('names the overlaps, most important first, at most three', () => {
    const reasons = explainMatch(
      {
        targetTrack: 'Data Science',
        major: 'computer science',
        interests: ['python', 'ml'],
        hobbies: ['Chess', 'hiking'],
        country: 'Kenya',
        stateProvince: 'Nairobi',
      },
      {
        tracks: ['Data Science', 'Research'],
        skills: ['Python', 'Leadership'],
        major: 'Computer Science',
        hobbies: ['chess'],
        country: 'Kenya',
        stateProvince: 'Nairobi',
      },
    )
    expect(reasons).toEqual(['Mentors in Data Science', 'Also studied Computer Science', 'Works with Python'])
  })

  it('says nothing it cannot back up', () => {
    const reasons = explainMatch(
      { targetTrack: 'Finance', major: '', interests: [], hobbies: [], country: null, stateProvince: null },
      { tracks: ['Research'], skills: [], major: '', hobbies: [], country: 'Kenya', stateProvince: '' },
    )
    expect(reasons).toEqual([])
  })

  it('are attached to recommendations', async () => {
    await createMentor(app, { tracks: ['Data Science'] })
    const student = await createStudent(app, { targetTrack: 'Data Science' })
    const items = (await call('GET', '/api/mentors/recommendations?limit=5', student.cookie)).json().items
    expect(items[0].matchReasons).toContain('Mentors in Data Science')
  })
})

describe('office hours', () => {
  async function host(mentorCookie: string, overrides: object = {}) {
    return call('POST', '/api/office-hours', mentorCookie, {
      title: 'CV clinic',
      startsAt: localInDays(3, '17:00'),
      durationMin: 60,
      capacity: 2,
      meetingLink: 'https://meet.example.com/cv',
      ...overrides,
    })
  }

  it('are hosted by mentors on their own clock, and joined by students up to capacity', async () => {
    const mentor = await createMentor(app)
    // The mentor's timezone decides what 17:00 means: 14:00 UTC for EAT.
    await call('PUT', '/api/scheduling/availability/me', mentor.cookie, { windows: [], timezoneLabel: 'EAT' })
    const created = await host(mentor.cookie)
    expect(created.statusCode).toBe(201)
    const officeHour = created.json().officeHour
    expect(new Date(officeHour.startsAt).getUTCHours()).toBe(14)
    expect(officeHour.timeLabel).toMatch(/5:00 PM EAT$/)

    const [one, two, three] = [await createStudent(app), await createStudent(app), await createStudent(app)]
    const listed = (await call('GET', '/api/office-hours', one.cookie)).json().officeHours
    expect(listed[0]).toMatchObject({ id: officeHour.id, spotsLeft: 2, meetingLink: null })

    const joined = await call('POST', `/api/office-hours/${officeHour.id}/join`, one.cookie)
    expect(joined.json().officeHour.meetingLink).toBe('https://meet.example.com/cv') // revealed on joining
    expect((await call('POST', `/api/office-hours/${officeHour.id}/join`, one.cookie)).statusCode).toBe(409)
    expect((await call('POST', `/api/office-hours/${officeHour.id}/join`, two.cookie)).statusCode).toBe(200)
    expect((await call('POST', `/api/office-hours/${officeHour.id}/join`, three.cookie)).statusCode).toBe(409) // full

    const mine = (await call('GET', '/api/office-hours/mine', mentor.cookie)).json().officeHours
    expect(mine[0].attendees.map((a: { userId: string }) => a.userId).sort()).toEqual([one.userId, two.userId].sort())
  })

  it('block the mentor’s one-to-one slots at that time', async () => {
    const { mentor, student } = await mentorship()
    const officeHour = (await host(mentor.cookie, { startsAt: localInDays(2, '10:00'), durationMin: 60 })).json().officeHour

    const slots = (await call('GET', `/api/scheduling/slots/${mentor.mentorProfileId}?days=7`, student.cookie)).json()
      .slots as Array<{ startsAt: string }>
    const start = new Date(officeHour.startsAt).getTime()
    const overlapping = slots.filter((slot) => {
      const at = new Date(slot.startsAt).getTime()
      return at >= start && at < start + 60 * 60_000
    })
    expect(overlapping).toHaveLength(0)

    // And the mentor cannot host a second one on top.
    expect((await host(mentor.cookie, { startsAt: localInDays(2, '10:30') })).statusCode).toBe(409)
  })

  it('are cancelled by their host alone, and attendees are told', async () => {
    const mentor = await createMentor(app)
    const other = await createMentor(app, { name: 'Brian Kimani' })
    const student = await createStudent(app)
    const id = (await host(mentor.cookie)).json().officeHour.id as string
    await call('POST', `/api/office-hours/${id}/join`, student.cookie)

    expect((await call('POST', `/api/office-hours/${id}/cancel`, other.cookie)).statusCode).toBe(404)
    expect((await call('POST', `/api/office-hours/${id}/cancel`, mentor.cookie)).statusCode).toBe(200)

    const inbox = (await call('GET', '/api/notifications', student.cookie)).json().notifications
    expect(inbox[0]).toMatchObject({ type: 'officehour.cancelled' })
    expect((await call('GET', '/api/office-hours', student.cookie)).json().officeHours).toHaveLength(0)
  })

  it('are refused in the past and to non-mentors', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    expect((await host(mentor.cookie, { startsAt: localInDays(-1) })).statusCode).toBe(400)
    expect((await host(student.cookie)).statusCode).toBe(403)
  })
})

describe('opportunities board', () => {
  it('closes applications at the end of the chosen day, East Africa Time', async () => {
    const mentor = await createMentor(app)
    const closesOn = localInDays(10).slice(0, 10)
    const posted = (
      await call('POST', '/api/opportunities', mentor.cookie, { title: 'Analyst', type: 'Full-time', closesOn })
    ).json().opportunity
    // 23:59 in Nairobi is 20:59 UTC.
    expect(posted.closesAt).toBe(`${closesOn}T20:59:00.000Z`)

    const past = await call('POST', '/api/opportunities', mentor.cookie, {
      title: 'Too late',
      type: 'Volunteer',
      closesOn: localInDays(-2).slice(0, 10),
    })
    expect(past.statusCode).toBe(400)
  })

  it('filters by type and text, treating wildcards literally', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    await call('POST', '/api/opportunities', mentor.cookie, { title: 'Data intern', type: 'Internship', location: 'Nairobi' })
    await call('POST', '/api/opportunities', mentor.cookie, { title: 'Backend engineer', type: 'Full-time' })
    await call('POST', '/api/opportunities', mentor.cookie, { title: '100% remote volunteer', type: 'Volunteer' })

    const titles = async (query: string) =>
      ((await call('GET', `/api/opportunities?${query}`, student.cookie)).json().opportunities as Array<{ title: string }>)
        .map((item) => item.title)

    expect(await titles('type=Internship')).toEqual(['Data intern'])
    expect(await titles('q=nairobi')).toEqual(['Data intern'])
    expect(await titles(`q=${encodeURIComponent('%')}`)).toEqual(['100% remote volunteer'])
  })
})

describe('alumni directory', () => {
  it('lists verified alumni to alumni only, with class year, and never emails', async () => {
    const viewer = await createMentor(app, { name: 'Grace Wanjiru' })
    const mentor = await createMentor(app, { name: 'Amina Osei', company: 'Safaricom' })
    const pending = await signupAndAuth(app, {
      email: `pending-${Date.now()}@strathmore.edu`,
      password: 'long-enough-pass',
      role: 'alumni',
      name: 'Pending Person',
      verified: false,
    })
    const student = await createStudent(app)
    const admin = await createAdmin(app)

    const response = await call('GET', '/api/alumni', viewer.cookie)
    const names = response.json().alumni.map((entry: { name: string }) => entry.name)
    expect(names).toContain('Amina Osei')
    expect(names).not.toContain('Pending Person') // not verified
    expect(names).not.toContain('Grace Wanjiru') // not yourself
    expect(response.body).not.toContain('@strathmore.edu')

    const amina = response.json().alumni.find((entry: { userId: string }) => entry.userId === mentor.userId)
    expect(amina).toMatchObject({ classYear: '2016', company: 'Safaricom', mentorProfileId: mentor.mentorProfileId })

    expect((await call('GET', '/api/alumni?q=safari', viewer.cookie)).json().alumni).toHaveLength(1)
    expect((await call('GET', '/api/alumni', student.cookie)).statusCode).toBe(403)
    expect((await call('GET', '/api/alumni', admin.cookie)).statusCode).toBe(403)
    expect(pending.userId).toBeTruthy()
  })
})

describe('match explanations, continued', () => {
  it('does not repeat the track as a shared skill', () => {
    const reasons = explainMatch(
      { targetTrack: 'Software Engineering', major: '', interests: ['Software Engineering'], hobbies: [], country: null, stateProvince: null },
      { tracks: ['Software Engineering'], skills: ['Software Engineering'], major: '', hobbies: [], country: null, stateProvince: null },
    )
    expect(reasons).toEqual(['Mentors in Software Engineering'])
  })
})
