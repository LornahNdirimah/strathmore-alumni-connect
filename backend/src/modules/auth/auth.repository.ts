import type { OptInStatus, VerificationSummary } from '../../contract/index.js'
import type { Database } from '../../db/connection.js'
import { execute, queryOne } from '../../db/repository.js'
import type { AuthRole, PublicUser, UserStatus } from '../../types/domain.js'

/** Full row, including credential material. Never leaves the service layer. */
export type UserRow = {
  id: string
  name: string
  email: string
  password_hash: string
  password_salt: string
  role: AuthRole
  status: UserStatus
  created_at: string
  updated_at: string
  avatar_updated_at?: string | null
  email_verified_at?: string | null
  terms_version?: string | null
  deleted_at?: string | null
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
  }
}

export function findUserByEmail(db: Database, email: string): UserRow | null {
  return queryOne<UserRow>(db, 'SELECT * FROM users WHERE lower(email) = lower(?)', [email])
}

export function findUserById(db: Database, id: string): UserRow | null {
  return queryOne<UserRow>(db, 'SELECT * FROM users WHERE id = ?', [id])
}

export function insertUser(
  db: Database,
  user: Omit<UserRow, 'created_at' | 'updated_at'> & { created_at: string; updated_at: string },
): void {
  execute(
    db,
    `INSERT INTO users (id, name, email, password_hash, password_salt, role, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.name,
      user.email,
      user.password_hash,
      user.password_salt,
      user.role,
      user.status,
      user.created_at,
      user.updated_at,
    ],
  )
}

/**
 * Opt-in state (DESIGN_BACKLOG #3): whether this account has completed the
 * student career-goals form and/or the alumni mentor-join form. Access to the
 * mentorship system is gated on these, not on `role` alone.
 */
export type { OptInStatus } from '../../contract/index.js'

export function getOptInStatus(db: Database, userId: string): OptInStatus {
  const seeker = queryOne<{ id: string }>(
    db,
    'SELECT id FROM mentorship_seekers WHERE user_id = ?',
    [userId],
  )
  const mentor = queryOne<{ id: string }>(
    db,
    'SELECT id FROM mentor_profiles WHERE user_id = ?',
    [userId],
  )

  return {
    isSeeker: seeker !== null,
    isMentor: mentor !== null,
    seekerId: seeker?.id ?? null,
    mentorProfileId: mentor?.id ?? null,
  }
}

export type { VerificationSummary } from '../../contract/index.js'

/** The alumnus's most recent verification entry, if they have one. */
export function findLatestVerification(db: Database, userId: string): VerificationSummary | null {
  const row = queryOne<{ status: VerificationSummary['status']; class_year: string; program: string }>(
    db,
    `SELECT status, class_year, program FROM alumni_verifications
     WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
    [userId],
  )
  return row ? { status: row.status, classYear: row.class_year, program: row.program } : null
}

export function insertVerification(
  db: Database,
  entry: { id: string; userId: string; classYear: string; program: string; createdAt: string },
): void {
  execute(
    db,
    `INSERT INTO alumni_verifications (id, user_id, class_year, program, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [entry.id, entry.userId, entry.classYear, entry.program, entry.createdAt],
  )
}
