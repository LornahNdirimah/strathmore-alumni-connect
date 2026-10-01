/**
 * Notifications, session reminders, calendar files and live updates
 * (DESIGN_BACKLOG #26, #39, #40, #56).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { execute } from '../src/db/repository.js'
import { buildCalendar } from '../src/lib/ics.js'
import { runLifecycleSweep } from '../src/modules/mentorship/mentorship.service.js'
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

type Notification = { id: string; type: string; title: string; body: string | null; link: string | null; read: boolean }

async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, cookie: string, payload?: object) {
  return app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) })
}

async function inbox(cookie: string): Promise<{ notifications: Notification[]; unreadCount: number }> {
  return (await call('GET', '/api/notifications', cookie)).json()
}

const WIDE_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, startTime: '00:00', endTime: '23:30' }))

/** An accepted mentorship with bookable availability. */
async function mentorship() {
  const mentor = await createMentor(app)
  const student = await createStudent(app)
  await call('PUT', '/api/scheduling/availability/me', mentor.cookie, { windows: WIDE_WEEK, timezoneLabel: 'UTC' })
  const requestId = await sendRequest(app, student, mentor.mentorProfileId)
  await call('PATCH', `/api/mentorship/requests/${requestId}`, mentor.cookie, { status: 'accepted' })
  const relationshipId = (await call('GET', '/api/mentorship/relationships', student.cookie)).json()
    .relationships[0].id as string
  const slots = (await call('GET', `/api/scheduling/slots/${mentor.mentorProfileId}?days=7`, student.cookie)).json()
    .slots as Array<{ startsAt: string }>
  return { mentor, student, relationshipId, slots }
}

describe('notifications for mentorship', () => {
  it('tells the mentor about a request, and the student about the answer', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)

    const mentorInbox = await inbox(mentor.cookie)
    expect(mentorInbox.unreadCount).toBe(1)
    expect(mentorInbox.notifications[0]).toMatchObject({
      type: 'request.received',
      link: '/alumni/my-mentees',
      read: false,
    })

    await call('PATCH', `/api/mentorship/requests/${requestId}`, mentor.cookie, { status: 'accepted' })
    expect((await inbox(student.cookie)).notifications[0]).toMatchObject({
      type: 'request.accepted',
      link: '/student/my-mentors',
    })
  })

  it('tells the other side — not the actor — about bookings and cancellations', async () => {
    const { mentor, student, relationshipId, slots } = await mentorship()
    const before = (await inbox(mentor.cookie)).notifications.length

    const booked = await call('POST', '/api/scheduling/sessions', student.cookie, {
      relationshipId,
      title: 'CV review',
      scheduledAt: slots[0]!.startsAt,
    })
    const sessionId = booked.json().session.id as string

    const mentorView = await inbox(mentor.cookie)
    expect(mentorView.notifications.length).toBe(before + 1)
    expect(mentorView.notifications[0]).toMatchObject({ type: 'session.booked', link: '/alumni/availability' })
    expect((await inbox(student.cookie)).notifications.some((n) => n.type === 'session.booked')).toBe(false)

    await call('PATCH', `/api/scheduling/sessions/${sessionId}`, mentor.cookie, {
      status: 'cancelled',
      cancelledReason: 'Travelling',
    })
    const studentView = await inbox(student.cookie)
    expect(studentView.notifications[0]).toMatchObject({ type: 'session.cancelled', link: '/student/my-sessions' })
    expect(studentView.notifications[0]!.body).toContain('Travelling')
  })
})

describe('messages', () => {
  it('collapse into one unread notification per conversation, cleared by reading the thread', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    await sendRequest(app, student, mentor.mentorProfileId)
    const conversationId = (await call('POST', '/api/conversations', student.cookie, { participantUserId: mentor.userId }))
      .json().conversationId as string

    for (const text of ['Hello!', 'Are you free Thursday?', 'Thanks']) {
      await call('POST', `/api/conversations/${conversationId}/messages`, student.cookie, { text })
    }

    const messages = (await inbox(mentor.cookie)).notifications.filter((n) => n.type === 'message.received')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ body: 'Thanks', link: `/messages?c=${conversationId}`, read: false })

    await call('POST', `/api/conversations/${conversationId}/read`, mentor.cookie)
    const after = (await inbox(mentor.cookie)).notifications.filter((n) => n.type === 'message.received')
    expect(after[0]!.read).toBe(true)
  })
})

describe('reading notifications', () => {
  it('marks one or all read, and only the owner’s', async () => {
    const mentor = await createMentor(app)
    const other = await createMentor(app, { name: 'Brian Kimani' })
    for (let index = 0; index < 2; index += 1) {
      await sendRequest(app, await createStudent(app), mentor.mentorProfileId)
    }
    const [first] = (await inbox(mentor.cookie)).notifications

    expect((await call('POST', `/api/notifications/${first!.id}/read`, other.cookie)).statusCode).toBe(404)
    expect((await call('POST', `/api/notifications/${first!.id}/read`, mentor.cookie)).statusCode).toBe(200)
    expect((await inbox(mentor.cookie)).unreadCount).toBe(1)

    await call('POST', '/api/notifications/read-all', mentor.cookie)
    expect((await inbox(mentor.cookie)).unreadCount).toBe(0)
  })
})

describe('announcements and verification', () => {
  it('reach exactly the announced audience', async () => {
    const admin = await createAdmin(app)
    const student = await createStudent(app)
    const mentor = await createMentor(app)

    await call('POST', '/api/admin/announcements', admin.cookie, {
      title: 'Exam week',
      audience: 'students',
      body: 'Sessions are paused this week.',
    })

    expect((await inbox(student.cookie)).notifications[0]).toMatchObject({ type: 'announcement', title: 'Exam week', link: '/student' })
    expect((await inbox(mentor.cookie)).notifications.some((n) => n.type === 'announcement')).toBe(false)
  })

  it('tells an alumnus when they are verified', async () => {
    const admin = await createAdmin(app)
    const alumnus = await signupAndAuth(app, {
      email: `pending-${Date.now()}@strathmore.edu`,
      password: 'long-enough-pass',
      role: 'alumni',
      verified: false,
    })
    const queue = (await call('GET', '/api/admin/verifications', admin.cookie)).json().verifications as Array<{
      id: string
      user_id: string
    }>
    const entry = queue.find((item) => item.user_id === alumnus.userId)!

    await call('PATCH', `/api/admin/verifications/${entry.id}`, admin.cookie, { status: 'approved' })
    expect((await inbox(alumnus.cookie)).notifications[0]).toMatchObject({ type: 'verification.approved', link: '/alumni' })
  })
})

describe('session reminders', () => {
  it('remind both sides of a session in the next day, once', async () => {
    const { mentor, student, relationshipId, slots } = await mentorship()
    const soon = slots.find((slot) => new Date(slot.startsAt).getTime() - Date.now() < 20 * 3_600_000)!
    await call('POST', '/api/scheduling/sessions', student.cookie, { relationshipId, title: 'Mock interview', scheduledAt: soon.startsAt })

    expect(runLifecycleSweep(getDatabase()).remindersSent).toBe(1)
    expect(runLifecycleSweep(getDatabase()).remindersSent).toBe(0)

    for (const cookie of [mentor.cookie, student.cookie]) {
      const reminders = (await inbox(cookie)).notifications.filter((n) => n.type === 'session.reminder')
      expect(reminders).toHaveLength(1)
    }
  })

  it('reminds again after a session is moved', async () => {
    const { student, relationshipId, slots } = await mentorship()
    const soon = slots.filter((slot) => new Date(slot.startsAt).getTime() - Date.now() < 20 * 3_600_000)
    const booked = await call('POST', '/api/scheduling/sessions', student.cookie, {
      relationshipId,
      title: 'Portfolio',
      scheduledAt: soon[0]!.startsAt,
    })
    runLifecycleSweep(getDatabase())

    await call('PATCH', `/api/scheduling/sessions/${booked.json().session.id}`, student.cookie, {
      scheduledAt: soon[2]!.startsAt,
    })
    expect(runLifecycleSweep(getDatabase()).remindersSent).toBe(1)
  })
})

describe('meeting links and calendar files', () => {
  it('stores an https meeting link and refuses anything else', async () => {
    const { student, relationshipId, slots } = await mentorship()

    const bad = await call('POST', '/api/scheduling/sessions', student.cookie, {
      relationshipId,
      title: 'Call',
      scheduledAt: slots[0]!.startsAt,
      meetingLink: 'javascript:alert(1)',
    })
    expect(bad.statusCode).toBe(400)

    const good = await call('POST', '/api/scheduling/sessions', student.cookie, {
      relationshipId,
      title: 'Call',
      scheduledAt: slots[0]!.startsAt,
      meetingLink: 'https://meet.example.com/abc-defg',
    })
    expect(good.json().session.meetingLink).toBe('https://meet.example.com/abc-defg')
  })

  it('exports a session as an .ics file for its participants only', async () => {
    const { mentor, student, relationshipId, slots } = await mentorship()
    const outsider = await createStudent(app)
    const session = (
      await call('POST', '/api/scheduling/sessions', student.cookie, {
        relationshipId,
        title: 'Salary; negotiation, practice',
        scheduledAt: slots[0]!.startsAt,
        meetingLink: 'https://meet.example.com/xyz',
      })
    ).json().session

    const file = await call('GET', session.calendarUrl, mentor.cookie)
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toContain('text/calendar')
    expect(file.headers['content-disposition']).toMatch(/attachment; filename=".+\.ics"/)
    expect(file.body).toContain(`DTSTART:${slots[0]!.startsAt.replace(/[-:]/g, '').replace('.000', '')}`)
    // The mentor's copy names the student; text is escaped per RFC 5545.
    expect(file.body).toContain('SUMMARY:Salary\\; negotiation\\, practice with Kevin Otieno')
    expect(file.body).toContain('URL:https://meet.example.com/xyz')

    expect((await call('GET', session.calendarUrl, outsider.cookie)).statusCode).toBe(403)
  })

  it('folds long lines at 75 octets without splitting characters', () => {
    const body = buildCalendar({
      uid: 'x',
      start: '2026-10-15T15:00:00.000Z',
      end: '2026-10-15T16:00:00.000Z',
      summary: 'Mentorship with Wanjirũ '.repeat(8),
    })
    for (const line of body.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    }
    // Unfolding restores the text exactly.
    const unfolded = body.replace(/\r\n /g, '')
    expect(unfolded).toContain(`SUMMARY:${'Mentorship with Wanjirũ '.repeat(8)}`)
  })
})

describe('live updates', () => {
  it('streams a hint when a message arrives', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    await sendRequest(app, student, mentor.mentorProfileId)
    const conversationId = (await call('POST', '/api/conversations', student.cookie, { participantUserId: mentor.userId }))
      .json().conversationId as string

    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const controller = new AbortController()
    const response = await fetch(`${address}/api/notifications/stream`, {
      headers: { cookie: mentor.cookie },
      signal: controller.signal,
    })
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let received = ''
    const waitFor = async (needle: string) => {
      const deadline = Date.now() + 5000
      while (!received.includes(needle)) {
        if (Date.now() > deadline) throw new Error(`no "${needle}" in: ${received}`)
        const { value, done } = await reader.read()
        if (done) break
        received += decoder.decode(value)
      }
    }

    await waitFor('event: notifications')
    await call('POST', `/api/conversations/${conversationId}/messages`, student.cookie, { text: 'Hi!' })
    await waitFor(`"conversationId":"${conversationId}"`)
    expect(received).toContain('event: message')

    controller.abort()
  })
})
