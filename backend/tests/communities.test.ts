/**
 * DESIGN_BACKLOG #1 — creator-controlled group visibility.
 *
 * The requirement was explicit: opening a group to students is "strictly tied
 * to the creator of the community". These tests pin both halves of that —
 * students cannot see or reach an alumni-only group, and nobody but the creator
 * can change the setting, including another alumnus who is a member.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { createAdmin, createMentor, createStudent } from './helpers/fixtures.js'
import { createTestApp, resetTables, type TestContext } from './helpers/testApp.js'

const ctx: TestContext = await createTestApp()
const { app } = ctx

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  resetTables()
})

async function createGroup(
  cookie: string,
  overrides: Partial<{ name: string; visibility: 'alumni-only' | 'open-to-students' }> = {},
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: { cookie },
    payload: {
      name: overrides.name ?? 'Fintech Founders Circle',
      topic: 'Building payment products in East Africa',
      description: 'A space for alumni shipping fintech products to compare notes.',
      ...(overrides.visibility ? { visibility: overrides.visibility } : {}),
    },
  })

  if (response.statusCode !== 201) {
    throw new Error(`Group creation failed (${response.statusCode}): ${response.body}`)
  }

  return response.json().group.id as string
}

describe('group creation', () => {
  it('defaults a new group to alumni-only', async () => {
    const creator = await createMentor(app)
    const groupId = await createGroup(creator.cookie)

    const response = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { cookie: creator.cookie },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().group.visibility).toBe('alumni-only')
  })

  it('refuses to let a student create a group', async () => {
    const student = await createStudent(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { cookie: student.cookie },
      payload: {
        name: 'Student Study Group',
        topic: 'Exam prep',
        description: 'Somewhere to revise together before finals.',
      },
    })

    expect(response.statusCode).toBe(403)
  })
})

describe('visibility filtering', () => {
  it('hides an alumni-only group from students in the listing', async () => {
    const creator = await createMentor(app)
    await createGroup(creator.cookie, { name: 'Alumni Only Circle' })
    const student = await createStudent(app)

    const listing = await app.inject({
      method: 'GET',
      url: '/api/groups',
      headers: { cookie: student.cookie },
    })

    expect(listing.statusCode).toBe(200)
    expect(listing.json().groups).toHaveLength(0)
  })

  it('404s a student who guesses an alumni-only group id directly', async () => {
    const creator = await createMentor(app)
    const groupId = await createGroup(creator.cookie)
    const student = await createStudent(app)

    // Filtering the list is not enough on its own — the detail route has to
    // re-check, or the id is all an attacker needs.
    const response = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { cookie: student.cookie },
    })

    expect(response.statusCode).toBe(404)
  })

  it('shows the group to students once the creator opens it', async () => {
    const creator = await createMentor(app)
    const groupId = await createGroup(creator.cookie)
    const student = await createStudent(app)

    const toggle = await app.inject({
      method: 'PATCH',
      url: `/api/groups/${groupId}/visibility`,
      headers: { cookie: creator.cookie },
      payload: { visibility: 'open-to-students' },
    })

    expect(toggle.statusCode).toBe(200)
    expect(toggle.json().group.visibility).toBe('open-to-students')
    // Guards against the single-replace bug that rendered "open to-students".
    expect(toggle.json().message).toBe('Group is now open to students.')

    const listing = await app.inject({
      method: 'GET',
      url: '/api/groups',
      headers: { cookie: student.cookie },
    })

    expect(listing.json().groups).toHaveLength(1)
  })

  it('lets alumni and admins see alumni-only groups', async () => {
    const creator = await createMentor(app)
    await createGroup(creator.cookie)
    const otherAlumnus = await createMentor(app, { name: 'Brian Kimani' })
    const admin = await createAdmin(app)

    for (const [label, cookie] of [
      ['alumnus', otherAlumnus.cookie],
      ['admin', admin.cookie],
    ] as const) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/groups',
        headers: { cookie },
      })
      expect(response.json().groups, `${label} should see the group`).toHaveLength(1)
    }
  })
})

describe('visibility authorization (creator-only)', () => {
  it('forbids a non-creator alumnus from changing visibility', async () => {
    const creator = await createMentor(app)
    const groupId = await createGroup(creator.cookie)
    const otherAlumnus = await createMentor(app, { name: 'Brian Kimani' })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/groups/${groupId}/visibility`,
      headers: { cookie: otherAlumnus.cookie },
      payload: { visibility: 'open-to-students' },
    })

    expect(response.statusCode).toBe(403)
  })

  it('forbids a member who is not the creator', async () => {
    const creator = await createMentor(app)
    const groupId = await createGroup(creator.cookie)
    const member = await createMentor(app, { name: 'Brian Kimani' })

    await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/join`,
      headers: { cookie: member.cookie },
    })

    // Membership is not authority over the group's settings.
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/groups/${groupId}/visibility`,
      headers: { cookie: member.cookie },
      payload: { visibility: 'open-to-students' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.message).toMatch(/creator/i)
  })

  it('forbids an admin from overriding the creator', async () => {
    const creator = await createMentor(app)
    const groupId = await createGroup(creator.cookie)
    const admin = await createAdmin(app)

    // "Strictly tied to the creator" holds even for an admin; platform staff can
    // moderate, but they do not own another person's community setting.
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/groups/${groupId}/visibility`,
      headers: { cookie: admin.cookie },
      payload: { visibility: 'open-to-students' },
    })

    expect(response.statusCode).toBe(403)
  })

  it('reports canEditVisibility only to the creator', async () => {
    const creator = await createMentor(app)
    const groupId = await createGroup(creator.cookie, { visibility: 'open-to-students' })
    const student = await createStudent(app)

    const asCreator = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { cookie: creator.cookie },
    })
    const asStudent = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { cookie: student.cookie },
    })

    expect(asCreator.json().group.canEditVisibility).toBe(true)
    expect(asStudent.json().group.canEditVisibility).toBe(false)
  })

  it('rejects an unknown visibility value', async () => {
    const creator = await createMentor(app)
    const groupId = await createGroup(creator.cookie)

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/groups/${groupId}/visibility`,
      headers: { cookie: creator.cookie },
      payload: { visibility: 'public' },
    })

    expect(response.statusCode).toBe(400)
  })
})

describe('membership', () => {
  it('lets a student join an open group and blocks an alumni-only one', async () => {
    const creator = await createMentor(app)
    const openGroup = await createGroup(creator.cookie, {
      name: 'Careers in Tech',
      visibility: 'open-to-students',
    })
    const closedGroup = await createGroup(creator.cookie, { name: 'Alumni Lounge' })
    const student = await createStudent(app)

    const allowed = await app.inject({
      method: 'POST',
      url: `/api/groups/${openGroup}/join`,
      headers: { cookie: student.cookie },
    })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json().group.isMember).toBe(true)

    const blocked = await app.inject({
      method: 'POST',
      url: `/api/groups/${closedGroup}/join`,
      headers: { cookie: student.cookie },
    })
    expect([403, 404]).toContain(blocked.statusCode)
  })

  it('keeps the member count honest across join and leave', async () => {
    const creator = await createMentor(app)
    const groupId = await createGroup(creator.cookie, { visibility: 'open-to-students' })
    const student = await createStudent(app)

    await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/join`,
      headers: { cookie: student.cookie },
    })

    // Joining twice must not inflate the count.
    const duplicate = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/join`,
      headers: { cookie: student.cookie },
    })
    expect([200, 409]).toContain(duplicate.statusCode)

    const afterJoin = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { cookie: creator.cookie },
    })
    const joinedCount = afterJoin.json().group.memberCount as number

    await app.inject({
      method: 'DELETE',
      url: `/api/groups/${groupId}/leave`,
      headers: { cookie: student.cookie },
    })

    const afterLeave = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { cookie: creator.cookie },
    })

    expect(afterLeave.json().group.memberCount).toBe(joinedCount - 1)
  })
})
