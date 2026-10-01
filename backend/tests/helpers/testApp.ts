/**
 * Test harness: a migrated, empty database plus a Fastify instance driven
 * through `.inject()` — no network sockets, no port conflicts, and the same
 * routing/validation/error path a real request takes.
 */
import type { FastifyInstance } from 'fastify'

import { buildApp } from '../../src/app.js'
import { getDatabase } from '../../src/db/connection.js'
import { runMigrations } from '../../src/db/migrate.js'
import { AUTH_COOKIE_NAME } from '../../src/plugins/auth.js'

export type TestContext = {
  app: FastifyInstance
  close: () => Promise<void>
}

/** Order matters: children before parents, so FK constraints stay satisfied. */
const TABLES_IN_DELETE_ORDER = [
  'reports',
  'user_blocks',
  'email_tokens',
  'office_hour_bookings',
  'office_hours',
  'session_ratings',
  'mentorship_goals',
  'notifications',
  'admin_audit',
  'relationship_checkins',
  'mentor_availability',
  'opportunity_applications',
  'mentor_opportunities',
  'mentor_timeline',
  'mentor_certifications',
  'mentor_skills',
  'mentor_tracks',
  'feedback',
  'sessions',
  'mentorship_relationships',
  'mentorship_requests',
  'match_events',
  'messages',
  'conversation_participants',
  'conversations',
  'group_resources',
  'group_members',
  'groups',
  'event_registrations',
  'events',
  'announcements',
  'alumni_verifications',
  'mentorship_seekers',
  'mentor_profiles',
  'users',
]

export function resetTables(): void {
  const db = getDatabase()
  db.exec('PRAGMA foreign_keys = OFF')
  for (const table of TABLES_IN_DELETE_ORDER) {
    db.exec(`DELETE FROM ${table}`)
  }
  db.exec('PRAGMA foreign_keys = ON')
}

export async function createTestApp(): Promise<TestContext> {
  runMigrations(getDatabase())
  resetTables()

  const app = await buildApp({ quiet: true })
  await app.ready()

  return {
    app,
    close: async () => {
      await app.close()
    },
  }
}

/** Pulls the auth cookie out of a login/signup response for reuse on later calls. */
export function extractAuthCookie(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie']
  const values = Array.isArray(raw) ? raw : [raw]

  for (const value of values) {
    if (typeof value === 'string' && value.startsWith(`${AUTH_COOKIE_NAME}=`)) {
      return value.split(';')[0] ?? ''
    }
  }

  throw new Error('No auth cookie present on the response.')
}

export type Credentials = { email: string; password: string; name?: string }

/** Signs a user up and returns the cookie header to authenticate later requests. */
/**
 * Signs up through the real route and returns the session cookie.
 *
 * Alumni sign up pending, exactly as in production. Unless `verified: false` is
 * passed, the fixture then approves them the way an administrator would —
 * marking their queue entry approved and the account active — because most
 * suites are about what a verified alumnus can do, not about verification.
 */
export async function signupAndAuth(
  app: FastifyInstance,
  credentials: Credentials & { role: 'student' | 'alumni'; verified?: boolean },
): Promise<{ cookie: string; userId: string }> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: {
      name: credentials.name ?? 'Test User',
      email: credentials.email,
      password: credentials.password,
      role: credentials.role,
      acceptTerms: true,
      ...(credentials.role === 'alumni' ? { classYear: '2016', program: 'BSc Informatics' } : {}),
    },
  })

  if (response.statusCode !== 201) {
    throw new Error(`Signup failed (${response.statusCode}): ${response.body}`)
  }

  const userId = response.json().user.id as string

  if (credentials.role === 'alumni' && credentials.verified !== false) {
    const db = getDatabase()
    db.prepare("UPDATE alumni_verifications SET status = 'approved' WHERE user_id = ?").run(userId)
    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(userId)
  }

  return {
    cookie: extractAuthCookie(response.headers as Record<string, unknown>),
    userId,
  }
}
