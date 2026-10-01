/**
 * Trust and privacy (ROADMAP Phase 7): consent, "download my data", account
 * deletion, blocking, reports and the bulk alumni import (DESIGN_BACKLOG #42,
 * #44, #46).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { execute, queryOne } from '../src/db/repository.js'
import { parseCsv } from '../src/lib/csv.js'
import { sentEmails } from '../src/lib/mailer.js'
import { createAdmin, createMentor, createStudent, sendRequest } from './helpers/fixtures.js'
import { createTestApp, extractAuthCookie, resetTables, type TestContext } from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  resetTables()
  sentEmails.length = 0
})

const flush = () => new Promise((settle) => setImmediate(settle))

async function call(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, cookie: string | undefined, payload?: object) {
  return app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload ? { payload } : {}) })
}

describe('consent', () => {
  it('is required to sign up', async () => {
    const response = await call('POST', '/api/auth/signup', undefined, {
      name: 'Ada Lovelace',
      email: `ada-${Date.now()}@strathmore.edu`,
      password: 'correct-horse-battery',
      role: 'student',
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().error.details.map((d: { field: string }) => d.field)).toContain('acceptTerms')
  })

  it('must be renewed when the terms change, before anything but the account routes works', async () => {
    const student = await createStudent(app)
    execute(getDatabase(), "UPDATE users SET terms_version = '2025-01-01' WHERE id = ?", [student.userId])

    expect((await call('GET', '/api/auth/me', student.cookie)).json().user.termsAccepted).toBe(false)
    expect((await call('GET', '/api/events', student.cookie)).statusCode).toBe(403)
    // Leaving or taking your data never waits on accepting new terms.
    expect((await call('GET', '/api/account/export', student.cookie)).statusCode).toBe(200)

    await call('POST', '/api/account/accept-terms', student.cookie)
    expect((await call('GET', '/api/events', student.cookie)).statusCode).toBe(200)
  })
})

describe('download my data', () => {
  it('includes the person’s records and never credentials', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    await sendRequest(app, student, mentor.mentorProfileId)
    const conversationId = (await call('POST', '/api/conversations', student.cookie, { participantUserId: mentor.userId }))
      .json().conversationId as string
    await call('POST', `/api/conversations/${conversationId}/messages`, student.cookie, { text: 'Hello from me' })

    const response = await call('GET', '/api/account/export', student.cookie)
    expect(response.headers['content-disposition']).toMatch(/attachment; filename="alumni-connect-data-/)
    const data = response.json()
    expect(data.account.id).toBe(student.userId)
    expect(data.careerGoals.target_track).toBe('Data Science')
    expect(data.mentorshipRequests).toHaveLength(1)
    expect(data.conversations[0].messages[0]).toMatchObject({ from: 'me', text: 'Hello from me' })
    expect(response.body).not.toMatch(/password_hash|password_salt|student-password-123/)
  })
})

describe('deleting an account', () => {
  it('needs the password and an explicit confirmation', async () => {
    const student = await createStudent(app)
    expect((await call('POST', '/api/account/delete', student.cookie, { password: 'wrong-password', confirm: true })).statusCode).toBe(401)
    expect((await call('POST', '/api/account/delete', student.cookie, { password: 'student-password-123' })).statusCode).toBe(400)
  })

  it('anonymises the person but keeps what others depend on', async () => {
    const mentor = await createMentor(app, { capacity: 1 })
    const student = await createStudent(app)
    const requestId = await sendRequest(app, student, mentor.mentorProfileId)
    await call('PATCH', `/api/mentorship/requests/${requestId}`, mentor.cookie, { status: 'accepted' })
    const conversationId = (await call('POST', '/api/conversations', student.cookie, { participantUserId: mentor.userId }))
      .json().conversationId as string
    await call('POST', `/api/conversations/${conversationId}/messages`, student.cookie, { text: 'My phone is 0712 345678' })
    const email = (await call('GET', '/api/auth/me', student.cookie)).json().user.email as string

    const deleted = await call('POST', '/api/account/delete', student.cookie, { password: 'student-password-123', confirm: true })
    expect(deleted.statusCode).toBe(200)

    // Gone as a person: no session, no sign-in, no personal data.
    expect((await call('GET', '/api/auth/me', student.cookie)).statusCode).toBe(401)
    expect((await call('POST', '/api/auth/login', undefined, { email, password: 'student-password-123' })).statusCode).toBe(401)
    expect(queryOne(getDatabase(), 'SELECT id FROM mentorship_seekers WHERE user_id = ?', [student.userId])).toBeNull()

    // The mentor keeps the history, with a freed seat and the words removed.
    const relationship = (await call('GET', '/api/mentorship/relationships', mentor.cookie)).json().relationships[0]
    expect(relationship).toMatchObject({ studentName: 'Former member', status: 'completed' })
    expect((await call('GET', `/api/mentors/${mentor.mentorProfileId}`, mentor.cookie)).json().mentor.remainingCapacity).toBe(1)
    const messages = (await call('GET', `/api/conversations/${conversationId}/messages`, mentor.cookie)).json().messages
    expect(messages[0].text).toBe('Message removed')
    const inbox = (await call('GET', '/api/notifications', mentor.cookie)).json().notifications
    expect(inbox[0].title).toMatch(/closed their account/)

    // The address is free to be used again.
    const again = await call('POST', '/api/auth/signup', undefined, {
      name: 'New Person',
      email,
      password: 'another-good-password',
      role: 'student',
      acceptTerms: true,
    })
    expect(again.statusCode).toBe(201)
  })

  it('tells students waiting on a mentor who leaves, and removes the mentor from search', async () => {
    const mentor = await createMentor(app, { name: 'Leaving Mentor' })
    const student = await createStudent(app)
    await sendRequest(app, student, mentor.mentorProfileId)

    await call('POST', '/api/account/delete', mentor.cookie, { password: 'mentor-password-123', confirm: true })

    const request = (await call('GET', '/api/mentorship/requests', student.cookie)).json().requests[0]
    expect(request.status).toBe('declined')
    const search = (await call('GET', '/api/mentors?limit=50', student.cookie)).json().items
    expect(search.map((item: { id: string }) => item.id)).not.toContain(mentor.mentorProfileId)
  })

  it('refuses to remove the last administrator', async () => {
    const admin = await createAdmin(app)
    const response = await call('POST', '/api/account/delete', admin.cookie, { password: 'admin-password-123', confirm: true })
    expect(response.statusCode).toBe(409)
  })
})

describe('blocking', () => {
  it('stops messages and requests in both directions, until unblocked', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    await sendRequest(app, student, mentor.mentorProfileId)
    const conversationId = (await call('POST', '/api/conversations', student.cookie, { participantUserId: mentor.userId }))
      .json().conversationId as string

    await call('POST', '/api/blocks', mentor.cookie, { userId: student.userId })

    const fromStudent = await call('POST', `/api/conversations/${conversationId}/messages`, student.cookie, { text: 'Hi?' })
    const fromMentor = await call('POST', `/api/conversations/${conversationId}/messages`, mentor.cookie, { text: 'Hi' })
    expect(fromStudent.statusCode).toBe(403)
    expect(fromMentor.statusCode).toBe(403)
    expect(fromStudent.json().error.message).toBe('You cannot message this account.')

    const other = await createMentor(app, { name: 'Other Mentor' })
    await call('POST', '/api/blocks', student.cookie, { userId: other.userId })
    const request = await app.inject({
      method: 'POST',
      url: '/api/mentorship/requests',
      headers: { cookie: student.cookie },
      payload: {
        mentorProfileId: other.mentorProfileId,
        interest: 'Careers',
        preferredSlot: 'Any time',
        message: 'I would value your guidance on careers.',
      },
    })
    expect(request.statusCode).toBe(409)

    await call('DELETE', `/api/blocks/${student.userId}`, mentor.cookie)
    expect((await call('POST', `/api/conversations/${conversationId}/messages`, student.cookie, { text: 'Hello again' })).statusCode).toBe(201)
  })
})

describe('reports', () => {
  it('reach the admin queue with the message itself, and the reporter hears the outcome', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    const admin = await createAdmin(app)
    await sendRequest(app, student, mentor.mentorProfileId)
    const conversationId = (await call('POST', '/api/conversations', student.cookie, { participantUserId: mentor.userId }))
      .json().conversationId as string
    await call('POST', `/api/conversations/${conversationId}/messages`, mentor.cookie, { text: 'Something rude' })
    const messageId = (await call('GET', `/api/conversations/${conversationId}/messages`, student.cookie)).json().messages[0].id

    const report = { userId: mentor.userId, contextType: 'message', contextId: messageId, reason: 'harassment', details: 'Unprompted.' }
    expect((await call('POST', '/api/reports', student.cookie, report)).statusCode).toBe(201)
    expect((await call('POST', '/api/reports', student.cookie, report)).statusCode).toBe(409)
    expect((await call('GET', '/api/admin/reports', student.cookie)).statusCode).toBe(403)

    const queue = (await call('GET', '/api/admin/reports', admin.cookie)).json().reports
    expect(queue[0]).toMatchObject({ reason: 'harassment', excerpt: 'Something rude', status: 'open' })
    expect(queue[0].reported.totalReports).toBe(1)

    await call('PATCH', `/api/admin/reports/${queue[0].id}`, admin.cookie, { status: 'actioned', note: 'Warned the mentor.' })
    const inbox = (await call('GET', '/api/notifications', student.cookie)).json().notifications
    expect(inbox[0]).toMatchObject({ type: 'report.reviewed' })
    expect(inbox[0].body).not.toContain('Warned')
    const log = (await call('GET', '/api/admin/audit', admin.cookie)).json().entries
    expect(log[0]).toMatchObject({ action: 'report.reviewed' })
  })
})

describe('bulk alumni import', () => {
  const CSV = [
    'Full Name,Email Address,Class Year,Programme',
    'Grace Wanjiru,grace.w@example.com,2015,BCom',
    '"Otieno, Brian",BRIAN.O@example.com,2012,"BSc Informatics, Honours"',
    'Bad Year,bad@example.com,twenty,BCom',
    'Grace Again,grace.w@example.com,2016,LLB',
  ].join('\r\n')

  it('previews without writing anything', async () => {
    const admin = await createAdmin(app)
    const preview = (await call('POST', '/api/admin/alumni/import', admin.cookie, { csv: CSV, dryRun: true })).json()

    expect(preview.summary).toEqual({ ready: 2, created: 0, duplicate: 1, invalid: 1 })
    expect(preview.rows[1]).toMatchObject({ name: 'Otieno, Brian', email: 'brian.o@example.com', status: 'ready' })
    expect(queryOne(getDatabase(), "SELECT id FROM users WHERE email = 'grace.w@example.com'")).toBeNull()
  })

  it('creates verified accounts and invites each person to set a password', async () => {
    const admin = await createAdmin(app)
    const result = (await call('POST', '/api/admin/alumni/import', admin.cookie, { csv: CSV, dryRun: false })).json()
    await flush()
    expect(result.summary.created).toBe(2)

    const invite = sentEmails.find((message) => message.to === 'grace.w@example.com')!
    expect(invite.subject).toMatch(/invited/i)
    const token = /reset-password\?token=([A-Za-z0-9_-]+)&invite=1/.exec(invite.text)![1]!

    await call('POST', '/api/auth/reset-password', undefined, { token, password: 'graces-own-password' })
    const login = await call('POST', '/api/auth/login', undefined, { email: 'grace.w@example.com', password: 'graces-own-password' })
    expect(login.statusCode).toBe(200)
    expect(login.json().user).toMatchObject({ role: 'alumni', status: 'active', emailVerified: true, termsAccepted: false })

    // They accept the terms at first sign-in, then are full members.
    const cookie = extractAuthCookie(login.headers as Record<string, unknown>)
    await call('POST', '/api/account/accept-terms', cookie)
    expect((await call('GET', '/api/alumni', cookie)).statusCode).toBe(200)
  })

  it('refuses a file without the needed columns, and non-admins', async () => {
    const admin = await createAdmin(app)
    const student = await createStudent(app)
    expect((await call('POST', '/api/admin/alumni/import', admin.cookie, { csv: 'name,email\nA B,a@b.co', dryRun: true })).statusCode).toBe(400)
    expect((await call('POST', '/api/admin/alumni/import', student.cookie, { csv: CSV, dryRun: true })).statusCode).toBe(403)
  })

  it('reads the CSV that spreadsheets actually produce', () => {
    const text = '﻿name,note\r\n"Wanjiru, Grace","said ""hi""\nthen left"\r\n\r\nplain,value'
    expect(parseCsv(text)).toEqual([
      ['name', 'note'],
      ['Wanjiru, Grace', 'said "hi"\nthen left'],
      ['plain', 'value'],
    ])
  })
})
