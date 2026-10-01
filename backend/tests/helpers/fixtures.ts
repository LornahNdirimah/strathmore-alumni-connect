/**
 * Scenario builders. Each returns the cookie plus the ids a test needs, so
 * suites read as "given a mentor with capacity 1..." rather than fifteen lines
 * of setup.
 */
import type { FastifyInstance } from 'fastify'
import { CURRENT_TERMS_VERSION } from '../../src/lib/terms.js'

import { getDatabase } from '../../src/db/connection.js'
import { execute } from '../../src/db/repository.js'
import { newId } from '../../src/lib/id.js'
import { hashPassword } from '../../src/lib/password.js'
import { nowIso } from '../../src/lib/time.js'
import { extractAuthCookie, signupAndAuth } from './testApp.js'

export type MentorFixture = {
  cookie: string
  userId: string
  mentorProfileId: string
}

export type StudentFixture = {
  cookie: string
  userId: string
}

let counter = 0
function uniqueEmail(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}-${Date.now()}@strathmore.edu`
}

export async function createMentor(
  app: FastifyInstance,
  overrides: Partial<{
    capacity: number
    tracks: string[]
    industry: string
    company: string
    major: string
    skills: string[]
    name: string
  }> = {},
): Promise<MentorFixture> {
  const { cookie, userId } = await signupAndAuth(app, {
    email: uniqueEmail('mentor'),
    password: 'mentor-password-123',
    role: 'alumni',
    name: overrides.name ?? 'Amina Osei',
  })

  const response = await app.inject({
    method: 'POST',
    url: '/api/mentors/me',
    headers: { cookie },
    payload: {
      headline: 'Senior Data Scientist',
      company: overrides.company ?? 'Google DeepMind',
      industry: overrides.industry ?? 'Technology',
      location: 'Nairobi, Kenya',
      bio: 'Mentoring students into data careers.',
      capacity: overrides.capacity ?? 3,
      availability: 'Available',
      skills: overrides.skills ?? ['Python', 'Machine Learning'],
      tracks: overrides.tracks ?? ['Data Science'],
      major: overrides.major ?? 'Computer Science',
      hobbies: ['chess'],
      uniqueQuality: 'Loves teaching',
      country: 'Kenya',
      stateProvince: 'Nairobi',
    },
  })

  if (response.statusCode !== 201) {
    throw new Error(`Mentor profile creation failed (${response.statusCode}): ${response.body}`)
  }

  return { cookie, userId, mentorProfileId: response.json().mentor.id as string }
}

export async function createStudent(
  app: FastifyInstance,
  options: { optIn?: boolean; targetTrack?: string; major?: string } = {},
): Promise<StudentFixture> {
  const { cookie, userId } = await signupAndAuth(app, {
    email: uniqueEmail('student'),
    password: 'student-password-123',
    role: 'student',
    name: 'Kevin Otieno',
  })

  if (options.optIn !== false) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/seekers/me',
      headers: { cookie },
      payload: {
        major: options.major ?? 'Computer Science',
        year: 'Year 3',
        targetTrack: options.targetTrack ?? 'Data Science',
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

    if (response.statusCode !== 201) {
      throw new Error(`Seeker opt-in failed (${response.statusCode}): ${response.body}`)
    }
  }

  return { cookie, userId }
}

/** Sends a request and returns its id. */
export async function sendRequest(
  app: FastifyInstance,
  student: StudentFixture,
  mentorProfileId: string,
): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/mentorship/requests',
    headers: { cookie: student.cookie },
    payload: {
      mentorProfileId,
      interest: 'Machine learning career path',
      preferredSlot: 'Wednesday 5:30 PM',
      message: 'I would value guidance on internships and portfolio building.',
    },
  })

  if (response.statusCode !== 201) {
    throw new Error(`Request creation failed (${response.statusCode}): ${response.body}`)
  }

  return response.json().request.id as string
}

export type AdminFixture = {
  cookie: string
  userId: string
}

/**
 * Admins cannot sign up over the public API (by design), so the fixture inserts
 * the row the way the seed does and then logs in through the real login route —
 * the cookie is therefore issued by the same code path a demo admin uses.
 */
export async function createAdmin(app: FastifyInstance): Promise<AdminFixture> {
  const email = uniqueEmail('admin')
  const password = 'admin-password-123'
  const { hash, salt } = await hashPassword(password)
  const userId = newId('user')
  const now = nowIso()

  execute(
    getDatabase(),
    `INSERT INTO users (id, name, email, password_hash, password_salt, role, status, created_at, updated_at,
                        terms_version, terms_accepted_at)
     VALUES (?, ?, ?, ?, ?, 'admin', 'active', ?, ?, ?, ?)`,
    [userId, 'Platform Admin', email, hash, salt, now, now, CURRENT_TERMS_VERSION, now],
  )

  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email, password },
  })

  if (response.statusCode !== 200) {
    throw new Error(`Admin login failed (${response.statusCode}): ${response.body}`)
  }

  return { cookie: extractAuthCookie(response.headers as Record<string, unknown>), userId }
}

/** Queues an alumni verification entry for the admin review tests. */
export function queueVerification(userId: string): string {
  const id = newId('ver')
  execute(
    getDatabase(),
    `INSERT INTO alumni_verifications (id, user_id, class_year, program, status, created_at)
     VALUES (?, ?, '2018', 'BSc Computer Science', 'pending', ?)`,
    [id, userId, nowIso()],
  )
  return id
}
