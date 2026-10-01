/**
 * Messaging: participant isolation and read state.
 *
 * The mock stored `from: 'me' | 'them'` on each message, which only made sense
 * from one viewer's perspective and made mark-as-read impossible. These tests
 * pin the replacement: authorship is derived per viewer from sender_user_id,
 * and unread counts actually clear.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

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

async function openConversation(cookie: string, participantUserId: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/conversations',
    headers: { cookie },
    payload: { participantUserId },
  })

  if (response.statusCode !== 201) {
    throw new Error(`Opening a conversation failed (${response.statusCode}): ${response.body}`)
  }

  return response.json().conversationId as string
}

/**
 * A mentor and a student who has asked them for mentorship — the least a pair
 * needs before either may open a thread (ROADMAP decision D2).
 */
async function linkedPair() {
  const mentor = await createMentor(app)
  const student = await createStudent(app)
  await sendRequest(app, student, mentor.mentorProfileId)
  return { mentor, student }
}

async function send(cookie: string, conversationId: string, text: string): Promise<void> {
  const response = await app.inject({
    method: 'POST',
    url: `/api/conversations/${conversationId}/messages`,
    headers: { cookie },
    payload: { text },
  })

  if (response.statusCode !== 201) {
    throw new Error(`Sending failed (${response.statusCode}): ${response.body}`)
  }
}

describe('conversations', () => {
  it('is idempotent — reopening returns the same thread', async () => {
    const { mentor, student } = await linkedPair()

    const first = await openConversation(student.cookie, mentor.userId)
    const second = await openConversation(student.cookie, mentor.userId)
    // And from the other side, which must not fork a parallel thread.
    const third = await openConversation(mentor.cookie, student.userId)

    expect(second).toBe(first)
    expect(third).toBe(first)

    const listing = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { cookie: student.cookie },
    })
    expect(listing.json().conversations).toHaveLength(1)
  })

  it('renders authorship from each viewer’s own perspective', async () => {
    const { mentor, student } = await linkedPair()
    const conversationId = await openConversation(student.cookie, mentor.userId)

    await send(student.cookie, conversationId, 'Hello, could we talk about internships?')
    await send(mentor.cookie, conversationId, 'Of course — how does Thursday look?')

    const asStudent = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: student.cookie },
    })
    const asMentor = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: mentor.cookie },
    })

    // The same two rows, mirrored — not a stored per-message flag.
    expect(asStudent.json().messages.map((m: { from: string }) => m.from)).toEqual(['me', 'them'])
    expect(asMentor.json().messages.map((m: { from: string }) => m.from)).toEqual(['them', 'me'])
  })
})

describe('participant isolation', () => {
  it('refuses to show a thread to someone who is not in it', async () => {
    const { mentor, student } = await linkedPair()
    const outsider = await createMentor(app, { name: 'Brian Kimani' })

    const conversationId = await openConversation(student.cookie, mentor.userId)
    await send(student.cookie, conversationId, 'Private question about salary negotiation.')

    const read = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: outsider.cookie },
    })
    expect([403, 404]).toContain(read.statusCode)

    const write = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: outsider.cookie },
      payload: { text: 'Injecting myself into your conversation.' },
    })
    expect([403, 404]).toContain(write.statusCode)
  })

  it('requires authentication', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/conversations' })
    expect(response.statusCode).toBe(401)
  })
})

describe('unread state', () => {
  it('counts a message sent immediately after the thread was opened', async () => {
    // Regression: the conversation's creator used to be stamped as having read
    // up to the moment of creation, and unread is a strict `>` comparison — so a
    // message sent in that same millisecond was silently counted as read. This
    // failed intermittently, which is exactly how it survived unnoticed.
    const { mentor, student } = await linkedPair()
    const conversationId = await openConversation(student.cookie, mentor.userId)

    await send(mentor.cookie, conversationId, 'Replying the instant the thread exists.')

    const listing = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { cookie: student.cookie },
    })

    expect(listing.json().conversations[0].unreadCount).toBe(1)
  })

  it('leaves a thread with no messages at zero unread', async () => {
    const { mentor, student } = await linkedPair()
    const conversationId = await openConversation(student.cookie, mentor.userId)

    const markRead = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/read`,
      headers: { cookie: student.cookie },
    })
    expect(markRead.statusCode).toBe(200)

    const listing = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { cookie: student.cookie },
    })
    expect(listing.json().conversations[0].unreadCount).toBe(0)
  })

  it('counts the other side’s messages and clears them on read', async () => {
    const { mentor, student } = await linkedPair()
    const conversationId = await openConversation(student.cookie, mentor.userId)

    await send(mentor.cookie, conversationId, 'Sharing a role that suits your profile.')
    await send(mentor.cookie, conversationId, 'Deadline is Friday.')

    const before = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { cookie: student.cookie },
    })
    expect(before.json().conversations[0].unreadCount).toBe(2)

    // The sender never has unread messages of their own.
    const senderView = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { cookie: mentor.cookie },
    })
    expect(senderView.json().conversations[0].unreadCount).toBe(0)

    const markRead = await app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/read`,
      headers: { cookie: student.cookie },
    })
    expect(markRead.statusCode).toBe(200)

    const after = await app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { cookie: student.cookie },
    })
    expect(after.json().conversations[0].unreadCount).toBe(0)
  })
})

describe('message validation', () => {
  it('rejects an empty or whitespace-only message', async () => {
    const { mentor, student } = await linkedPair()
    const conversationId = await openConversation(student.cookie, mentor.userId)

    for (const text of ['', '   ']) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/conversations/${conversationId}/messages`,
        headers: { cookie: student.cookie },
        payload: { text },
      })
      expect(response.statusCode).toBe(400)
    }
  })

  it('stores markup as literal text rather than interpreting it', async () => {
    const { mentor, student } = await linkedPair()
    const conversationId = await openConversation(student.cookie, mentor.userId)

    const payload = '<script>alert(1)</script>'
    await send(student.cookie, conversationId, payload)

    const messages = await app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: mentor.cookie },
    })

    // Round-tripped verbatim: escaping is React's job at render time, and
    // mangling it here would corrupt legitimate content.
    expect(messages.json().messages[0].text).toBe(payload)
  })
})

describe('who may message whom', () => {
  async function tryOpen(cookie: string, participantUserId: string) {
    return app.inject({
      method: 'POST',
      url: '/api/conversations',
      headers: { cookie },
      payload: { participantUserId },
    })
  }

  it('lets a student message a mentor they have requested, and the mentor reply-first', async () => {
    const { mentor, student } = await linkedPair()

    expect((await tryOpen(mentor.cookie, student.userId)).statusCode).toBe(201)
  })

  it('refuses a student messaging a mentor they have no link with', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)

    const response = await tryOpen(student.cookie, mentor.userId)
    expect(response.statusCode).toBe(403)
    expect(response.json().error.message).toMatch(/sent them a request/i)
  })

  it('refuses student-to-student messages', async () => {
    const one = await createStudent(app)
    const two = await createStudent(app)

    expect((await tryOpen(one.cookie, two.userId)).statusCode).toBe(403)
  })

  it('lets alumni message each other without a mentorship', async () => {
    const one = await createMentor(app)
    const two = await createMentor(app, { name: 'Brian Kimani' })

    expect((await tryOpen(one.cookie, two.userId)).statusCode).toBe(201)
  })

  it('gives admins no messaging, and nobody can message an admin', async () => {
    const admin = await createAdmin(app)
    const mentor = await createMentor(app)

    expect((await tryOpen(admin.cookie, mentor.userId)).statusCode).toBe(403)
    expect((await tryOpen(mentor.cookie, admin.userId)).statusCode).toBe(403)
    const list = await app.inject({ method: 'GET', url: '/api/conversations', headers: { cookie: admin.cookie } })
    expect(list.statusCode).toBe(403)
  })
})
