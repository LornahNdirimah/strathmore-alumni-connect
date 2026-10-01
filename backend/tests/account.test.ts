/**
 * Account settings and profile photos (DESIGN_BACKLOG #24, #25).
 */
import { existsSync, readdirSync } from 'node:fs'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { avatarDirectory } from '../src/lib/avatars.js'
import { createAdmin, createMentor, createStudent } from './helpers/fixtures.js'
import { createTestApp, extractAuthCookie, resetTables, type TestContext } from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  resetTables()
})

/** A real 1×1 PNG. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG_DATA_URL = `data:image/png;base64,${PNG_BASE64}`

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  url: string,
  cookie: string | undefined,
  payload?: object,
) {
  return app.inject({
    method,
    url,
    headers: cookie ? { cookie } : {},
    ...(payload ? { payload } : {}),
  })
}

describe('name', () => {
  it('can be changed, and the session reflects it', async () => {
    const student = await createStudent(app)

    const response = await call('PATCH', '/api/account', student.cookie, { name: '  Kevin O. Otieno ' })
    expect(response.statusCode).toBe(200)
    expect((await call('GET', '/api/auth/me', student.cookie)).json().user.name).toBe('Kevin O. Otieno')
  })

  it('is validated', async () => {
    const student = await createStudent(app)
    expect((await call('PATCH', '/api/account', student.cookie, { name: 'K' })).statusCode).toBe(400)
  })
})

describe('password', () => {
  it('requires the current password', async () => {
    const student = await createStudent(app)
    const response = await call('POST', '/api/account/password', student.cookie, {
      currentPassword: 'not-my-password',
      newPassword: 'a-brand-new-password',
    })
    expect(response.statusCode).toBe(401)
  })

  it('signs out other sessions but keeps this one', async () => {
    const student = await createStudent(app)
    const me = (await call('GET', '/api/auth/me', student.cookie)).json().user
    // A second device, signed in separately.
    const otherDevice = extractAuthCookie(
      (await call('POST', '/api/auth/login', undefined, { email: me.email, password: 'student-password-123' }))
        .headers as Record<string, unknown>,
    )

    const change = await call('POST', '/api/account/password', student.cookie, {
      currentPassword: 'student-password-123',
      newPassword: 'a-brand-new-password',
    })
    expect(change.statusCode).toBe(200)
    const thisDevice = extractAuthCookie(change.headers as Record<string, unknown>)

    expect((await call('GET', '/api/auth/me', otherDevice)).statusCode).toBe(401)
    expect((await call('GET', '/api/auth/me', student.cookie)).statusCode).toBe(401) // the pre-change cookie
    expect((await call('GET', '/api/auth/me', thisDevice)).statusCode).toBe(200)

    const oldLogin = await call('POST', '/api/auth/login', undefined, { email: me.email, password: 'student-password-123' })
    const newLogin = await call('POST', '/api/auth/login', undefined, { email: me.email, password: 'a-brand-new-password' })
    expect(oldLogin.statusCode).toBe(401)
    expect(newLogin.statusCode).toBe(200)
  })

  it('refuses a new password that is too short or unchanged', async () => {
    const student = await createStudent(app)
    const short = await call('POST', '/api/account/password', student.cookie, {
      currentPassword: 'student-password-123',
      newPassword: 'short',
    })
    const same = await call('POST', '/api/account/password', student.cookie, {
      currentPassword: 'student-password-123',
      newPassword: 'student-password-123',
    })
    expect(short.statusCode).toBe(400)
    expect(same.statusCode).toBe(400)
  })
})

describe('profile photo', () => {
  it('uploads, serves to other signed-in users, and appears wherever the person does', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)

    const upload = await call('PUT', '/api/account/avatar', mentor.cookie, { image: PNG_DATA_URL })
    expect(upload.statusCode).toBe(200)
    const url = upload.json().user.avatarUrl as string
    expect(url).toMatch(new RegExp(`^/api/users/${mentor.userId}/avatar\\?v=`))

    const image = await call('GET', url, student.cookie)
    expect(image.statusCode).toBe(200)
    expect(image.headers['content-type']).toBe('image/png')
    expect(image.headers['cross-origin-resource-policy']).toBe('same-site')
    expect(image.rawPayload.equals(Buffer.from(PNG_BASE64, 'base64'))).toBe(true)

    // Not public to the internet.
    expect((await call('GET', url, undefined)).statusCode).toBe(401)

    // The mentor directory carries it, so students can recognise their mentor.
    const detail = (await call('GET', `/api/mentors/${mentor.mentorProfileId}`, student.cookie)).json()
    expect(detail.mentor.avatarUrl).toBe(url)
  })

  it('trusts the bytes, not the label', async () => {
    const student = await createStudent(app)

    const mislabelled = await call('PUT', '/api/account/avatar', student.cookie, {
      image: `data:image/jpeg;base64,${PNG_BASE64}`,
    })
    const notAnImage = await call('PUT', '/api/account/avatar', student.cookie, {
      image: `data:image/png;base64,${Buffer.from('<svg onload="alert(1)"/>').toString('base64')}`,
    })
    const svg = await call('PUT', '/api/account/avatar', student.cookie, {
      image: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
    })

    expect(mislabelled.statusCode).toBe(400)
    expect(notAnImage.statusCode).toBe(400)
    expect(svg.statusCode).toBe(400)
  })

  it('refuses an oversized photo', async () => {
    const student = await createStudent(app)
    // A valid PNG signature followed by 350 KB of padding.
    const big = Buffer.concat([Buffer.from(PNG_BASE64, 'base64'), Buffer.alloc(350 * 1024)])
    const response = await call('PUT', '/api/account/avatar', student.cookie, {
      image: `data:image/png;base64,${big.toString('base64')}`,
    })
    expect([400, 413]).toContain(response.statusCode)
  })

  it('replaces the old file and can be removed', async () => {
    const student = await createStudent(app)

    await call('PUT', '/api/account/avatar', student.cookie, { image: PNG_DATA_URL })
    const second = await call('PUT', '/api/account/avatar', student.cookie, { image: PNG_DATA_URL })
    const url = second.json().user.avatarUrl as string

    const files = readdirSync(avatarDirectory()).filter((file) => file.startsWith(student.userId))
    expect(files).toHaveLength(1)

    const removed = await call('DELETE', '/api/account/avatar', student.cookie)
    expect(removed.json().user.avatarUrl).toBeNull()
    expect(existsSync(`${avatarDirectory()}/${files[0]}`)).toBe(false)
    expect((await call('GET', url, student.cookie)).statusCode).toBe(404)
  })

  it('can be removed by an admin, who is recorded doing it', async () => {
    const admin = await createAdmin(app)
    const student = await createStudent(app)
    const other = await createStudent(app)
    await call('PUT', '/api/account/avatar', student.cookie, { image: PNG_DATA_URL })

    expect((await call('DELETE', `/api/admin/users/${student.userId}/avatar`, other.cookie)).statusCode).toBe(403)
    expect((await call('DELETE', `/api/admin/users/${student.userId}/avatar`, admin.cookie)).statusCode).toBe(200)

    expect((await call('GET', '/api/auth/me', student.cookie)).json().user.avatarUrl).toBeNull()
    const log = (await call('GET', '/api/admin/audit', admin.cookie)).json().entries
    expect(log[0]).toMatchObject({ action: 'avatar.removed' })
  })
})

describe('mentor profile editing', () => {
  it('returns every stored form field to the owner, and saves changes to them', async () => {
    const mentor = await createMentor(app)

    const before = (await call('GET', '/api/mentors/me', mentor.cookie)).json()
    expect(before.editable).toMatchObject({ capacity: 3, tracks: ['Data Science'] })
    expect(before.editable).toHaveProperty('hobbies')

    const update = await call('PATCH', '/api/mentors/me', mentor.cookie, {
      headline: 'Principal Data Scientist',
      bio: 'Ten years in analytics.',
      hobbies: ['hiking', 'chess'],
      country: 'Kenya',
      tracks: ['Data Science', 'Research'],
    })
    expect(update.statusCode).toBe(200)

    const after = (await call('GET', '/api/mentors/me', mentor.cookie)).json()
    expect(after.editable).toMatchObject({
      headline: 'Principal Data Scientist',
      bio: 'Ten years in analytics.',
      hobbies: ['hiking', 'chess'],
      country: 'Kenya',
      tracks: ['Data Science', 'Research'],
    })
  })

  it('keeps matching inputs off the public profile', async () => {
    const mentor = await createMentor(app)
    const student = await createStudent(app)
    const publicView = (await call('GET', `/api/mentors/${mentor.mentorProfileId}`, student.cookie)).json()
    expect(publicView.mentor).not.toHaveProperty('hobbies')
    expect(publicView).not.toHaveProperty('editable')
  })
})
