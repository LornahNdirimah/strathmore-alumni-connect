import { afterAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { getDatabase } from '../src/db/connection.js'
import { runMigrations } from '../src/db/migrate.js'
import { createMentor, createStudent } from './helpers/fixtures.js'
import { createTestApp, resetTables, type TestContext } from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

afterAll(async () => {
  await ctx.close()
})

describe('rate limiting', () => {
  it('throttles repeated login attempts', async () => {
    runMigrations(getDatabase())
    // Built with the real limit so the protection itself is under test, rather
    // than the relaxed value the rest of the suite runs with.
    const strictApp = await buildApp({ quiet: true, authRateLimit: { max: 5, timeWindow: '1 minute' } })
    await strictApp.ready()

    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        strictApp.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'attacker@example.com', password: 'guessing' },
        }),
      ),
    )

    const throttled = attempts.filter((response) => response.statusCode === 429)
    expect(throttled.length).toBeGreaterThan(0)

    await strictApp.close()
  })
})

describe('authorization boundaries', () => {
  it('blocks unauthenticated access to protected routes', async () => {
    resetTables()

    for (const url of [
      '/api/mentors',
      '/api/mentors/recommendations',
      '/api/mentorship/requests',
      '/api/seekers/me',
    ]) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode, `${url} should require auth`).toBe(401)
    }
  })

  it('stops a student reaching alumni-only endpoints', async () => {
    resetTables()
    const student = await createStudent(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/mentors/me',
      headers: { cookie: student.cookie },
    })

    expect(response.statusCode).toBe(403)
  })

  it('stops an alumnus reaching student-only endpoints', async () => {
    resetTables()
    const mentor = await createMentor(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/mentors/recommendations',
      headers: { cookie: mentor.cookie },
    })

    expect(response.statusCode).toBe(403)
  })

  it('refuses a session cookie whose payload has been edited', async () => {
    resetTables()
    const student = await createStudent(app)

    // A JWT is header.payload.signature; rewriting the payload to claim the
    // admin role must fail signature verification. This is exactly the attack
    // the old localStorage session model allowed outright.
    const [, token] = student.cookie.split('=')
    const [header, payload, signature] = (token ?? '').split('.')
    const decoded = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString())
    decoded.role = 'admin'
    const forgedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url')
    const forged = `mentorship_token=${header}.${forgedPayload}.${signature}`

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: forged },
    })

    expect(response.statusCode).toBe(401)
  })
})

describe('input handling', () => {
  it('treats SQL metacharacters in search as literal text', async () => {
    resetTables()
    const mentor = await createMentor(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/mentors?q=${encodeURIComponent("%' OR 1=1 --")}`,
      headers: { cookie: mentor.cookie },
    })

    expect(response.statusCode).toBe(200)
    // Bound parameters mean the pattern matches nothing rather than everything;
    // an injected OR would have returned the mentor.
    expect(response.json().items).toHaveLength(0)

    // And the table is still intact afterwards.
    const after = await app.inject({
      method: 'GET',
      url: '/api/mentors',
      headers: { cookie: mentor.cookie },
    })
    expect(after.json().items.length).toBeGreaterThan(0)
  })

  it('rejects an oversized request body', async () => {
    resetTables()
    const student = await createStudent(app, { optIn: false })

    const response = await app.inject({
      method: 'POST',
      url: '/api/seekers/me',
      headers: { cookie: student.cookie },
      payload: { major: 'x'.repeat(500_000) },
    })

    expect([400, 413]).toContain(response.statusCode)
  })
})
