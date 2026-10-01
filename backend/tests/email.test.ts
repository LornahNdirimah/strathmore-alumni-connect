/**
 * Email verification and password reset (DESIGN_BACKLOG #43). Messages are
 * read from the in-memory transport, which tests always use.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { getDatabase } from '../src/db/connection.js'
import { execute, queryAll } from '../src/db/repository.js'
import { sentEmails } from '../src/lib/mailer.js'
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

let counter = 0
const email = () => `ada-${++counter}-${Date.now()}@strathmore.edu`

/** Emails are sent on the next tick, after the request's work commits. */
const flush = () => new Promise((settle) => setImmediate(settle))

async function signup(address = email()) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { name: 'Ada Lovelace', email: address, password: 'correct-horse-battery', role: 'student', acceptTerms: true },
  })
  await flush()
  return { address, cookie: extractAuthCookie(response.headers as Record<string, unknown>) }
}

function tokenFrom(message: { text: string }, path: string): string {
  const match = new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(message.text)
  if (!match) throw new Error(`no ${path} link in: ${message.text}`)
  return match[1]!
}

async function me(cookie: string) {
  return (await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).json().user
}

describe('email verification', () => {
  it('sends a link on signup, and following it confirms the address once', async () => {
    const { address, cookie } = await signup()

    expect(sentEmails).toHaveLength(1)
    expect(sentEmails[0]).toMatchObject({ to: address, subject: expect.stringMatching(/confirm your email/i) })
    expect(sentEmails[0]!.text).toContain('http://localhost:5173/verify-email?token=')
    expect((await me(cookie)).emailVerified).toBe(false)

    const token = tokenFrom(sentEmails[0]!, '/verify-email')
    const verify = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token } })
    expect(verify.statusCode).toBe(200)
    expect((await me(cookie)).emailVerified).toBe(true)

    const again = await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token } })
    expect(again.statusCode).toBe(400)
  })

  it('resending voids the earlier link, and is refused once confirmed', async () => {
    const { cookie } = await signup()
    const first = tokenFrom(sentEmails[0]!, '/verify-email')

    await app.inject({ method: 'POST', url: '/api/auth/resend-verification', headers: { cookie } })
    await flush()
    const second = tokenFrom(sentEmails[1]!, '/verify-email')

    expect((await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: first } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token: second } })).statusCode).toBe(200)
    const once = await app.inject({ method: 'POST', url: '/api/auth/resend-verification', headers: { cookie } })
    expect(once.statusCode).toBe(409)
  })

  it('stores only a hash of each token', async () => {
    await signup()
    const token = tokenFrom(sentEmails[0]!, '/verify-email')
    const stored = queryAll<{ token_hash: string }>(getDatabase(), 'SELECT token_hash FROM email_tokens')
    expect(stored.every((row) => row.token_hash !== token && /^[0-9a-f]{64}$/.test(row.token_hash))).toBe(true)
  })
})

describe('password reset', () => {
  it('answers the same for known and unknown addresses, emailing only the real one', async () => {
    const { address } = await signup()
    sentEmails.length = 0

    const known = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: address } })
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'nobody@strathmore.edu' },
    })
    await flush()

    expect(known.statusCode).toBe(200)
    expect(unknown.statusCode).toBe(200)
    expect(known.json().message).toBe(unknown.json().message)
    expect(sentEmails.map((message) => message.to)).toEqual([address])
  })

  it('sets a new password once, signs out every session, and confirms the address', async () => {
    const { address, cookie } = await signup()
    await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: address } })
    await flush()
    const token = tokenFrom(sentEmails.at(-1)!, '/reset-password')

    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'a-brand-new-password' },
    })
    expect(reset.statusCode).toBe(200)

    // The session from before the reset no longer works.
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).statusCode).toBe(401)

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: address, password: 'a-brand-new-password' },
    })
    expect(login.statusCode).toBe(200)
    expect(login.json().user.emailVerified).toBe(true)

    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'yet-another-password' },
    })
    expect(reuse.statusCode).toBe(400)
  })

  it('refuses an expired link and a short password', async () => {
    const { address } = await signup()
    await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: address } })
    await flush()
    const token = tokenFrom(sentEmails.at(-1)!, '/reset-password')

    const short = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, password: 'short' } })
    expect(short.statusCode).toBe(400)

    execute(getDatabase(), 'UPDATE email_tokens SET expires_at = ?', [new Date(Date.now() - 1000).toISOString()])
    const expired = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, password: 'a-brand-new-password' },
    })
    expect(expired.statusCode).toBe(400)
  })

  it('sends nothing for a suspended account', async () => {
    const { address } = await signup()
    execute(getDatabase(), "UPDATE users SET status = 'suspended' WHERE email = ?", [address])
    sentEmails.length = 0

    await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { email: address } })
    await flush()
    expect(sentEmails).toHaveLength(0)
  })
})
