/**
 * Data access for availability and sessions. Prepared statements only.
 */
import type { Database } from '../../db/connection.js'
import { execute, queryAll, queryOne, type SqlValue } from '../../db/repository.js'
import type { SessionStatus } from '../../types/domain.js'

export type AvailabilityRow = {
  id: string
  mentor_profile_id: string
  day_of_week: number
  start_minute: number
  end_minute: number
  created_at: string
}

export type SchedulingPrefsRow = {
  id: string
  user_id: string
  timezone_label: string
  session_duration_min: number
}

export type SessionRow = {
  id: string
  relationship_id: string
  mentor_profile_id: string | null
  student_user_id: string | null
  title: string
  scheduled_at: string
  duration_min: number
  status: SessionStatus
  notes: string | null
  cancelled_reason: string | null
  booked_by_user_id: string | null
  meeting_link: string | null
  reminder_sent_at: string | null
  created_at: string
  mentor_name: string
  mentor_user_id: string
  student_name: string
  mentor_timezone: string | null
}

export function listAvailability(db: Database, mentorProfileId: string): AvailabilityRow[] {
  return queryAll<AvailabilityRow>(
    db,
    `SELECT * FROM mentor_availability
     WHERE mentor_profile_id = ?
     ORDER BY day_of_week, start_minute`,
    [mentorProfileId],
  )
}

export function replaceAvailability(
  db: Database,
  mentorProfileId: string,
  windows: Array<{ id: string; dayOfWeek: number; startMinute: number; endMinute: number }>,
  createdAt: string,
): void {
  execute(db, 'DELETE FROM mentor_availability WHERE mentor_profile_id = ?', [mentorProfileId])

  for (const window of windows) {
    execute(
      db,
      `INSERT INTO mentor_availability
         (id, mentor_profile_id, day_of_week, start_minute, end_minute, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [window.id, mentorProfileId, window.dayOfWeek, window.startMinute, window.endMinute, createdAt],
    )
  }
}

export function updateSchedulingPrefs(
  db: Database,
  mentorProfileId: string,
  timezoneLabel: string,
  sessionDurationMin: number,
  updatedAt: string,
): void {
  execute(
    db,
    `UPDATE mentor_profiles
     SET timezone_label = ?, session_duration_min = ?, updated_at = ?
     WHERE id = ?`,
    [timezoneLabel, sessionDurationMin, updatedAt, mentorProfileId],
  )
}

export function findSchedulingPrefs(
  db: Database,
  mentorProfileId: string,
): { timezone_label: string; session_duration_min: number } | null {
  return queryOne(
    db,
    'SELECT timezone_label, session_duration_min FROM mentor_profiles WHERE id = ?',
    [mentorProfileId],
  )
}

export function findMentorProfileIdForUser(db: Database, userId: string): string | null {
  const row = queryOne<{ id: string }>(db, 'SELECT id FROM mentor_profiles WHERE user_id = ?', [
    userId,
  ])
  return row?.id ?? null
}

/**
 * Everything already committed for a mentor from `fromIso` onward, across every
 * mentorship they hold — not just the one being booked. A mentor is one person:
 * a slot taken by student A is unavailable to student B.
 */
export type Commitment = { id: string; scheduled_at: string; duration_min: number }

export function listMentorCommitments(
  db: Database,
  mentorProfileId: string,
  fromIso: string,
): Commitment[] {
  // Office hours the mentor hosts are commitments too, so no one-to-one slot
  // is ever offered on top of one.
  return queryAll<Commitment>(
    db,
    `SELECT id, scheduled_at, duration_min FROM sessions
     WHERE mentor_profile_id = ? AND status <> 'cancelled' AND scheduled_at >= ?
     UNION ALL
     SELECT id, starts_at AS scheduled_at, duration_min FROM office_hours
     WHERE mentor_profile_id = ? AND cancelled_at IS NULL AND starts_at >= ?`,
    [mentorProfileId, fromIso, mentorProfileId, fromIso],
  )
}

/** The same question for a student, so they cannot book two mentors at once. */
export function listStudentCommitments(
  db: Database,
  studentUserId: string,
  fromIso: string,
): Commitment[] {
  return queryAll<Commitment>(
    db,
    `SELECT id, scheduled_at, duration_min FROM sessions
     WHERE student_user_id = ? AND status <> 'cancelled' AND scheduled_at >= ?
     UNION ALL
     SELECT o.id, o.starts_at AS scheduled_at, o.duration_min
     FROM office_hour_bookings b JOIN office_hours o ON o.id = b.office_hour_id
     WHERE b.student_user_id = ? AND o.cancelled_at IS NULL AND o.starts_at >= ?`,
    [studentUserId, fromIso, studentUserId, fromIso],
  )
}

const SESSION_SELECT = `
  SELECT s.*, mu.name AS mentor_name, mp.user_id AS mentor_user_id, su.name AS student_name,
         mp.timezone_label AS mentor_timezone
  FROM sessions s
  JOIN mentorship_relationships rel ON rel.id = s.relationship_id
  JOIN mentor_profiles mp ON mp.id = rel.mentor_profile_id
  JOIN users mu ON mu.id = mp.user_id
  JOIN users su ON su.id = rel.student_user_id
`

export function findSessionById(db: Database, sessionId: string): SessionRow | null {
  return queryOne<SessionRow>(db, `${SESSION_SELECT} WHERE s.id = ?`, [sessionId])
}

/** Sessions for either participant, newest commitments first for upcoming ones. */
export function listSessionsForUser(
  db: Database,
  userId: string,
  scope: 'all' | 'upcoming' | 'past',
  nowIso: string,
): SessionRow[] {
  const conditions = ['(rel.student_user_id = ? OR mp.user_id = ?)']
  const params: SqlValue[] = [userId, userId]

  if (scope === 'upcoming') {
    conditions.push("s.scheduled_at >= ? AND s.status = 'upcoming'")
    params.push(nowIso)
  } else if (scope === 'past') {
    conditions.push("(s.scheduled_at < ? OR s.status <> 'upcoming')")
    params.push(nowIso)
  }

  const order = scope === 'past' ? 'DESC' : 'ASC'

  return queryAll<SessionRow>(
    db,
    `${SESSION_SELECT} WHERE ${conditions.join(' AND ')} ORDER BY s.scheduled_at ${order}`,
    params,
  )
}

export function insertSession(
  db: Database,
  row: {
    id: string
    relationship_id: string
    mentor_profile_id: string
    student_user_id: string
    title: string
    scheduled_at: string
    duration_min: number
    notes: string | null
    meeting_link: string | null
    booked_by_user_id: string
    created_at: string
  },
): void {
  execute(
    db,
    `INSERT INTO sessions
       (id, relationship_id, mentor_profile_id, student_user_id, title, scheduled_at,
        duration_min, status, notes, meeting_link, booked_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'upcoming', ?, ?, ?, ?)`,
    [
      row.id,
      row.relationship_id,
      row.mentor_profile_id,
      row.student_user_id,
      row.title,
      row.scheduled_at,
      row.duration_min,
      row.notes,
      row.meeting_link,
      row.booked_by_user_id,
      row.created_at,
    ],
  )
}

export function updateSession(
  db: Database,
  sessionId: string,
  changes: Partial<{
    status: string
    scheduled_at: string
    title: string
    notes: string | null
    cancelled_reason: string | null
    meeting_link: string | null
    reminder_sent_at: string | null
  }>,
): number {
  const entries = Object.entries(changes).filter(([, value]) => value !== undefined)
  if (entries.length === 0) return 0

  const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
  const params = [...entries.map(([, value]) => value as SqlValue), sessionId]

  return execute(db, `UPDATE sessions SET ${assignments} WHERE id = ?`, params).changes
}

export function findRelationshipForSession(
  db: Database,
  relationshipId: string,
): {
  id: string
  student_user_id: string
  mentor_profile_id: string
  mentor_user_id: string
  status: string
  mentor_name: string
  student_name: string
} | null {
  return queryOne(
    db,
    `SELECT rel.id, rel.student_user_id, rel.mentor_profile_id, rel.status,
            mp.user_id AS mentor_user_id, mu.name AS mentor_name, su.name AS student_name
     FROM mentorship_relationships rel
     JOIN mentor_profiles mp ON mp.id = rel.mentor_profile_id
     JOIN users mu ON mu.id = mp.user_id
     JOIN users su ON su.id = rel.student_user_id
     WHERE rel.id = ?`,
    [relationshipId],
  )
}

/** Upcoming sessions starting within the window that have not been reminded yet. */
export function listSessionsDueForReminder(db: Database, now: string, until: string): SessionRow[] {
  return queryAll<SessionRow>(
    db,
    `${SESSION_SELECT}
     WHERE s.status = 'upcoming' AND s.reminder_sent_at IS NULL
       AND s.scheduled_at > ? AND s.scheduled_at <= ?`,
    [now, until],
  )
}

export function markReminded(db: Database, sessionId: string, at: string): void {
  execute(db, 'UPDATE sessions SET reminder_sent_at = ? WHERE id = ?', [at, sessionId])
}

export function insertRating(
  db: Database,
  row: { session_id: string; user_id: string; rating: number; comment: string | null; created_at: string },
): void {
  execute(
    db,
    'INSERT INTO session_ratings (session_id, user_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)',
    [row.session_id, row.user_id, row.rating, row.comment, row.created_at],
  )
}

/** One person's ratings of the given sessions, keyed by session id. */
export function listRatingsBy(db: Database, userId: string, sessionIds: string[]): Map<string, number> {
  if (sessionIds.length === 0) return new Map()
  const rows = queryAll<{ session_id: string; rating: number }>(
    db,
    `SELECT session_id, rating FROM session_ratings
     WHERE user_id = ? AND session_id IN (${sessionIds.map(() => '?').join(', ')})`,
    [userId, ...sessionIds],
  )
  return new Map(rows.map((row) => [row.session_id, row.rating]))
}
