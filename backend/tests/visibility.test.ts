/**
 * Directory visibility (DESIGN_BACKLOG #44, remainder).
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createMentor } from './helpers/fixtures.js'
import { createTestApp, resetTables, type TestContext } from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  resetTables()
})

describe('directory visibility', () => {
  it('lets an alumnus leave the directory while staying findable as a mentor', async () => {
    const hiding = await createMentor(app, { name: 'Quiet Mentor' })
    const viewer = await createMentor(app, { name: 'Looking Around' })
    const listed = async () =>
      ((await app.inject({ method: 'GET', url: '/api/alumni', headers: { cookie: viewer.cookie } })).json().alumni as Array<{ name: string }>).map((a) => a.name)

    expect(await listed()).toContain('Quiet Mentor')
    const privacy = await app.inject({ method: 'GET', url: '/api/account/privacy', headers: { cookie: hiding.cookie } })
    expect(privacy.json()).toEqual({ privacy: { showInDirectory: true } })

    const hide = await app.inject({
      method: 'PUT', url: '/api/account/privacy', headers: { cookie: hiding.cookie }, payload: { showInDirectory: false },
    })
    expect(hide.statusCode).toBe(200)
    expect(await listed()).not.toContain('Quiet Mentor')

    const search = await app.inject({ method: 'GET', url: '/api/mentors?q=Quiet', headers: { cookie: viewer.cookie } })
    expect(search.json().items.map((m: { name: string }) => m.name)).toContain('Quiet Mentor')

    const bad = await app.inject({
      method: 'PUT', url: '/api/account/privacy', headers: { cookie: hiding.cookie }, payload: { showInDirectory: 'no' },
    })
    expect(bad.statusCode).toBe(400)
  })
})
