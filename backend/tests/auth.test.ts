import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { AUTH_COOKIE_NAME } from '../src/plugins/auth.js'
import { createTestApp, extractAuthCookie, resetTables, type TestContext } from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  resetTables()
})

const validSignup = {
  name: 'Ada Lovelace',
  email: 'ada@strathmore.edu',
  password: 'correct-horse-battery',
  role: 'student' as const,
  acceptTerms: true,
}

describe('POST /api/auth/signup', () => {
  it('creates an account and issues an httpOnly session cookie', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: validSignup })

    expect(response.statusCode).toBe(201)
    expect(response.json().user).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@strathmore.edu',
      role: 'student',
    })

    const cookie = String(response.headers['set-cookie'])
    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('never returns credential material', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: validSignup })
    const body = response.body

    expect(body).not.toContain('password')
    expect(body).not.toContain(validSignup.password)
    expect(response.json().user.password_hash).toBeUndefined()
  })

  it('rejects a duplicate email regardless of casing', async () => {
    await app.inject({ method: 'POST', url: '/api/auth/signup', payload: validSignup })

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { ...validSignup, email: 'ADA@Strathmore.EDU' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('CONFLICT')
  })

  it('rejects a short password with a field-level message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { ...validSignup, password: 'short' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.details).toContainEqual(
      expect.objectContaining({ field: 'password' }),
    )
  })

  it('refuses to self-register an admin account', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { ...validSignup, role: 'admin' },
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await app.inject({ method: 'POST', url: '/api/auth/signup', payload: validSignup })
  })

  it('authenticates with correct credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: validSignup.email, password: validSignup.password },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().user.email).toBe(validSignup.email)
  })

  it('gives the same generic error for a wrong password and an unknown account', async () => {
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: validSignup.email, password: 'not-the-password' },
    })

    const unknownUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@strathmore.edu', password: 'not-the-password' },
    })

    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownUser.statusCode).toBe(401)
    // Identical wording; otherwise the response enumerates registered emails.
    expect(wrongPassword.json().error.message).toBe(unknownUser.json().error.message)
  })

  it('takes as long for an unknown account as for a wrong password', async () => {
    const timeLogin = async (email: string) => {
      const started = performance.now()
      await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email, password: 'not-the-password' },
      })
      return performance.now() - started
    }

    // Warm the decoy hash so its one-time creation is not what gets measured.
    await timeLogin('warmup@strathmore.edu')

    const known = await timeLogin(validSignup.email)
    const unknown = await timeLogin('nobody@strathmore.edu')

    // Both paths run a full scrypt derivation. Skipping it on the unknown path
    // made that path orders of magnitude faster, so a coarse bound is enough to
    // catch a regression without being sensitive to machine speed.
    expect(unknown).toBeGreaterThan(known * 0.5)
  })
})

describe('the session shape is the same everywhere', () => {
  it('login returns opt-in status, exactly as /auth/me does', async () => {
    // Regression: login answered with a narrower user object that had no optIn.
    // The client's route guard reads session.optIn to choose between the
    // dashboard and the onboarding form, so it threw on undefined the moment the
    // dashboard rendered — the app blanked and only a reload recovered it,
    // because only /auth/me carried the field.
    resetTables()
    const signup = await app.inject({ method: 'POST', url: '/api/auth/signup', payload: validSignup })
    expect(signup.statusCode).toBe(201)

    // Opt in, so the field has something non-trivial to report.
    const seeker = await app.inject({
      method: 'POST',
      url: '/api/seekers/me',
      headers: { cookie: extractAuthCookie(signup.headers as Record<string, unknown>) },
      payload: {
        major: 'Computer Science',
        year: 'Year 3',
        targetTrack: 'Data Science',
        careerGoalText: 'I want to move into machine learning engineering after graduation.',
        preferredCadence: 'biweekly',
        formatPreference: 'virtual',
        requestedSupport: ['interview_prep'],
        interests: ['machine learning'],
        skillTags: ['Python'],
        hobbies: ['chess'],
        uniqueQuality: 'Fast learner',
        country: 'Kenya',
        stateProvince: 'Nairobi',
      },
    })
    expect(seeker.statusCode).toBe(201)

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: validSignup.email, password: validSignup.password },
    })

    expect(login.statusCode).toBe(200)
    const user = login.json().user
    expect(user.optIn).toBeDefined()
    expect(user.optIn.isSeeker).toBe(true)

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: extractAuthCookie(login.headers as Record<string, unknown>) },
    })

    // Same keys from both, so a client can rely on one shape.
    expect(Object.keys(user).sort()).toEqual(Object.keys(me.json().user).sort())
  })

  it('signup returns opt-in status too, showing the form is still needed', async () => {
    resetTables()

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: {
        name: 'Fresh Student',
        email: 'fresh-signup@strathmore.edu',
        password: 'fresh-password-123',
        role: 'student',
        acceptTerms: true,
      },
    })

    expect(response.statusCode).toBe(201)
    const user = response.json().user
    expect(user.optIn).toBeDefined()
    // A brand-new account has not filled the career-goals form yet, which is
    // what routes them to onboarding rather than a dashboard.
    expect(user.optIn.isSeeker).toBe(false)
    expect(user.optIn.isMentor).toBe(false)
  })
})

describe('GET /api/auth/me', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(response.statusCode).toBe(401)
  })

  it('rejects a tampered token', async () => {
    const signupResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: validSignup,
    })
    const cookie = extractAuthCookie(signupResponse.headers as Record<string, unknown>)

    /**
     * Flip a character in the middle of the signature.
     *
     * Not the last one: a 256-bit HMAC is 43 base64url characters, and 43 x 6 bits
     * overshoots 256 by two, so the final character carries padding bits that
     * decode to the same bytes either way. Flipping it therefore produced a
     * signature that still verified, and this test passed or failed depending on
     * which character the signature happened to end with.
     */
    const [name, token] = cookie.split('=')
    const [header, payload, signature] = (token ?? '').split('.')
    const middle = Math.floor((signature ?? '').length / 2)
    const swapped =
      (signature ?? '').slice(0, middle) +
      ((signature ?? '')[middle] === 'A' ? 'B' : 'A') +
      (signature ?? '').slice(middle + 1)

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: `${name}=${header}.${payload}.${swapped}` },
    })

    expect(response.statusCode).toBe(401)
  })

  it('returns the session with opt-in status for a valid cookie', async () => {
    const signupResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: validSignup,
    })
    const cookie = extractAuthCookie(signupResponse.headers as Record<string, unknown>)

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().user).toMatchObject({
      email: validSignup.email,
      role: 'student',
      // Signing up does not by itself grant mentorship access — DESIGN_BACKLOG #3.
      optIn: { isSeeker: false, isMentor: false },
    })
  })
})

describe('POST /api/auth/logout', () => {
  it('clears the session cookie', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout' })

    expect(response.statusCode).toBe(200)
    expect(String(response.headers['set-cookie'])).toContain(`${AUTH_COOKIE_NAME}=;`)
  })
})
